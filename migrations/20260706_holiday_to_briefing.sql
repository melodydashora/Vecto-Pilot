-- 20260706_holiday_to_briefing.sql
--
-- Holiday moves from the snapshot to the briefing pipeline (Melody's
-- direction, 2026-07-06 / todo #21): the snapshot row is purely deterministic
-- (GPS -> Google APIs); LLM-involved enrichment (BRIEFING_HOLIDAY role for
-- non-static dates) lives in the briefing, which carries reasons on failure
-- and never blocks snapshot creation/login.
--
-- 1. briefings.holiday: TEXT -> JSONB section. Verified empty before this
--    migration (0 of 476 rows populated — the column existed but was never
--    written; same never-wired story as the override config path).
--    New shape: { holiday, is_holiday, detectedAt } | { _generationFailed,
--    error, failedAt } (errorMarker convention).
-- 2. snapshots.holiday / snapshots.is_holiday: DROPPED (destructive —
--    executed on Melody's explicit direction to remove holiday from the
--    snapshot). Historical values were only ever 'none'/false defaults on the
--    primary path because the detector never ran there (2026-07-06 audit).

BEGIN;

ALTER TABLE briefings
  ALTER COLUMN holiday TYPE jsonb
  USING CASE WHEN holiday IS NULL THEN NULL
             ELSE jsonb_build_object('holiday', holiday) END;

ALTER TABLE snapshots DROP COLUMN IF EXISTS holiday;
ALTER TABLE snapshots DROP COLUMN IF EXISTS is_holiday;

COMMIT;
