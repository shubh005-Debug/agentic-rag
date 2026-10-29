import logging
import os

from app.services.embeddings import generate_embedding
from app.services.retriever import (
    search_chunks,
    search_summary_chunks,
    search_keyword_chunks,
    reciprocal_rank_fusion,
    remove_duplicate_chunks
)
from app.services.llm import generate_answer
from app.services.reranker import rerank_chunks

logger = logging.getLogger(__name__)

NOT_FOUND_ANSWER = "I could not find this information in the uploaded documents."

DEFAULT_MIN_RERANK_SCORE = 0.55


def get_min_rerank_score() -> float:
    """
    Minimum Cohere relevance score (0-1) for a chunk to be used.
    Configurable with RERANK_MIN_SCORE in .env; invalid values fall back
    to the default.
    """
    raw = os.getenv("RERANK_MIN_SCORE", str(DEFAULT_MIN_RERANK_SCORE))

    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_MIN_RERANK_SCORE

    return min(max(value, 0.0), 1.0)


def is_not_found_answer(answer: str) -> bool:
    """
    True when the LLM answered with the standard "could not find" sentence
    (possibly with small additions). Sources are then hidden, because the
    retrieved chunks were not actually used to answer.
    """
    text = (answer or "").strip().lower()
    phrase = NOT_FOUND_ANSWER.lower().rstrip(".")

    return phrase in text and len(text) <= len(phrase) + 40


def summary_search_enabled() -> bool:
    """Third retrieval list from chunk summaries (SUMMARY_SEARCH_ENABLED in .env)."""
    return os.getenv("SUMMARY_SEARCH_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def query_expansion_enabled() -> bool:
    """Whether query expansion is enabled (QUERY_EXPANSION_ENABLED in .env).

    Disabled by default.  When enabled, one LLM-generated alternative query
    is added as a fourth vector-search list fed into RRF fusion.
    The original query is always used as the primary path.
    """
    return os.getenv("QUERY_EXPANSION_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def retrieve_candidates(
    question: str,
    document_id: str | None = None,
    use_summaries: bool | None = None,
    top_k: int = 10
):
    """
    Hybrid retrieval: vector + keyword (+ summary vector search when enabled,
    + expansion vector search when enabled), fused with RRF, duplicates removed.
    Returns candidates BEFORE reranking.
    """
    if use_summaries is None:
        use_summaries = summary_search_enabled()

    # 1. Vector search (primary query)
    if use_summaries:
        # embed the question once and share it with the summary search
        query_embedding = generate_embedding(question)
        vector_results = search_chunks(
            question,
            match_count=15,
            document_id=document_id,
            query_embedding=query_embedding
        )
    else:
        query_embedding = None
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

    # 2b. Summary vector search (optional; never allowed to break /ask)
    summary_results = []

    if use_summaries:
        try:
            summary_results = search_summary_chunks(
                question,
                match_count=15,
                document_id=document_id,
                query_embedding=query_embedding
            )
        except Exception:
            logger.exception("Summary search failed; continuing without it")

        logger.info("Summary search returned %d chunks", len(summary_results))

    # 2c. Query expansion: one extra vector-search list (optional fourth list).
    #     Failures are swallowed — expansion is a bonus, never load-bearing.
    expansion_results = []

    if query_expansion_enabled():
        try:
            from app.services.query_expansion import expand_query
            queries = expand_query(question)
            # queries[0] is always the original; queries[1] (if present) is the rewrite
            if len(queries) > 1:
                rewrite = queries[1]
                expansion_results = search_chunks(
                    rewrite,
                    match_count=10,
                    document_id=document_id,
                )
                logger.info(
                    "Query expansion returned %d chunks for rewrite: %r",
                    len(expansion_results), rewrite[:80],
                )
        except Exception:
            logger.warning(
                "Query expansion failed; continuing without it",
                exc_info=True,
            )

    # 3. Combine using RRF (all available lists)
    chunks = reciprocal_rank_fusion(
        vector_results,
        keyword_results,
        top_k=top_k,
        summary_results=summary_results if summary_results else None,
        expansion_results=expansion_results if expansion_results else None,
    )

    return remove_duplicate_chunks(chunks)


def ask_rag(
    question: str,
    document_id: str | None = None,
    use_summaries: bool | None = None
):
    chunks = retrieve_candidates(
        question,
        document_id=document_id,
        use_summaries=use_summaries,
        top_k=10
    )

    # 2. Rerank with Cohere (with fallback to RRF order on failure).
    rerank_succeeded = True
    try:
        chunks = rerank_chunks(
            query=question,
            chunks=chunks,
            top_k=5
        )
    except Exception:
        logger.warning(
            "Cohere reranking failed; falling back to RRF order",
            exc_info=True,
        )
        chunks = chunks[:5]
        rerank_succeeded = False

    # 3b. Keep only chunks that are actually relevant to the question.
    #     (Scores only are logged, never the question or document text.)
    if rerank_succeeded:
        min_score = get_min_rerank_score()

        logger.info(
            "Rerank scores (kept if >= %.2f): %s",
            min_score,
            [round(chunk["rerank_score"], 3) for chunk in chunks]
        )

        chunks = [
            chunk
            for chunk in chunks
            if chunk.get("rerank_score", 0.0) >= min_score
        ]

    # 4. Check whether we found anything relevant
    if not chunks:
        return {
            "answer": NOT_FOUND_ANSWER,
            "sources": []
        }

    # 5. Build context with multimodal evidence (tables, images).
    context_parts = []
    for chunk in chunks:
        element_type = chunk.get("element_type", "Text")
        page = chunk.get("page_number")
        page_label = f" [page {page}]" if page else ""

        if element_type == "Table":
            table_html = chunk.get("table_html")
            if table_html:
                context_parts.append(
                    f"[Table{page_label}]:\n{chunk['content']}\n"
                    f"Table HTML:\n{table_html}"
                )
            else:
                context_parts.append(
                    f"[Table{page_label}]:\n{chunk['content']}"
                )
        elif element_type == "Image":
            caption = chunk.get("image_caption")
            if caption and not caption.startswith("[Image not analyzed"):
                context_parts.append(f"[Image{page_label}]: {caption}")
            else:
                context_parts.append(
                    f"[Image{page_label}]: {chunk['content']}"
                )
        else:
            context_parts.append(chunk["content"])

    context = "\n\n".join(context_parts)

    # 6. Send context to LLM
    answer = generate_answer(
        question=question,
        context=context
    )

    # 6b. If the model says it could not find the answer, do not show
    #     chunks that were not used to answer.
    if is_not_found_answer(answer):
        return {
            "answer": NOT_FOUND_ANSWER,
            "sources": []
        }

    # 7. Prepare sources with multimodal metadata
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
            "rerank_score": chunk.get("rerank_score"),
            "element_type": chunk.get("element_type"),
            "table_html": chunk.get("table_html"),
            "image_caption": chunk.get("image_caption"),
            # True only when a real image file was stored — an image chunk
            # whose upload failed will have element_type="Image" but no path.
            "has_image": bool(chunk.get("image_storage_path")),
        })

    return {
        "answer": answer,
        "sources": sources
    }