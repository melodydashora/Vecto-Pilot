-- 2026-01-10: Drop unused columns from discovered_events
-- Reason: Geocoding (lat, lng) happens in venue_catalog, not here
-- zip, source_url, raw_source_data were never populated

ALTER TABLE discovered_events
  DROP COLUMN IF EXISTS zip,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS raw_source_data;
