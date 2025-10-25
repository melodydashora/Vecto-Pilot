-- Memory Tables for Vecto Pilot™
-- Creates assistant_memory, eidolon_memory, and cross_thread_memory tables
-- These tables store conversation history, user preferences, and cross-session context

-- Trigger function for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Assistant Memory (conversations, user preferences)
CREATE TABLE IF NOT EXISTS assistant_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id TEXT,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create unique index handling NULL user_id
CREATE UNIQUE INDEX IF NOT EXISTS assistant_memory_idx 
  ON assistant_memory (scope, key, COALESCE(user_id, ''));

CREATE UNIQUE INDEX IF NOT EXISTS unique_scope_key 
  ON assistant_memory (scope, key);

CREATE TRIGGER trg_touch_assistant
  BEFORE UPDATE ON assistant_memory
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

-- 2. Eidolon Memory (session state, project state)
CREATE TABLE IF NOT EXISTS eidolon_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id TEXT,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create unique index handling NULL user_id
CREATE UNIQUE INDEX IF NOT EXISTS eidolon_memory_idx 
  ON eidolon_memory (scope, key, COALESCE(user_id, ''));

CREATE TRIGGER trg_touch_eidolon
  BEFORE UPDATE ON eidolon_memory
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

-- 3. Cross-Thread Memory (shared context across threads) - already created, ensure structure
DROP TABLE IF EXISTS cross_thread_memory CASCADE;

CREATE TABLE cross_thread_memory (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id UUID,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (scope, key, user_id)
);

-- Analyze tables for query optimization
ANALYZE assistant_memory;
ANALYZE eidolon_memory;
ANALYZE cross_thread_memory;
