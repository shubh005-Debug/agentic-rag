from app.services.retriever import (
    search_chunks,
    search_keyword_chunks,
    reciprocal_rank_fusion
)

query = "What technology stack does Cubexo use?"

print("\n========== VECTOR SEARCH ==========")

vector_results = search_chunks(
    query,
    match_count=5
)

for rank, result in enumerate(vector_results, start=1):
    print(f"\nRank: {rank}")
    print(f"Similarity: {result['similarity']}")
    print(result["content"][:300])


print("\n========== KEYWORD SEARCH ==========")

keyword_results = search_keyword_chunks(
    "Python Flask FastAPI",
    match_count=5
)

for rank, result in enumerate(keyword_results, start=1):
    print(f"\nRank: {rank}")
    print(f"Keyword Rank: {result['rank']}")
    print(result["content"][:300])


print("\n========== RRF RESULTS ==========")

rrf_results = reciprocal_rank_fusion(
    vector_results,
    keyword_results
)

for rank, result in enumerate(rrf_results, start=1):
    print(f"\nRank: {rank}")
    print(f"RRF Score: {result['rrf_score']}")
    print(f"Chunk ID: {result['id']}")
    print(result["content"][:300])