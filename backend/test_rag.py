from app.services.rag import ask_rag

result = ask_rag(
    "What are the eligibility requirements for the Cubexo  program?"
)

print("\nANSWER:")
print(result["answer"])

print("\nSOURCES:")

for source in result["sources"]:
    print(
        "Chunk:",
        source["chunk_index"],
        "Similarity:",
        source["similarity"]
    )