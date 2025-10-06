-- migrations/20251005_memory.sql
-- Persistent memory tables for Assistant Override and Eidolon

-- Requires: CREATE EXTENSION IF NOT EXISTS "pgcrypto"; for gen_random_uuid(), or use uuid-ossp.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS assistant_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,              -- e.g., "assistant", "session"
  key TEXT NOT NULL,                -- e.g., "user_profile", "triad_rules"
  user_id TEXT NULL,                -- optional subject
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_memory_idx
  ON assistant_memory (scope, key, COALESCE(user_id, ''));

CREATE TABLE IF NOT EXISTS eidolon_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id TEXT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS eidolon_memory_idx
  ON eidolon_memory (scope, key, COALESCE(user_id, ''));

CREATE TABLE IF NOT EXISTS eidolon_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional helper to expire on update
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_assistant ON assistant_memory;
CREATE TRIGGER trg_touch_assistant BEFORE UPDATE ON assistant_memory
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_eidolon ON eidolon_memory;
CREATE TRIGGER trg_touch_eidolon BEFORE UPDATE ON eidolon_memory
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
