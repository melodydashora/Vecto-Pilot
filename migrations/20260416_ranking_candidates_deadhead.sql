-- 2026-04-16: Add driver preference scoring fields to ranking_candidates
-- Source: tactical-planner.js beyond_deadhead haversine pass
-- Consumed by: transformers.js toApiBlock() → client venue cards
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run

ALTER TABLE ranking_candidates
  ADD COLUMN IF NOT EXISTS beyond_deadhead boolean,
  ADD COLUMN IF NOT EXISTS distance_from_home_mi double precision;

COMMENT ON COLUMN ranking_candidates.beyond_deadhead IS 'True when venue distance from home exceeds driver max_deadhead_mi. Set by tactical planner post-resolver. Null = not computed (home coords missing).';
COMMENT ON COLUMN ranking_candidates.distance_from_home_mi IS 'Straight-line haversine distance in miles from driver home to venue. Null = home coords missing.';
