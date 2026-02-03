-- Row Level Security (RLS) Implementation for Vecto Pilot™
-- Secures all tables with user-scoped policies using session variables

-- 1. Create app schema and helper functions
CREATE SCHEMA IF NOT EXISTS app;

-- Helper function to get current user from session variable
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Helper function to get current session from session variable
CREATE OR REPLACE FUNCTION app.current_session_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.session_id', true), '')::uuid
$$;

-- 2. Create app_user role for application access
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- 3. Lock down default PUBLIC access
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM public;

-- 4. Grant privileges to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 5. Enable RLS on all tables
ALTER TABLE snapshots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE triad_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_feedback      ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE eidolon_memory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_thread_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory        ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_venue_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE http_idem           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_candidates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE places_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rankings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_disruptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_feedback   ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_catalog       ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_memory    ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies for user-scoped tables

-- snapshots: user_id column
DROP POLICY IF EXISTS p_select ON snapshots;
DROP POLICY IF EXISTS p_write ON snapshots;

CREATE POLICY p_select ON snapshots
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON snapshots
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- actions: user_id column
DROP POLICY IF EXISTS p_select ON actions;
DROP POLICY IF EXISTS p_write ON actions;

CREATE POLICY p_select ON actions
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON actions
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- rankings: user_id column
DROP POLICY IF EXISTS p_select ON rankings;
DROP POLICY IF EXISTS p_write ON rankings;

CREATE POLICY p_select ON rankings
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON rankings
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- venue_feedback: user_id column
DROP POLICY IF EXISTS p_select ON venue_feedback;
DROP POLICY IF EXISTS p_write ON venue_feedback;

CREATE POLICY p_select ON venue_feedback
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON venue_feedback
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- strategy_feedback: user_id column
DROP POLICY IF EXISTS p_select ON strategy_feedback;
DROP POLICY IF EXISTS p_write ON strategy_feedback;

CREATE POLICY p_select ON strategy_feedback
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON strategy_feedback
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- assistant_memory: user_id column (TEXT type)
DROP POLICY IF EXISTS p_select ON assistant_memory;
DROP POLICY IF EXISTS p_write ON assistant_memory;

CREATE POLICY p_select ON assistant_memory
  FOR SELECT
  USING (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON assistant_memory
  FOR ALL
  USING (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL);

-- eidolon_memory: user_id column (TEXT type)
DROP POLICY IF EXISTS p_select ON eidolon_memory;
DROP POLICY IF EXISTS p_write ON eidolon_memory;

CREATE POLICY p_select ON eidolon_memory
  FOR SELECT
  USING (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON eidolon_memory
  FOR ALL
  USING (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id()::text OR app.current_user_id() IS NULL);

-- cross_thread_memory: user_id column
DROP POLICY IF EXISTS p_select ON cross_thread_memory;
DROP POLICY IF EXISTS p_write ON cross_thread_memory;

CREATE POLICY p_select ON cross_thread_memory
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

CREATE POLICY p_write ON cross_thread_memory
  FOR ALL
  USING (user_id = app.current_user_id() OR app.current_user_id() IS NULL)
  WITH CHECK (user_id = app.current_user_id() OR app.current_user_id() IS NULL);

-- 7. Public read-only tables (catalog data)

-- places_cache: public read
DROP POLICY IF EXISTS public_read ON places_cache;
CREATE POLICY public_read ON places_cache
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS system_write ON places_cache;
CREATE POLICY system_write ON places_cache
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- venue_catalog: public read
DROP POLICY IF EXISTS public_read ON venue_catalog;
CREATE POLICY public_read ON venue_catalog
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS system_write ON venue_catalog;
CREATE POLICY system_write ON venue_catalog
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- 8. Session-scoped tables (no user_id, use session_id from snapshots)

-- strategies: linked via snapshot_id
DROP POLICY IF EXISTS p_select ON strategies;
DROP POLICY IF EXISTS p_write ON strategies;

CREATE POLICY p_select ON strategies
  FOR SELECT
  USING (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM snapshots s
      WHERE s.snapshot_id = strategies.snapshot_id
      AND (s.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  );

CREATE POLICY p_write ON strategies
  FOR ALL
  USING (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM snapshots s
      WHERE s.snapshot_id = strategies.snapshot_id
      AND (s.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  )
  WITH CHECK (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM snapshots s
      WHERE s.snapshot_id = strategies.snapshot_id
      AND (s.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  );

-- ranking_candidates: linked via ranking_id -> rankings.user_id
DROP POLICY IF EXISTS p_select ON ranking_candidates;
DROP POLICY IF EXISTS p_write ON ranking_candidates;

CREATE POLICY p_select ON ranking_candidates
  FOR SELECT
  USING (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM rankings r
      WHERE r.ranking_id = ranking_candidates.ranking_id
      AND (r.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  );

CREATE POLICY p_write ON ranking_candidates
  FOR ALL
  USING (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM rankings r
      WHERE r.ranking_id = ranking_candidates.ranking_id
      AND (r.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  )
  WITH CHECK (
    app.current_user_id() IS NULL OR
    EXISTS (
      SELECT 1 FROM rankings r
      WHERE r.ranking_id = ranking_candidates.ranking_id
      AND (r.user_id = app.current_user_id() OR app.current_user_id() IS NULL)
    )
  );

-- 9. System-only tables (no user access, only via app)

-- triad_jobs: system-only
DROP POLICY IF EXISTS system_access ON triad_jobs;
CREATE POLICY system_access ON triad_jobs
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- http_idem: system-only
DROP POLICY IF EXISTS system_access ON http_idem;
CREATE POLICY system_access ON http_idem
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- venue_metrics: system-only
DROP POLICY IF EXISTS system_access ON venue_metrics;
CREATE POLICY system_access ON venue_metrics
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- llm_venue_suggestions: system-only
DROP POLICY IF EXISTS system_access ON llm_venue_suggestions;
CREATE POLICY system_access ON llm_venue_suggestions
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- agent_memory: system-only
DROP POLICY IF EXISTS system_access ON agent_memory;
CREATE POLICY system_access ON agent_memory
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- travel_disruptions: system-only
DROP POLICY IF EXISTS system_access ON travel_disruptions;
CREATE POLICY system_access ON travel_disruptions
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- app_feedback: allow all users to submit
DROP POLICY IF EXISTS p_select ON app_feedback;
DROP POLICY IF EXISTS p_write ON app_feedback;

CREATE POLICY p_select ON app_feedback
  FOR SELECT
  USING (true);

CREATE POLICY p_write ON app_feedback
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Verify RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
