# SQL Migrations

All migrations target the Supabase PostgreSQL database.
Run them **in the order listed below** using the Supabase SQL editor or `psql`.
Each file is idempotent (`CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`) and safe to re-run.

---

## Required run order

| # | File | Purpose |
|---|------|---------|
| 1 | `01_keyword_search_or.sql` | Replaces `search_document_chunks` with an OR-keyword variant; adds `keywords_to_or_tsquery` helper; drops the obsolete 2-argument overload of `match_document_chunks`. |
| 2 | `02_summary_search.sql` | Adds `summary_embedding` column and HNSW index on `document_chunks`; creates `match_chunk_summaries` RPC. **Must run before `04`** — `04` replaces this function with an extended version. |
| 3 | `03_multimodal_columns.sql` | Adds multimodal columns to `document_chunks` (`element_type`, `table_html`, `image_storage_path`, `image_mime_type`, `image_caption`) and to `documents` (`total_chunks`, `element_counts`, `summary_status`). **Must run before `04`** — `04`'s SELECT clause references these columns. |
| 4 | `04_multimodal_rpc.sql` | Replaces all three retrieval RPCs (`match_document_chunks`, `search_document_chunks`, `match_chunk_summaries`) to include the new multimodal columns in their return types. |

---

## Prerequisites

- `pgvector` extension must be enabled (`CREATE EXTENSION IF NOT EXISTS vector`).
- The `documents` and `document_chunks` tables must exist (baseline schema).
- The `documents` table must already have a `summary_status` column **or** migration `03` must be run on a fresh database (it adds the column with `IF NOT EXISTS`).

---

## Verification after each migration

After running a migration, confirm it applied cleanly:

```sql
-- After 01: confirm the OR-keyword helper exists
SELECT proname FROM pg_proc WHERE proname = 'keywords_to_or_tsquery';

-- After 02: confirm summary_embedding column and index exist
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'document_chunks' AND column_name = 'summary_embedding';

SELECT indexname FROM pg_indexes
  WHERE tablename = 'document_chunks' AND indexname = 'document_chunks_summary_embedding_idx';

-- After 03: confirm multimodal columns exist
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'document_chunks'
    AND column_name IN ('element_type','table_html','image_storage_path','image_mime_type','image_caption');

SELECT column_name FROM information_schema.columns
  WHERE table_name = 'documents'
    AND column_name IN ('total_chunks','element_counts','summary_status');

-- After 04: confirm updated RPCs exist with the new return columns
SELECT proname, pg_get_function_result(oid) FROM pg_proc
  WHERE proname IN ('match_document_chunks','search_document_chunks','match_chunk_summaries');
```

---

## Rollback

Each file contains a `-- ROLLBACK:` comment with the exact `DROP`/`ALTER` commands needed to undo it. Rollback in **reverse order** (04 → 03 → 02 → 01).

> **Warning:** rolling back `03` drops `image_caption` and `summary_status`. Any data in those columns is permanently lost. Back up the table before rolling back on a database that has processed documents.

---

## Fresh-database install

Run the files in order 01 → 02 → 03 → 04. All four must be applied for the full multimodal pipeline to work correctly.
