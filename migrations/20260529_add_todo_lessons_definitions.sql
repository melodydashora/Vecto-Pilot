-- 2026-05-29: Repo-clarity rebuild — BUILD STEP 1 (PURELY ADDITIVE)
-- Creates three NEW tables: todo, lessons_learned, definitions.
--
-- ADDITIVE GUARANTEES — this migration:
--   • Does NOT touch, alter, or drop claude_memory or any existing table.
--   • Does NOT read, lock, constrain, or reference any existing table.
--   • Uses CREATE TABLE IF NOT EXISTS, so it is safe to re-run and safe on a clean DB.
--   • Contains zero ALTER / DROP / TRUNCATE / UPDATE / DELETE statements.
--   • claude_memory and all its existing rows are untouched.
--
-- COLUMN STYLE — mirrors claude_memory (shared/schema.js:2267):
--   • SERIAL primary keys, snake_case column names.
--   • created_at / updated_at are TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
--     (claude_memory's timestamps are .notNull().defaultNow(); the spec said
--     "timestamptz default now()" and asked for consistency with claude_memory,
--     so NOT NULL is applied to match — a DEFAULT NOW() column is never null in
--     practice anyway).
--   • todo.status is enforced with a CHECK constraint (added per BUILD STEP 1
--     approval, 2026-05-29). The remaining enum-like columns — todo.priority and
--     lessons_learned.severity — are documented in comments only, matching how
--     claude_memory documents category/status/priority.
--   • updated_at is maintained by application code (no DB trigger), exactly as
--     claude_memory does it (see server/api/memory/index.js PATCH handler).
--
-- NOTE on todo.source_memory_id: a LOGICAL reference to claude_memory.id,
-- intentionally implemented WITHOUT a foreign-key constraint — mirroring
-- claude_memory.parent_id, which is itself a bare INTEGER self-reference with no
-- FK. Omitting the FK is what keeps this migration additive: a real FK would take
-- a lock on claude_memory and impose a referential constraint on its future
-- deletes, which would violate the "do not touch claude_memory" rule.

-- ============================================================================
-- 1. todo — actionable task queue (a task may be spawned from a claude_memory row)
-- ============================================================================
CREATE TABLE IF NOT EXISTS todo (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  detail            TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'wontfix')),
  priority          INTEGER DEFAULT 3,
  source_memory_id  INTEGER,                        -- logical ref to claude_memory.id (no FK; mirrors claude_memory.parent_id)
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. lessons_learned — durable lessons + the rule each one produced
-- ============================================================================
CREATE TABLE IF NOT EXISTS lessons_learned (
  id          SERIAL PRIMARY KEY,
  lesson      TEXT NOT NULL,
  trigger     TEXT,                                 -- what caused it (PostgreSQL non-reserved keyword; valid unquoted)
  rule        TEXT,                                 -- the resulting rule (PostgreSQL non-reserved keyword; valid unquoted)
  severity    TEXT DEFAULT 'medium',
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. definitions — canonical glossary of terms used across the repo
-- ============================================================================
CREATE TABLE IF NOT EXISTS definitions (
  id          SERIAL PRIMARY KEY,
  term        TEXT NOT NULL UNIQUE,                 -- UNIQUE → implicit index "definitions_term_key"
  meaning     TEXT NOT NULL,
  location    TEXT,                                 -- canonical file/path or tab where it lives
  aliases     TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
