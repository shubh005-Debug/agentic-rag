from app.services.retriever import (
    search_chunks,
    search_summary_chunks,
    search_keyword_chunks,
)

DOCUMENT_ID = "ffb97288-a412-455a-a09d-757b62bdb7c6"

query = input("Enter a question about kody.pdf: ").strip()

if not query:
    raise ValueError("Question cannot be empty")

print("\n--- VECTOR SEARCH ---")
try:
    results = search_chunks(
        query,
        match_count=5,
        document_id=DOCUMENT_ID,
    )
    for row in results:
        print(
            f"Chunk: {row.get('chunk_index')}, "
            f"Similarity: {row.get('similarity')}"
        )
        print(row.get("content", "")[:300], "\n")
except Exception as exc:
    print("Vector search failed:", repr(exc))

print("\n--- SUMMARY SEARCH ---")
try:
    results = search_summary_chunks(
        query,
        match_count=5,
        document_id=DOCUMENT_ID,
    )
    for row in results:
        print(
            f"Chunk: {row.get('chunk_index')}, "
            f"Similarity: {row.get('similarity')}"
        )
        print(row.get("content", "")[:300], "\n")
except Exception as exc:
    print("Summary search failed:", repr(exc))

print("\n--- KEYWORD SEARCH ---")
try:
    results = search_keyword_chunks(
        query,
        match_count=5,
        document_id=DOCUMENT_ID,
    )
    for row in results:
        print("Chunk:", row.get("chunk_index"))
        print(row.get("content", "")[:300], "\n")
except Exception as exc:
    print("Keyword search failed:", repr(exc))
