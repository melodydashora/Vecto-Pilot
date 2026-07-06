-- 20260706_daypart_taxonomy_rename.sql
--
-- Daypart taxonomy rename (2026-07-06, Melody + Claude):
--   late_morning_noon (12:00-14:59) -> early_afternoon
--   afternoon         (15:00-16:59) -> late_afternoon
--
-- Why: the old keys were semantically wrong — "late_morning_noon" labeled
-- 12:00 PM-2:59 PM as "late morning" in the driver-facing header AND fed the
-- raw key into LLM prompts, confusing the models' time-of-day reasoning.
-- New writes use the canonical taxonomy from shared/dayparts.js; readers
-- normalize legacy keys, so this migration is a data cleanup, not a
-- correctness requirement. Idempotent (WHERE-guarded UPDATEs).
--
-- Also repairs the midnight bug: Node <= 21 formats midnight as hour "24"
-- with `hour12: false` (V8 h24 hourCycle), so rows created 12:00-12:59 AM
-- stored hour=24 and classified as 'evening' instead of 'overnight'.
--
-- APPROVAL: data-mutating UPDATEs — run only with explicit human approval,
-- e.g. via `npm run db:migrate` or:
--   psql $DATABASE_URL -f migrations/20260706_daypart_taxonomy_rename.sql

BEGIN;

-- ── Taxonomy rename ─────────────────────────────────────────────────────────
UPDATE snapshots SET day_part_key = 'early_afternoon' WHERE day_part_key = 'late_morning_noon';
UPDATE snapshots SET day_part_key = 'late_afternoon'  WHERE day_part_key = 'afternoon';

UPDATE offer_intelligence SET day_part = 'early_afternoon' WHERE day_part = 'late_morning_noon';
UPDATE offer_intelligence SET day_part = 'late_afternoon'  WHERE day_part = 'afternoon';

-- ── Midnight hour=24 repair (h24 hourCycle bug) ─────────────────────────────
UPDATE snapshots SET hour = 0, day_part_key = 'overnight' WHERE hour = 24;
UPDATE offer_intelligence SET local_hour = 0, day_part = 'overnight' WHERE local_hour = 24;

-- ── Coords-cache timezone purge ─────────────────────────────────────────────
-- Until 2026-07-06, /api/location/resolve took the timezone from a MARKET
-- lookup by city name when available, and only cached rows carry that value
-- forward (the cache write at location.js stores whatever was resolved).
-- Market timezones are wrong near zone borders (Indiana splits Central/
-- Eastern by county). We cannot tell which cached rows are market-derived,
-- so purge the cache: rows re-create on next visit with the Google Timezone
-- API value (cache insert is onConflictDoNothing, so NULLing the column
-- would never heal — deletion is required).
-- COST: one Geocode + one Timezone API call per unique coordinate revisited.
DELETE FROM coords_cache;

COMMIT;
