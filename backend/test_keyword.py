from app.services.retriever import search_keyword_chunks

query = "What technology stack does Cubexo use?"

print("Testing:", query)

results = search_keyword_chunks(
    query,
    match_count=5,
    document_id="15334dfa-a008-430a-b940-03353c24327d"
)

print("Number of results:", len(results))

for result in results:
    print("\nChunk:", result["chunk_index"])
    print("Rank:", result["rank"])
    print("Content:", result["content"][:300])