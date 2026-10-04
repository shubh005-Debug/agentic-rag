from app.services.retriever import (
    search_chunks,
    search_keyword_chunks,
    reciprocal_rank_fusion,
    remove_duplicate_chunks
)
from app.services.llm import generate_answer
from app.services.reranker import rerank_chunks


def ask_rag(
    question: str,
    document_id: str | None = None
):
    # 1. Vector search
    vector_results = search_chunks(
        question,
        match_count=15,
        document_id=document_id
    )
    print("\n--- Vector Similarities ---")

    for i, chunk in enumerate(vector_results, start=1):
        print(
        i,
        "similarity:",
        round(chunk["similarity"], 4),
        "chunk:",
        chunk["chunk_index"]
        )

    # 2. Keyword search
    keyword_results = search_keyword_chunks(
        question,
        match_count=15,
        document_id=document_id
    )

    # 3. Combine using RRF
    chunks = reciprocal_rank_fusion(
        vector_results,
        keyword_results,
        top_k=10
    )
    chunks = remove_duplicate_chunks(chunks)

    chunks=rerank_chunks(
        query=question,
        chunks=chunks,
        top_k=5
    )

    # 4. Check whether we found anything
    if not chunks:
        return {
            "answer": "I could not find this information in the uploaded documents.",
            "sources": []
        }

    # 5. Build context
    context = "\n\n".join(
        chunk["content"]
        for chunk in chunks
    )

    # 6. Send context to LLM
    answer = generate_answer(
        question=question,
        context=context
    )

    # 7. Prepare sources
    sources = []

    for chunk in chunks:
        sources.append({
            "id": chunk["id"],
            "document_id": chunk["document_id"],
            "content": chunk["content"],
            "chunk_index": chunk["chunk_index"],
            "page_number": chunk["page_number"],
            "similarity": chunk.get("similarity"),
            "rrf_score": chunk.get("rrf_score"),
            "rerank_score": chunk.get("rerank_score")
        })

    return {
        "answer": answer,
        "sources": sources
    }