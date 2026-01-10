-- Migration: D-013 - Rename places_cache.place_id to coords_key
-- Date: 2026-01-10
-- Reason: Column stores coordinate keys (lat_lng format), not Google Place IDs
--
-- Before: place_id TEXT PRIMARY KEY (stores "33.123456_-96.123456")
-- After: coords_key TEXT PRIMARY KEY (semantic accuracy)
--
-- Impact: Low risk - only 1 file uses this table (venue-enrichment.js)

-- Step 1: Rename the column
ALTER TABLE places_cache RENAME COLUMN place_id TO coords_key;

-- Verification query (run manually after migration):
-- SELECT coords_key, cached_at, access_count FROM places_cache LIMIT 5;

-- Rollback (if needed):
-- ALTER TABLE places_cache RENAME COLUMN coords_key TO place_id;
