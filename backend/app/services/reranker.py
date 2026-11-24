"""
Reranking — Cohere.

Takes the candidate chunks produced by hybrid retrieval (RRF) and
re-scores them against the query using Cohere's rerank model.
The top N highest-scoring chunks are returned.

Required env var:
    COHERE_API_KEY

Public function:
    rerank_chunks(query, chunks, top_k=5) -> list[dict]
"""

import os

from dotenv import load_dotenv
import cohere

load_dotenv()

COHERE_API_KEY = os.getenv("COHERE_API_KEY")

if not COHERE_API_KEY:
    raise ValueError("COHERE_API_KEY is missing from .env")

RERANK_MODEL = "rerank-v4.0-fast"

client = cohere.ClientV2(api_key=COHERE_API_KEY)


def rerank_chunks(query: str, chunks: list[dict], top_k: int = 5) -> list[dict]:
    """
    Re-score `chunks` against `query` and return the top_k most relevant.

    Each returned chunk gets a `rerank_score` key (0.0–1.0) added.
    Returns an empty list if `chunks` is empty.
    """
    if not chunks:
        return []

    # Cohere expects a flat list of document strings.
    documents = [chunk["content"] for chunk in chunks]

    response = client.rerank(
        model=RERANK_MODEL,
        query=query,
        documents=documents,
        top_n=top_k,
    )

    # Map Cohere results back to the original chunk dicts.
    reranked = []
    for result in response.results:
        chunk = chunks[result.index].copy()
        chunk["rerank_score"] = result.relevance_score
        reranked.append(chunk)

    return reranked
