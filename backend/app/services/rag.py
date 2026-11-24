"""
RAG pipeline — retrieval, reranking, and answer generation.

Pipeline steps:
  1. Vector search (primary query)
  2. Keyword search
  3. Summary vector search        (optional — SUMMARY_SEARCH_ENABLED)
  4. Query expansion vector search (optional — QUERY_EXPANSION_ENABLED)
  5. Reciprocal Rank Fusion (RRF) across all available lists
  6. Duplicate removal
  7. Cohere reranking (falls back to RRF order on failure)
  8. Score threshold filter (RERANK_MIN_SCORE)
  9. Context construction (text / table / image handled differently)
 10. LLM answer generation
 11. "Not found" detection — hides sources when the model couldn't answer

Public function:
    ask_rag(question, document_id=None, use_summaries=None) -> dict
        Returns {"answer": str, "sources": list[dict]}

Internal function:
    retrieve_candidates(question, ...) -> list[dict]
        Returns the ranked candidate chunks before reranking (useful for testing).
"""

import logging
import os

from app.services.embeddings import generate_embedding
from app.services.llm import generate_answer
from app.services.reranker import rerank_chunks
from app.services.retriever import (
    reciprocal_rank_fusion,
    remove_duplicate_chunks,
    search_chunks,
    search_keyword_chunks,
    search_summary_chunks,
)

logger = logging.getLogger(__name__)

# The exact phrase the LLM uses when it cannot find the answer.
# rag.py detects this phrase to clear sources from the response.
NOT_FOUND_ANSWER = "I could not find this information in the uploaded documents."

DEFAULT_MIN_RERANK_SCORE = 0.55


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

def _get_min_rerank_score() -> float:
    """
    Minimum Cohere relevance score (0–1) for a chunk to be included.
    Read from RERANK_MIN_SCORE env var; falls back to 0.55.
    """
    raw = os.getenv("RERANK_MIN_SCORE", str(DEFAULT_MIN_RERANK_SCORE))
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_MIN_RERANK_SCORE
    return min(max(value, 0.0), 1.0)


def _summary_search_enabled() -> bool:
    """Whether to include a third retrieval pass using chunk summary embeddings."""
    return os.getenv("SUMMARY_SEARCH_ENABLED", "false").strip().lower() in (
        "1", "true", "yes", "on"
    )


def _query_expansion_enabled() -> bool:
    """Whether to run a second vector search on an LLM-rewritten query."""
    return os.getenv("QUERY_EXPANSION_ENABLED", "false").strip().lower() in (
        "1", "true", "yes", "on"
    )


def _is_not_found_answer(answer: str) -> bool:
    """
    Return True when the LLM answered with the standard "not found" phrase.
    Allows up to 40 extra characters (e.g. "… in the uploaded documents. Sorry.")
    """
    text = (answer or "").strip().lower()
    phrase = NOT_FOUND_ANSWER.lower().rstrip(".")
    return phrase in text and len(text) <= len(phrase) + 40


# ---------------------------------------------------------------------------
# Retrieval (before reranking)
# ---------------------------------------------------------------------------

def retrieve_candidates(
    question: str,
    document_id: str | None = None,
    use_summaries: bool | None = None,
    top_k: int = 10,
) -> list[dict]:
    """
    Hybrid retrieval: vector + keyword (+ optional summary + expansion),
    fused with RRF and deduplicated.

    Returns candidates BEFORE reranking so this function can be tested
    independently.
    """
    if use_summaries is None:
        use_summaries = _summary_search_enabled()

    # --- 1. Vector search (primary query) ---
    # Compute the embedding once so it can be shared with summary search.
    if use_summaries:
        query_embedding = generate_embedding(question)
        vector_results = search_chunks(
            question,
            match_count=15,
            document_id=document_id,
            query_embedding=query_embedding,
        )
    else:
        query_embedding = None
        vector_results = search_chunks(
            question,
            match_count=15,
            document_id=document_id,
        )

    # --- 2. Keyword search ---
    keyword_results = search_keyword_chunks(
        question,
        match_count=15,
        document_id=document_id,
    )

    # --- 3. Summary vector search (optional) ---
    # Failures are swallowed — summary search is a bonus, not load-bearing.
    summary_results: list[dict] = []
    if use_summaries:
        try:
            summary_results = search_summary_chunks(
                question,
                match_count=15,
                document_id=document_id,
                query_embedding=query_embedding,
            )
            logger.info("Summary search returned %d chunks", len(summary_results))
        except Exception:
            logger.exception("Summary search failed; continuing without it")

    # --- 4. Query expansion (optional) ---
    # Failures are swallowed — expansion is a bonus, not load-bearing.
    expansion_results: list[dict] = []
    if _query_expansion_enabled():
        try:
            from app.services.query_expansion import expand_query

            queries = expand_query(question)
            # queries[0] is always the original; queries[1] is the rewrite (if any).
            if len(queries) > 1:
                rewrite = queries[1]
                expansion_results = search_chunks(
                    rewrite,
                    match_count=10,
                    document_id=document_id,
                )
                logger.info(
                    "Query expansion returned %d chunks for rewrite: %r",
                    len(expansion_results),
                    rewrite[:80],
                )
        except Exception:
            logger.warning("Query expansion failed; continuing without it", exc_info=True)

    # --- 5. RRF fusion + deduplication ---
    fused = reciprocal_rank_fusion(
        vector_results,
        keyword_results,
        top_k=top_k,
        summary_results=summary_results or None,
        expansion_results=expansion_results or None,
    )

    return remove_duplicate_chunks(fused)


