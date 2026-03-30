-- Progressive Enrichment: Venue Classification Flags
-- 2026-01-14
--
-- This migration adds boolean flags for efficient filtering and a record_status
-- field to track data completeness (stub/enriched/verified).
--
-- Why these columns:
-- - is_bar: Faster filtering than parsing venue_types JSONB
-- - is_event_venue: Identifies venues discovered via event discovery
-- - record_status: Tracks data completeness to avoid redundant API calls
--   * 'stub' = geocode only (address resolved, no details)
--   * 'enriched' = has Google Places details (hours, rating, etc.)
--   * 'verified' = from trusted source (Bar Tab discovery, manual curation)

-- Add boolean classification flags
ALTER TABLE "venue_catalog" ADD COLUMN IF NOT EXISTS "is_bar" boolean DEFAULT false NOT NULL;
ALTER TABLE "venue_catalog" ADD COLUMN IF NOT EXISTS "is_event_venue" boolean DEFAULT false NOT NULL;

-- Add record status for progressive enrichment tracking
-- Status: 'stub' (geocode only), 'enriched' (has details), 'verified' (trusted source)
ALTER TABLE "venue_catalog" ADD COLUMN IF NOT EXISTS "record_status" text DEFAULT 'stub' NOT NULL;

-- Indexes for efficient filtering (partial indexes to save space)
CREATE INDEX IF NOT EXISTS "idx_venue_catalog_is_bar" ON "venue_catalog" ("is_bar") WHERE "is_bar" = true;
CREATE INDEX IF NOT EXISTS "idx_venue_catalog_is_event_venue" ON "venue_catalog" ("is_event_venue") WHERE "is_event_venue" = true;
CREATE INDEX IF NOT EXISTS "idx_venue_catalog_record_status" ON "venue_catalog" ("record_status");

-- Backfill existing venues based on data signals
-- Venues with expense_rank or bar-related types → is_bar: true
UPDATE "venue_catalog"
SET "is_bar" = true
WHERE "is_bar" = false
  AND (
    "expense_rank" IS NOT NULL
    OR "venue_types" ? 'bar'
    OR "venue_types" ? 'nightclub'
    OR "venue_types" ? 'wine_bar'
    OR "venue_types" ? 'lounge'
  );

-- Venues discovered via events → is_event_venue: true
UPDATE "venue_catalog"
SET "is_event_venue" = true
WHERE "is_event_venue" = false
  AND (
    "venue_types" ? 'event_venue'
    OR "venue_types" ? 'event_host'
    OR "venue_id" IN (SELECT DISTINCT "venue_id" FROM "discovered_events" WHERE "venue_id" IS NOT NULL)
  );

-- Set record_status based on data completeness
-- Verified: has expense_rank (from Bar Tab discovery) or trusted discovery_source
UPDATE "venue_catalog"
SET "record_status" = 'verified'
WHERE "record_status" = 'stub'
  AND (
    "expense_rank" IS NOT NULL
    OR "discovery_source" IN ('bartab_discovery', 'manual', 'google_places_verified')
  );

-- Enriched: has Google place_id or hours data
UPDATE "venue_catalog"
SET "record_status" = 'enriched'
WHERE "record_status" = 'stub'
  AND (
    "place_id" IS NOT NULL
    OR "hours_full_week" IS NOT NULL
    OR "business_hours" IS NOT NULL
  );

-- Remaining stay as 'stub' (address-resolver-only venues)

-- Log migration results
DO $$
DECLARE
  bar_count INTEGER;
  event_venue_count INTEGER;
  stub_count INTEGER;
  enriched_count INTEGER;
  verified_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bar_count FROM "venue_catalog" WHERE "is_bar" = true;
  SELECT COUNT(*) INTO event_venue_count FROM "venue_catalog" WHERE "is_event_venue" = true;
  SELECT COUNT(*) INTO stub_count FROM "venue_catalog" WHERE "record_status" = 'stub';
  SELECT COUNT(*) INTO enriched_count FROM "venue_catalog" WHERE "record_status" = 'enriched';
  SELECT COUNT(*) INTO verified_count FROM "venue_catalog" WHERE "record_status" = 'verified';

  RAISE NOTICE 'Progressive Enrichment Migration Complete:';
  RAISE NOTICE '  is_bar = true: % venues', bar_count;
  RAISE NOTICE '  is_event_venue = true: % venues', event_venue_count;
  RAISE NOTICE '  record_status = stub: % venues', stub_count;
  RAISE NOTICE '  record_status = enriched: % venues', enriched_count;
  RAISE NOTICE '  record_status = verified: % venues', verified_count;
END $$;
