-- =====================================================================
-- Step 3: keyword search should match ANY keyword (ranked), not ALL.
--
-- Problem: search_document_chunks used websearch_to_tsquery(), which ANDs
-- every word. A chunk had to contain every keyword of the question, so
-- long questions returned few or no keyword results.
--
-- Fix: build an OR tsquery from the stemmed keywords. ts_rank() then puts
-- chunks that match more keywords first.
--
-- Unchanged: signature, returned columns, GIN index usage (same
-- to_tsvector('english', content) expression), the Python retriever,
-- and the vector search.
--
-- ROLLBACK: re-run the search_document_chunks definition from
--           sql/00_baseline_schema_observed.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helper: "python machine learning" -> 'python' | 'machin' | 'learn'
--    Uses the same 'english' config as the GIN index, so lexemes match.
--    Every lexeme is quoted, so user text can never inject tsquery
--    operators. Stop-words only / empty input -> NULL (matches nothing).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.keywords_to_or_tsquery(keywords text)
 RETURNS tsquery
 LANGUAGE sql
 STABLE
AS $function$
    SELECT (
        SELECT string_agg(quote_literal(l.lexeme), ' | ')
        FROM unnest(to_tsvector('english', coalesce(keywords, ''))) AS l
    )::tsquery;
$function$;


-- ---------------------------------------------------------------------
-- 2. Keyword search (same signature and columns as before)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_document_chunks(
    search_query text,
    match_count integer DEFAULT 5,
    filter_document_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, document_id uuid, content text, chunk_index integer,
               page_number integer, rank double precision)
 LANGUAGE sql
AS $function$
    SELECT
        document_chunks.id,
        document_chunks.document_id,
        document_chunks.content,
        document_chunks.chunk_index,
        document_chunks.page_number,

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
-- 3. Cleanup: remove the obsolete 2-argument overload (it returned no
--    page_number and made RPC calls without filter_document_id ambiguous).
--    The application always calls the 3-argument version.
--
--    ROLLBACK (original definition):
--      CREATE OR REPLACE FUNCTION public.match_document_chunks(
--          query_embedding vector, match_count integer DEFAULT 5)
--       RETURNS TABLE(id uuid, document_id uuid, content text,
--                     chunk_index integer, similarity double precision)
--       LANGUAGE sql AS $f$
--          select document_chunks.id, document_chunks.document_id,
--                 document_chunks.content, document_chunks.chunk_index,
--                 1 - (document_chunks.embedding <=> query_embedding) as similarity
--          from document_chunks
--          where document_chunks.embedding is not null
--          order by document_chunks.embedding <=> query_embedding
--          limit match_count;
--       $f$;
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, integer);