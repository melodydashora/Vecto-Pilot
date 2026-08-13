-- migrations/20260703_offer_rulesets_outcomes.sql
-- Todo #10: per-driver DB-backed Offer Analyzer rules + driver-actual outcome capture.
-- Design: docs/architecture/OFFER_RULESET_V3_DESIGN.md (§4 identity, §5 storage).
--
-- Three additive surfaces (no drops/alters of existing data):
--   1. offer_rulesets   — one editable ruleset per user (jsonb, versioned, hashed)
--   2. offer_outcomes   — what the driver ACTUALLY did (distinct from the analyzer's
--                         decision AND from offer_intelligence.user_override).
--                         ⚠️ ON DELETE SET NULL protects against row DELETEs only.
--                         TRUNCATE is different: plain TRUNCATE of offer_intelligence
--                         now FAILS (FK-referenced), and TRUNCATE..CASCADE would WIPE
--                         offer_outcomes (verified against live Postgres 2026-07-03).
--                         The 20260505 runbook's reset must use DELETE FROM, not
--                         TRUNCATE — see the corrected note in that file.
--   3. provenance/token columns on offer_intelligence + driver_profiles
--
-- FK note: users rows are session-scoped but NEVER deleted (cleared via UPDATE,
-- auth.js:206-215), so ON DELETE RESTRICT mirrors driver_profiles and preserves
-- outcome rows for ML rather than cascading (deviation from the 2026-06-01 plan
-- doc's CASCADE, deliberate — see design §5).

CREATE TABLE IF NOT EXISTS offer_rulesets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,

  -- Bumps on every save; stamped onto offer_intelligence rows analyzed under it.
  version INTEGER NOT NULL DEFAULT 1,

  -- Full ruleset config (RULESET_SCHEMA_VERSION >= 3 shape; validated by Zod at
  -- write time in server/api/offer-analyzer/index.js — invalid configs cannot persist).
  config JSONB NOT NULL,

  -- sha256 of canonical JSON; provenance key for "which exact rules decided this offer".
  config_hash TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN offer_rulesets.config_hash IS
  'sha256 hex of canonicalized config JSON; offer_intelligence.ruleset_hash references it (no FK — offers keep the hash even if rules change)';

CREATE TABLE IF NOT EXISTS offer_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  offer_intelligence_id UUID REFERENCES offer_intelligence(id) ON DELETE SET NULL,

  -- The driver's ACTUAL action — ground truth, not the analyzer's recommendation.
  driver_decision  TEXT CHECK (driver_decision IN ('Accepted','Rejected','Cancelled','Completed')),
  driver_reasoning TEXT,

  -- Realized earnings (meaningful when Accepted/Completed).
  actual_pay     DOUBLE PRECISION,
  reimbursements DOUBLE PRECISION,
  extras         DOUBLE PRECISION,
  other          DOUBLE PRECISION,
  total_earned   DOUBLE PRECISION GENERATED ALWAYS AS (
    COALESCE(actual_pay,0) + COALESCE(reimbursements,0) + COALESCE(extras,0) + COALESCE(other,0)
  ) STORED,

  outcome_source TEXT NOT NULL DEFAULT 'web_app',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One outcome per analyzed offer (upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_outcome_offer
  ON offer_outcomes (offer_intelligence_id)
  WHERE offer_intelligence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outcome_user_created
  ON offer_outcomes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outcome_decision
  ON offer_outcomes (driver_decision)
  WHERE driver_decision IS NOT NULL;

-- Provenance stamps: which rules (and whose) produced each stored analysis.
-- NULL ruleset_hash = DEFAULT_RULESET was applied (visible degradation, never silent).
ALTER TABLE offer_intelligence ADD COLUMN IF NOT EXISTS ruleset_version INTEGER;
ALTER TABLE offer_intelligence ADD COLUMN IF NOT EXISTS ruleset_hash TEXT;

-- Identity bridge: unguessable per-user token carried by the Siri Shortcut
-- (X-Shortcut-Token header or shortcut_token form field). Mirrors the
-- concierge_share_token precedent; system-generated only, never user-chosen.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS shortcut_token VARCHAR(43) UNIQUE;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS shortcut_token_created_at TIMESTAMPTZ;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS shortcut_device_label TEXT;

CREATE INDEX IF NOT EXISTS idx_dp_shortcut_token
  ON driver_profiles (shortcut_token)
  WHERE shortcut_token IS NOT NULL;
