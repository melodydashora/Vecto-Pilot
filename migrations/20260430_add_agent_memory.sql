-- Adds agent_memory table per shared/schema.js:483.
-- Mirrors the cross_thread_memory pattern (UUID user_id, no cast).
-- 003_rls_security.sql:44 enables RLS on this table but defines no
-- policies; this migration fills both gaps in one place + grants
-- app_user privileges that were not retroactive for tables added
-- after 003 ran.

-- Trigger function (idempotent — already created by 002, redeclared
-- here so this migration is safe to run on a clean DB)
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Table
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id UUID,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (scope, key, user_id)
);

-- 2. Indexes (match schema.js definitions)
CREATE INDEX IF NOT EXISTS idx_agent_memory_scope ON agent_memory (scope);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON agent_memory (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory (expires_at);

-- 3. updated_at touch trigger
DROP TRIGGER IF EXISTS trg_touch_agent_memory ON agent_memory;
CREATE TRIGGER trg_touch_agent_memory
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

-- 4. RLS — follows the cross_thread_memory pattern (UUID, no cast)
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_select ON agent_memory;
DROP POLICY IF EXISTS p_write  ON agent_memory;

CREATE POLICY p_select ON agent_memory
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON agent_memory
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- 5. Grants (003's GRANT ON ALL TABLES IN SCHEMA public TO app_user
--    only applied to tables existing at that migration's runtime;
--    new tables need explicit grants)
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memory TO app_user;
