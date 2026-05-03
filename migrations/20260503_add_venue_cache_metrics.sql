-- migrations/20260503_add_venue_cache_metrics.sql
-- Workstream 6 Step 3: API Cache Enforcement — add rolled-up cache counter column.
--
-- Stores per-strategy {hits, misses, hit_rate} from tactical-planner.js's new
-- catalog-first resolve chain. Tied to the strategy row (not rankings) per the
-- 2026-05-03 architectural decision: metric storage must survive degraded runs
-- where rankings may be empty.
--
-- Plan: docs/review-queue/PLAN_workstream6_step3_api_cache_enforcement-2026-05-03.md
-- Locked-in decision: §8, row 1 (Option A).

BEGIN;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS venue_cache_metrics jsonb;

COMMENT ON COLUMN strategies.venue_cache_metrics IS
'Rolled-up venue-catalog cache stats from tactical-planner''s resolve chain.
Shape: {hits: int, misses: int, hit_rate: float|null}.
NULL when the strategy did not run tactical-planner (e.g., snapshot rejected upstream).
Per-call structured logs (matrixLog CACHE_HIT/CACHE_MISS) carry the granular trail;
this column is the operational top-level monitoring surface.';

COMMIT;
