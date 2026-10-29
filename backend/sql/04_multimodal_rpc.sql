-- =====================================================================
-- Step 7: extend the three retrieval RPC functions to also return the
-- multimodal columns (element_type, table_html, image_caption) so the
-- retrieval pipeline can carry original evidence through to the LLM
-- and the frontend.
--
-- The Python callers (retriever.py / rag.py) read these with .get(),
-- so adding columns is safe for older data (NULLs).  The function
-- signatures and existing return columns are unchanged.
--
-- ROLLBACK: re-run the original function definitions from
--           sql/00_baseline_schema_observed.sql (match_document_chunks)
--           and sql/01_keyword_search_or.sql  (search_document_chunks)
--           and sql/02_summary_search.sql     (match_chunk_summaries)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. match_document_chunks (vector search)
--    NOTE: the 2-argument overload was already dropped in step 3.
--    We only need to replace the 3-argument version.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_document_chunks(
    query_embedding vector,
    match_count integer DEFAULT 5,
    filter_document_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, document_id uuid, content text, chunk_index integer,
               page_number integer,
               element_type text,
               table_html text,
               image_caption text,
               similarity double precision)
 LANGUAGE sql
AS $function$
    SELECT
        document_chunks.id,
        document_chunks.document_id,
        document_chunks.content,
        document_chunks.chunk_index,
        document_chunks.page_number,
        document_chunks.element_type,
        document_chunks.table_html,
        document_chunks.image_caption,
        1 - (document_chunks.embedding <=> query_embedding) AS similarity
    FROM document_chunks
    WHERE document_chunks.embedding IS NOT NULL
      AND (
          filter_document_id IS NULL
          OR document_chunks.document_id = filter_document_id
      )
    ORDER BY document_chunks.embedding <=> query_embedding
    LIMIT match_count;
$function$;


-- ---------------------------------------------------------------------
-- 2. search_document_chunks (keyword / full-text search)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_document_chunks(
    search_query text,
    match_count integer DEFAULT 5,
    filter_document_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, document_id uuid, content text, chunk_index integer,
               page_number integer,
               element_type text,
               table_html text,
               image_caption text,
               rank double precision)
 LANGUAGE sql
AS $function$
    SELECT
        document_chunks.id,
        document_chunks.document_id,
        document_chunks.content,
        document_chunks.chunk_index,
        document_chunks.page_number,
        document_chunks.element_type,
        document_chunks.table_html,
        document_chunks.image_caption,

        ts_rank(
            to_tsvector('english', document_chunks.content),
            public.keywords_to_or_tsquery(search_query)
        )::double precision AS rank

    FROM document_chunks

    WHERE
        document_chunks.content IS NOT NULL

        AND to_tsvector('english', document_chunks.content)
            @@ public.keywords_to_or_tsquery(search_query)

        AND (
            filter_document_id IS NULL
            OR document_chunks.document_id = filter_document_id
        )

    ORDER BY rank DESC

    LIMIT match_count;
$function$;


-- ---------------------------------------------------------------------
-- 3. match_chunk_summaries (summary vector search)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_chunk_summaries(
    query_embedding vector,
    match_count integer DEFAULT 5,
    filter_document_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, document_id uuid, content text, chunk_index integer,
               page_number integer,
               element_type text,
               table_html text,
               image_caption text,
               similarity double precision)
 LANGUAGE sql
AS $function$
    SELECT
        document_chunks.id,
        document_chunks.document_id,
        document_chunks.content,
        document_chunks.chunk_index,
        document_chunks.page_number,
        document_chunks.element_type,
        document_chunks.table_html,
        document_chunks.image_caption,
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
