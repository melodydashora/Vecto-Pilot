-- 2026-04-16: Add driver preference columns to driver_profiles
-- Source: docs/review-queue/pending.md §Driver Prefs (lines 31-36)
-- Consumed by: server/lib/ai/providers/consolidator.js loadDriverPreferences()
-- Also consumed by: server/lib/strategy/tactical-planner.js (beyond_deadhead flagging)
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;

COMMENT ON COLUMN driver_profiles.fuel_economy_mpg IS 'Driver vehicle fuel economy in mpg (null = use default 25). Used by strategist prompt for per-mile gas cost math. Ignored when attr_electric = true.';
COMMENT ON COLUMN driver_profiles.earnings_goal_daily IS 'Driver daily earnings target in local currency (null = goal not set). Used by strategist to compute required $/hr for the shift.';
COMMENT ON COLUMN driver_profiles.shift_hours_target IS 'Driver target shift length in hours (null = target not set). Paired with earnings_goal_daily for $/hr pacing.';
COMMENT ON COLUMN driver_profiles.max_deadhead_mi IS 'Max miles the driver will drive empty for a pickup (null = use default 15). Used by tactical planner for beyond_deadhead flagging.';
