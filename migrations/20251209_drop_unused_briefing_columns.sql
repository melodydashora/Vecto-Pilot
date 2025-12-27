-- Migration: Drop unused columns from briefings table
-- Perplexity/GPT-5 fields were never populated after Perplexity integration was removed (Dec 2025)
-- Location fields (formatted_address, city, state) are redundant - available via snapshot_id JOIN

ALTER TABLE briefings
  DROP COLUMN IF EXISTS formatted_address,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS global_travel,
  DROP COLUMN IF EXISTS domestic_travel,
  DROP COLUMN IF EXISTS local_traffic,
  DROP COLUMN IF EXISTS weather_impacts,
  DROP COLUMN IF EXISTS events_nearby,
  DROP COLUMN IF EXISTS holidays,
  DROP COLUMN IF EXISTS rideshare_intel,
  DROP COLUMN IF EXISTS citations,
  DROP COLUMN IF EXISTS tactical_traffic,
  DROP COLUMN IF EXISTS tactical_closures,
  DROP COLUMN IF EXISTS tactical_enforcement,
  DROP COLUMN IF EXISTS tactical_sources;
