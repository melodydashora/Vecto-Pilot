-- Migration: Lean Tables Cleanup
-- Date: 2026-01-14
-- Purpose: Strip strategies and snapshots tables to their core purpose
--
-- ARCHITECTURE RULES:
-- - snapshots: "Who, Where, When" (User, Location, Time)
-- - briefings: "What is happening" (Weather, Traffic, Events, Airports)
-- - strategies: "What to do" (AI-generated tactical output)
--
-- This migration removes columns that:
-- - Are duplicated in other tables (briefings has events/traffic/news)
-- - Belong in other tables (airport_context → briefings.airport_conditions)
-- - Are no longer used (debug telemetry, legacy fields)
--
-- ============================================================================
-- STEP 1: Clean up STRATEGIES table
-- ============================================================================
-- Retained columns (core functionality):
-- - id, snapshot_id, user_id (identity/linking)
-- - status, phase, phase_started_at (state machine)
-- - strategy_for_now, consolidated_strategy (the product)
-- - error_message (error tracking)
-- - created_at, updated_at (timestamps)

-- Legacy/redundant identity columns
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "strategy_id";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "correlation_id";

-- Legacy strategy columns (replaced by strategy_for_now)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "strategy";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "minstrategy";

-- Redundant location columns (already in snapshots)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "lat";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "lng";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "city";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "state";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "user_address";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "user_resolved_address";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "user_resolved_city";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "user_resolved_state";

-- Redundant briefing columns (already in briefings table)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "events";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "news";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "traffic";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "holiday";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "briefing_news";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "briefing_events";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "briefing_traffic";

-- Unused retry/attempt columns
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "attempt";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "next_retry_at";

-- Debug telemetry (not used in production)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "latency_ms";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "tokens";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "model_name";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "model_params";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "prompt_version";

-- Unused error code (keep error_message)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "error_code";

-- Unused trigger tracking
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "trigger_reason";

-- Unused time windowing (freshness is implicit in created_at + TTL)
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "valid_window_start";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "valid_window_end";
ALTER TABLE "strategies" DROP COLUMN IF EXISTS "strategy_timestamp";

-- ============================================================================
-- STEP 2: Clean up SNAPSHOTS table
-- ============================================================================
-- airport_context is redundant - data belongs in briefings.airport_conditions

ALTER TABLE "snapshots" DROP COLUMN IF EXISTS "airport_context";

-- NOTE: Keeping 'permissions' column for now. Even though it's usually
-- just {geolocation: granted}, it could be useful for debugging and
-- the existence of coordinates doesn't guarantee permission was granted
-- (could be from a previous session or manually entered).

-- ============================================================================
-- VERIFICATION: Show remaining columns
-- ============================================================================
-- After migration, strategies table should have:
-- id, snapshot_id, user_id, status, phase, phase_started_at,
-- error_message, strategy_for_now, consolidated_strategy,
-- created_at, updated_at
--
-- After migration, snapshots table should NOT have:
-- airport_context (moved to briefings.airport_conditions)
