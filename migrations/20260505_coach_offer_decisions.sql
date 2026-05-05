-- migrations/20260505_coach_offer_decisions.sql
-- Adds coach_offer_decisions: driver-decision intel logged from the Coach chat tab.
--
-- Companion to offer_intelligence:
--   - offer_intelligence = raw event log (every Siri-ingested offer, may be undecided)
--   - coach_offer_decisions = decision log (only offers Melody actively reviewed
--     and committed a verdict on, with screenshot + reasoning)
--
-- The Coach has read+write on both tables. Ground-truth fields from this table
-- can backfill nulls on the linked offer_intelligence row.
--
-- See claudeMd Rule 8 for write-access ownership; this migration extends it.

CREATE TABLE IF NOT EXISTS coach_offer_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linkage
  user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  conversation_id       UUID,
  snapshot_id           UUID REFERENCES snapshots(snapshot_id) ON DELETE SET NULL,
  offer_intelligence_id UUID REFERENCES offer_intelligence(id) ON DELETE SET NULL,

  -- Core offer data (raw numbers from screenshot OCR)
  platform        TEXT,
  ride_tier       TEXT,
  fare_amount     DOUBLE PRECISION,
  pickup_miles    DOUBLE PRECISION,
  pickup_minutes  INTEGER,
  trip_miles      DOUBLE PRECISION,
  trip_minutes    INTEGER,

  -- Location
  pickup_location  TEXT,
  dropoff_location TEXT,
  surge_attached   DOUBLE PRECISION,

  -- Computed intelligence
  dollar_per_mile  DOUBLE PRECISION,
  dollar_per_hour  DOUBLE PRECISION,
  deadhead_risk    TEXT,  -- 'HIGH' | 'MEDIUM' | 'LOW'

  -- AI verdict
  ai_recommendation TEXT, -- 'ACCEPT' | 'REJECT' | 'CANCEL' (matches offer_intelligence.decision casing)
  ai_reasoning      TEXT,

  -- Driver verdict — the learning signal
  user_decision  TEXT,  -- 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed'
  user_reasoning TEXT,  -- Driver's "why" — overrides AI when wrong

  -- Asset
  screenshot_url TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cod_user_created
  ON coach_offer_decisions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cod_offer_intel
  ON coach_offer_decisions (offer_intelligence_id)
  WHERE offer_intelligence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cod_agreement
  ON coach_offer_decisions (ai_recommendation, user_decision)
  WHERE user_decision IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cod_conversation
  ON coach_offer_decisions (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cod_snapshot
  ON coach_offer_decisions (snapshot_id)
  WHERE snapshot_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- MANUAL TRUNCATE (DO NOT auto-run during deploys; run manually after publish):
--
--   TRUNCATE TABLE offer_intelligence;
--
-- This resets offer_intelligence for "real prod" data after the testing era.
-- Coach's coach_offer_decisions rows survive (FK is ON DELETE SET NULL).
-- ────────────────────────────────────────────────────────────────────────────
