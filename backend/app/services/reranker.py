import os
from dotenv import load_dotenv
import cohere

load_dotenv()

COHERE_API_KEY = os.getenv("COHERE_API_KEY")

if not COHERE_API_KEY:
    raise ValueError("COHERE_API_KEY is missing")

client = cohere.ClientV2(
    api_key=COHERE_API_KEY
)


def rerank_chunks(
    query: str,
    chunks: list,
    top_k: int = 5
):
    if not chunks:
        return []

    documents = [
        chunk["content"]
        for chunk in chunks
    ]

    response = client.rerank(
        model="rerank-v4.0-fast",
        query=query,
        documents=documents,
        top_n=top_k
    )

    reranked_chunks = []

    for result in response.results:
        chunk = chunks[result.index].copy()

        chunk["rerank_score"] = result.relevance_score

        reranked_chunks.append(chunk)

    return reranked_chunks