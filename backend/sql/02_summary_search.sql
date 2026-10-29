-- =====================================================================
-- Step 5b: vector search over chunk SUMMARY embeddings.
--
-- Returns the same columns as match_document_chunks, and the ORIGINAL
-- chunk text (not the summary): summaries are only used to FIND chunks.
-- Chunks without a summary embedding are ignored.
-- Safe to run more than once. Nothing existing is changed.
--
-- NOTE: like match_document_chunks, filtering by document_id on an HNSW
-- index can return fewer than match_count rows on very large tables.
-- Revisit both functions together (pgvector 0.8 iterative scans) if the
-- corpus grows large.
--
-- ROLLBACK:
--   drop function if exists public.match_chunk_summaries(vector, integer, uuid);
--   drop index if exists public.document_chunks_summary_embedding_idx;
-- =====================================================================

CREATE INDEX IF NOT EXISTS document_chunks_summary_embedding_idx
    ON public.document_chunks USING hnsw (summary_embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_chunk_summaries(
    query_embedding vector,
    match_count integer DEFAULT 5,
    filter_document_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, document_id uuid, content text, chunk_index integer,
               page_number integer, similarity double precision)
 LANGUAGE sql
AS $function$
    SELECT
        document_chunks.id,
        document_chunks.document_id,
        document_chunks.content,
        document_chunks.chunk_index,
        document_chunks.page_number,
        1 - (document_chunks.summary_embedding <=> query_embedding) AS similarity
    FROM document_chunks
    WHERE document_chunks.summary_embedding IS NOT NULL
      AND (
          filter_document_id IS NULL
          OR document_chunks.document_id = filter_document_id
      )
    ORDER BY document_chunks.summary_embedding <=> query_embedding
    LIMIT match_count;
$function$;