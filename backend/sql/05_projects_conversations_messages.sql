-- =============================================================================
-- Migration 05: projects, conversations, messages
--
-- Creates three new tables and their indexes.
-- Safe to re-run (uses IF NOT EXISTS throughout).
--
-- Run this in the Supabase SQL editor ONCE before starting the backend.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at current automatically.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       text NOT NULL DEFAULT 'New conversation',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_project_id_idx
    ON conversations(project_id);

DROP TRIGGER IF EXISTS conversations_set_updated_at ON conversations;
CREATE TRIGGER conversations_set_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- sources is stored as JSONB — it holds the array of source chunks exactly
-- as the /ask endpoint returns them, so no extra normalisation is needed.
CREATE TABLE IF NOT EXISTS messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             text NOT NULL CHECK (role IN ('user', 'assistant')),
    content          text NOT NULL,
    sources          jsonb,          -- null for user messages, array for assistant
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
    ON messages(conversation_id);

-- ---------------------------------------------------------------------------
-- ROLLBACK (reverse order):
--
--   DROP TABLE IF EXISTS messages;
--   DROP TABLE IF EXISTS conversations;
--   DROP TABLE IF EXISTS projects;
--   DROP FUNCTION IF EXISTS set_updated_at();
-- ---------------------------------------------------------------------------
