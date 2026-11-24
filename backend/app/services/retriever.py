"""
Retrieval functions — Supabase pgvector + full-text search.

Three search strategies are combined using Reciprocal Rank Fusion (RRF):
  1. Vector search   — cosine similarity on chunk embeddings
  2. Keyword search  — PostgreSQL full-text search (tsvector)
  3. Summary search  — cosine similarity on chunk *summary* embeddings (optional)
  4. Expansion search— vector search on a rewritten query (optional)

Public functions:
    search_chunks(query, ...)           — vector search
    search_summary_chunks(query, ...)   — vector search on summaries
    search_keyword_chunks(query, ...)   — full-text keyword search
    reciprocal_rank_fusion(...)         — fuse ranked lists into one
    remove_duplicate_chunks(chunks)     — deduplicate by content
"""

import re

from app.database.supabase import supabase
from app.services.embeddings import generate_embedding


# ---------------------------------------------------------------------------
# Vector search
# ---------------------------------------------------------------------------

def search_chunks(
    query: str,
    match_count: int = 5,
    document_id: str | None = None,
    query_embedding: list | None = None,
) -> list[dict]:
    """
    Search chunks by vector similarity (pgvector cosine distance).

    Pass `query_embedding` to avoid re-embedding when the same vector is
    already available (e.g. the caller also runs summary search).
    """
    if query_embedding is None:
        query_embedding = generate_embedding(query)

    result = supabase.rpc(
        "match_document_chunks",
        {
            "query_embedding": query_embedding,
            "match_count": match_count,
            "filter_document_id": document_id,
        },
    ).execute()

    return result.data


def search_summary_chunks(
    query: str,
    match_count: int = 5,
    document_id: str | None = None,
    query_embedding: list | None = None,
) -> list[dict]:
    """
    Vector search over chunk SUMMARY embeddings.

    Finds chunks whose AI-generated summaries are relevant to the query,
    even when the raw chunk text would not be a strong match.
    Returns the original chunk content (not the summaries themselves).
    """
    if query_embedding is None:
        query_embedding = generate_embedding(query)

    result = supabase.rpc(
        "match_chunk_summaries",
        {
            "query_embedding": query_embedding,
            "match_count": match_count,
            "filter_document_id": document_id,
        },
    ).execute()

    return result.data


# ---------------------------------------------------------------------------
# Keyword search
# ---------------------------------------------------------------------------

# Stop words removed before the full-text query so common words do not drown
# out the meaningful terms.
_STOP_WORDS = {
    "what", "is", "are", "the", "a", "an",
    "does", "do", "did", "how", "why",
    "which", "who", "when", "where",
    "can", "could", "would", "should",
    "tell", "me", "about", "of", "to",
    "in", "on", "for", "and", "use",
}


def _build_keyword_query(query: str) -> str:
    """Remove stop words and return a space-joined keyword string."""
    words = re.findall(r"\b[a-zA-Z0-9]+\b", query.lower())
    keywords = [w for w in words if w not in _STOP_WORDS]
    return " ".join(keywords)


def search_keyword_chunks(
    query: str,
    match_count: int = 5,
    document_id: str | None = None,
) -> list[dict]:
    """
    Full-text keyword search using PostgreSQL tsvector.

    Stop words are stripped before the query is sent to Supabase so the
    search focuses on the meaningful terms in the question.
    """
    keyword_query = _build_keyword_query(query)

    result = supabase.rpc(
        "search_document_chunks",
        {
            "search_query": keyword_query,
            "match_count": match_count,
            "filter_document_id": document_id,
        },
    ).execute()

    return result.data


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion
# ---------------------------------------------------------------------------

def reciprocal_rank_fusion(
    vector_results: list[dict],
    keyword_results: list[dict],
    k: int = 60,
    top_k: int = 5,
    summary_results: list[dict] | None = None,
    expansion_results: list[dict] | None = None,
) -> list[dict]:
    """
    Combine up to four ranked lists into one using Reciprocal Rank Fusion.

    RRF score for a chunk = sum of 1 / (k + rank) across all lists it appears in.
    Higher k means rank differences matter less (k=60 is a common default).

    Lists:
        vector_results    — primary vector search (always present)
        keyword_results   — full-text search (always present)
        summary_results   — optional: vector search on summaries
        expansion_results — optional: vector search on a rewritten query

    Each chunk dict is preserved from the first list it appears in.
    The `rrf_score` key is added to each returned chunk.
    """
    scores: dict[str, float] = {}
    chunks: dict[str, dict] = {}

    all_lists = [
        vector_results,
        keyword_results,
        summary_results or [],
        expansion_results or [],
    ]

    for ranked_list in all_lists:
        for rank, chunk in enumerate(ranked_list, start=1):
            chunk_id = chunk["id"]
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
            # Keep whichever version of the chunk we saw first (preserves
            # the most metadata, e.g. similarity score from vector search).
            if chunk_id not in chunks:
                chunks[chunk_id] = chunk.copy()

    # Sort by combined RRF score, highest first.
    ranked = sorted(chunks.values(), key=lambda c: scores[c["id"]], reverse=True)

    # Attach the RRF score so callers can inspect it.
    for chunk in ranked:
        chunk["rrf_score"] = scores[chunk["id"]]

    return ranked[:top_k]


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def remove_duplicate_chunks(chunks: list[dict]) -> list[dict]:
    """
    Remove chunks with identical content (by exact string equality).

    Preserves the first occurrence (which has the highest RRF score).
    """
    seen: set[str] = set()
    unique: list[dict] = []

    for chunk in chunks:
        content = chunk["content"].strip()
        if content not in seen:
            seen.add(content)
            unique.append(chunk)

    return unique
