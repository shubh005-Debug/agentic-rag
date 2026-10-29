-- =====================================================================
-- Step 6: multimodal document RAG — add element-type, table HTML, and
-- image-reference columns to document_chunks and status columns to
-- documents.
--
-- All columns are nullable and additive.  Existing rows get NULL for
-- every new column.  No existing column or constraint is changed.
--
-- ROLLBACK:
--   ALTER TABLE document_chunks
--     DROP COLUMN IF EXISTS element_type,
--     DROP COLUMN IF EXISTS table_html,
--     DROP COLUMN IF EXISTS image_storage_path,
--     DROP COLUMN IF EXISTS image_mime_type,
--     DROP COLUMN IF EXISTS image_caption;
--   ALTER TABLE documents
--     DROP COLUMN IF EXISTS total_chunks,
--     DROP COLUMN IF EXISTS element_counts,
--     DROP COLUMN IF EXISTS summary_status;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. document_chunks: multimodal metadata
-- ---------------------------------------------------------------------
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS element_type       text,     -- "Text" | "Table" | "Image"
  ADD COLUMN IF NOT EXISTS table_html         text,     -- HTML representation (frontend rendering)
  ADD COLUMN IF NOT EXISTS image_storage_path text,     -- Supabase Storage path for the image
  ADD COLUMN IF NOT EXISTS image_mime_type    text,     -- e.g. "image/png"
  ADD COLUMN IF NOT EXISTS image_caption      text;     -- vision-model caption or "not analyzed" marker


-- ---------------------------------------------------------------------
-- 2. documents: ingestion summary and summary-pipeline status for the UI
-- ---------------------------------------------------------------------
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS total_chunks    integer,  -- chunk count (set after ingestion)
  ADD COLUMN IF NOT EXISTS element_counts  jsonb,    -- {"Text": 45, "Table": 3, "Image": 7}
  ADD COLUMN IF NOT EXISTS summary_status  text;
  -- summary_status lifecycle (set by the background summarisation task):
  --   NULL          → summarisation not yet queued
  --   "processing"  → actively summarising
  --   "done"        → all chunks have a summary embedding
  --   "partial"     → some chunks could not be summarised (quota / errors)
  --   "skipped"     → document exceeded SUMMARY_MAX_CHUNKS limit
  --   "failed"      → task raised an unhandled exception
