-- migrations/20260503_drop_venue_catalog_source_model.sql
-- Workstream 6 Step 2: drop dead venue_catalog.source_model column
--
-- The column has 0 of 699 rows populated as of audit on 2026-05-03 — no data loss.
-- Single writer (server/lib/venue/venue-cache.js:247) passes through venue.sourceModel
-- but no caller sets that field. Zero readers in runtime code (verified via grep).
--
-- Doctrine: the 2026-01-10 removal of source_model from discovered_events established
-- the principle that AI model identity is pipeline-implicit (Gemini for events,
-- model-agnostic adapter at runtime for venue creation). Per-row source_model is
-- dead telemetry. Catalog-entry provenance still lives in venue_catalog.source
-- (external supplier) and venue_catalog.discovery_source (internal flow).
--
-- Plan: docs/review-queue/PLAN_workstream6_step2_catalog-cleanup-2026-05-03.md
-- Companion commits: schema sync (shared/schema.js), writer cleanup (venue-cache.js),
-- doctrine note (CLAUDE.md).

BEGIN;

ALTER TABLE venue_catalog DROP COLUMN IF EXISTS source_model;

COMMIT;
