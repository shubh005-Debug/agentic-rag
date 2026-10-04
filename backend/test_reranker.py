from app.services.retriever import (
    search_chunks,
    search_keyword_chunks,
    reciprocal_rank_fusion
)

from app.services.reranker import rerank_chunks


query = "What technology stack does Cubexo use?"


# 1. Vector search
vector_results = search_chunks(
    query,
    match_count=10
)


# 2. Keyword search
keyword_results = search_keyword_chunks(
    "Python Flask FastAPI",
    match_count=10
)


# 3. RRF
rrf_results = reciprocal_rank_fusion(
    vector_results,
    keyword_results,
    top_k=10
)


print("\n========== RRF RESULTS ==========")

for rank, chunk in enumerate(rrf_results, start=1):
    print(f"\nRank: {rank}")
    print(f"RRF Score: {chunk['rrf_score']}")
    print(chunk["content"][:200])


# 4. Reranking
reranked_results = rerank_chunks(
    query=query,
    chunks=rrf_results,
    top_k=5
)


print("\n========== RERANKED RESULTS ==========")

for rank, chunk in enumerate(reranked_results, start=1):
    print(f"\nRank: {rank}")
    print(f"Rerank Score: {chunk['rerank_score']}")
    print(f"RRF Score: {chunk['rrf_score']}")
    print(chunk["content"][:300])