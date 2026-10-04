from app.database.supabase import supabase
from app.services.embeddings import generate_embedding
import re

def search_chunks(query: str, match_count: int = 5,document_id:str |None=None):

    # Convert user question into embedding
    query_embedding = generate_embedding(query)

    # Search Supabase pgvector
    result = supabase.rpc(
        "match_document_chunks",
        {
            "query_embedding": query_embedding,
            "match_count": match_count,
            "filter_document_id":document_id
        }
    ).execute()



    return result.data

def prepare_keyword_query(query: str):
    stop_words = {
        "what", "is", "are", "the", "a", "an",
        "does", "do", "did", "how", "why",
        "which", "who", "when", "where",
        "can", "could", "would", "should",
        "tell", "me", "about", "of", "to",
        "in", "on", "for", "and","use"
    }

    words = re.findall(r"\b[a-zA-Z0-9]+\b", query.lower())

    keywords = [
        word for word in words
        if word not in stop_words
    ]

    return " ".join(keywords)
def search_keyword_chunks(query: str, match_count: int = 5,document_id:str |None=None):
    keyword_query = prepare_keyword_query(query)
    result=supabase.rpc(
        "search_document_chunks",
        {
            "search_query":keyword_query,
            "match_count":match_count,
            "filter_document_id":document_id

        }
    ) .execute()

    return result.data

def reciprocal_rank_fusion(
    vector_results: list,
    keyword_results: list,
    k: int = 60,
    top_k: int = 5
):
    scores = {}
    chunks = {}

    # Vector results
    for rank, chunk in enumerate(vector_results, start=1):
        chunk_id = chunk["id"]

        scores[chunk_id] = (
            scores.get(chunk_id, 0)
            + 1 / (k + rank)
        )

        # Keep vector metadata
        if chunk_id not in chunks:
            chunks[chunk_id] = chunk.copy()

    # Keyword results
    for rank, chunk in enumerate(keyword_results, start=1):
        chunk_id = chunk["id"]

        scores[chunk_id] = (
            scores.get(chunk_id, 0)
            + 1 / (k + rank)
        )

        # Only add keyword result if chunk wasn't already found
        if chunk_id not in chunks:
            chunks[chunk_id] = chunk.copy()

    # Sort by combined RRF score
    ranked_chunks = sorted(
        chunks.values(),
        key=lambda chunk: scores[chunk["id"]],
        reverse=True
    )

    # Add RRF score
    for chunk in ranked_chunks:
        chunk["rrf_score"] = scores[chunk["id"]]

    return ranked_chunks[:top_k]

def remove_duplicate_chunks(chunks: list):
    seen = set()
    unique_chunks = []

    for chunk in chunks:
        content = chunk["content"].strip()

        if content in seen:
            continue

        seen.add(content)
        unique_chunks.append(chunk)

    return unique_chunks