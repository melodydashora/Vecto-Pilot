-- migrations/20260217_drop_briefing_ready_trigger.sql
-- Remove duplicate briefing_ready triggers
--
-- 2026-02-17: FIX - Duplicate briefing_ready notifications
--
-- PROBLEM: Two sources fired pg_notify('briefing_ready') for the same snapshot:
--   1. This trigger (fires when traffic_conditions transitions NULL → populated)
--   2. Manual pg_notify in briefing-service.js (fires after ALL sections are saved)
--
-- Since briefing-service.js writes all data in one INSERT/UPDATE, both fire within
-- milliseconds. The client receives 2 events and refetches all 6 queries twice.
--
-- SOLUTION: Remove the trigger. The manual pg_notify in briefing-service.js is the
-- authoritative signal — it fires at the right time (after all data is ready).
-- The polling fallback covers any delivery gap.
--
-- The original trigger was created in 20260109_briefing_ready_notify.sql when
-- "the /events/briefing SSE endpoint subscribes to this channel but had no producer."
-- The manual notify was added later, making the trigger redundant.

DROP TRIGGER IF EXISTS trg_briefing_complete ON briefings;
DROP TRIGGER IF EXISTS trg_briefing_complete_insert ON briefings;
DROP FUNCTION IF EXISTS notify_briefing_complete();
