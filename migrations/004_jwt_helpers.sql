-- Migration 004: JWT Helper Functions for RLS
-- This migration creates helper functions to extract JWT claims
-- from the request.jwt.claims setting that Neon populates when
-- a valid JWT is provided via Authorization: Bearer <token>

-- Create app schema for utility functions
CREATE SCHEMA IF NOT EXISTS app;

-- Helper: Extract 'sub' (user_id) from JWT claims
CREATE OR REPLACE FUNCTION app.jwt_sub() 
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub');
$$;

COMMENT ON FUNCTION app.jwt_sub() IS 
'Extract the subject (user_id) from JWT claims. Returns NULL if no valid JWT.';

-- Helper: Extract 'tenant_id' from JWT claims
CREATE OR REPLACE FUNCTION app.jwt_tenant() 
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id');
$$;

COMMENT ON FUNCTION app.jwt_tenant() IS 
'Extract the tenant_id from JWT claims. Returns NULL if no valid JWT or no tenant_id claim.';

-- Helper: Extract 'role' from JWT claims
CREATE OR REPLACE FUNCTION app.jwt_role() 
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
$$;

COMMENT ON FUNCTION app.jwt_role() IS 
'Extract the role from JWT claims. Returns NULL if no valid JWT.';

-- Helper: Check if authenticated (has valid JWT)
CREATE OR REPLACE FUNCTION app.is_authenticated() 
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true) IS NOT NULL 
    AND current_setting('request.jwt.claims', true)::jsonb ->> 'sub' IS NOT NULL;
$$;

COMMENT ON FUNCTION app.is_authenticated() IS 
'Returns true if a valid JWT with sub claim is present.';

-- Helper: Get full JWT claims as JSONB
CREATE OR REPLACE FUNCTION app.jwt_claims() 
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb;
$$;

COMMENT ON FUNCTION app.jwt_claims() IS 
'Returns the full JWT claims as JSONB. Returns NULL if no valid JWT.';

-- Grant execute permissions to public (needed for RLS policies)
GRANT EXECUTE ON FUNCTION app.jwt_sub() TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.jwt_tenant() TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.jwt_role() TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_authenticated() TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.jwt_claims() TO PUBLIC;

-- Example RLS policies using these helpers (commented out - apply per table as needed)

/*
-- Example: User-scoped RLS on snapshots table
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_snapshots_select ON snapshots;
DROP POLICY IF EXISTS p_snapshots_write ON snapshots;

CREATE POLICY p_snapshots_select ON snapshots
  FOR SELECT TO PUBLIC
  USING (app.is_authenticated() AND user_id = app.jwt_sub());

CREATE POLICY p_snapshots_write ON snapshots
  FOR ALL TO PUBLIC
  USING (user_id = app.jwt_sub())
  WITH CHECK (user_id = app.jwt_sub());
*/

/*
-- Example: Tenant-scoped RLS (if you add tenant_id to tables)
CREATE POLICY p_snapshots_tenant_select ON snapshots
  FOR SELECT TO PUBLIC
  USING (app.is_authenticated() AND tenant_id = app.jwt_tenant());
*/

-- Verification query (run this to test JWT extraction after registering JWKS):
-- SELECT 
--   app.is_authenticated() as is_authed,
--   app.jwt_sub() as user_id,
--   app.jwt_tenant() as tenant_id,
--   app.jwt_role() as role,
--   app.jwt_claims() as full_claims;