# ---------------------------------------------------------------------------
# Full RAG pipeline
# ---------------------------------------------------------------------------

def ask_rag(
    question: str,
    document_id: str | None = None,
    use_summaries: bool | None = None,
) -> dict:
    """
    Run the full RAG pipeline and return an answer with source citations.

    Returns:
        {
            "answer":  str,
            "sources": list[dict]   — empty when no answer was found
        }

    Each source dict contains:
        id, document_id, content, chunk_index, page_number,
        similarity, rrf_score, rerank_score,
        element_type, table_html, image_caption, has_image
    """

    # --- Steps 1–6: hybrid retrieval ---
    candidates = retrieve_candidates(
        question,
        document_id=document_id,
        use_summaries=use_summaries,
        top_k=10,
    )

    # --- Step 7: Cohere reranking ---
    # Falls back to RRF order if Cohere is unavailable.
    rerank_succeeded = True
    try:
        candidates = rerank_chunks(query=question, chunks=candidates, top_k=5)
    except Exception:
        logger.warning("Cohere reranking failed; using RRF order", exc_info=True)
        candidates = candidates[:5]
        rerank_succeeded = False

    # --- Step 8: score threshold filter ---
    if rerank_succeeded:
        min_score = _get_min_rerank_score()
        logger.info(
            "Rerank scores (kept if >= %.2f): %s",
            min_score,
            [round(c.get("rerank_score", 0.0), 3) for c in candidates],
        )
        candidates = [
            c for c in candidates if c.get("rerank_score", 0.0) >= min_score
        ]

    # --- No relevant chunks found ---
    if not candidates:
        return {"answer": NOT_FOUND_ANSWER, "sources": []}

    # --- Step 9: build LLM context ---
    # Text, table, and image chunks are formatted differently so the LLM
    # understands what kind of content each piece is.
    context_parts: list[str] = []
    for chunk in candidates:
        element_type = chunk.get("element_type", "Text")
        page = chunk.get("page_number")
        page_label = f" [page {page}]" if page else ""

        if element_type == "Table":
            # Send both the plain-text content (for semantic understanding) and
            # the raw HTML (so the LLM can read the table structure clearly).
            table_html = chunk.get("table_html")
            if table_html:
                context_parts.append(
                    f"[Table{page_label}]:\n{chunk['content']}\n"
                    f"Table HTML:\n{table_html}"
                )
            else:
                context_parts.append(f"[Table{page_label}]:\n{chunk['content']}")

        elif element_type == "Image":
            # Use the vision-model caption if available; fall back to any text
            # extracted from the image (e.g. OCR text).
            caption = chunk.get("image_caption")
            if caption and not caption.startswith("[Image not analyzed"):
                context_parts.append(f"[Image{page_label}]: {caption}")
            else:
                context_parts.append(f"[Image{page_label}]: {chunk['content']}")

        else:
            context_parts.append(chunk["content"])

    context = "\n\n".join(context_parts)

    # --- Step 10: LLM answer generation ---
    answer = generate_answer(question=question, context=context)

    # --- Step 11: not-found detection ---
    # When the model says it couldn't find the answer, there are no real
    # sources to show, so return an empty list.
    if _is_not_found_answer(answer):
        return {"answer": NOT_FOUND_ANSWER, "sources": []}

    # --- Build source list with all multimodal metadata ---
    sources = [
        {
            "id": chunk["id"],
            "document_id": chunk["document_id"],
            "content": chunk["content"],
            "chunk_index": chunk["chunk_index"],
            "page_number": chunk.get("page_number"),
            "similarity": chunk.get("similarity"),
            "rrf_score": chunk.get("rrf_score"),
            "rerank_score": chunk.get("rerank_score"),
            "element_type": chunk.get("element_type"),
            "table_html": chunk.get("table_html"),
            "image_caption": chunk.get("image_caption"),
            # True only when an actual image file is stored in Supabase Storage.
            # An Image-type chunk whose upload failed will have this as False.
            "has_image": bool(chunk.get("image_storage_path")),
        }
        for chunk in candidates
    ]

    return {"answer": answer, "sources": sources}
