-- Migration: Create places_cache table OR rename column if exists with old name
-- Date: 2026-01-14
-- Reason: Table referenced in schema.js and venue-enrichment.js but column name was inconsistent
--
-- places_cache stores Google Places API results to reduce API costs
-- Key is coordinate-based (lat_lng format with 6 decimal precision)

-- Create the table if it doesn't exist (with correct column name)
CREATE TABLE IF NOT EXISTS places_cache (
    coords_key TEXT PRIMARY KEY,
    formatted_hours JSONB,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_count INTEGER NOT NULL DEFAULT 0
);

-- If table exists with old column name 'place_id', rename it to 'coords_key'
-- This handles the case where the table was created with the old schema
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'places_cache' AND column_name = 'place_id'
    ) THEN
        ALTER TABLE places_cache RENAME COLUMN place_id TO coords_key;
        RAISE NOTICE 'Renamed places_cache.place_id to coords_key';
    END IF;
END $$;

-- Create index for cache cleanup (finding stale entries)
CREATE INDEX IF NOT EXISTS idx_places_cache_cached_at
    ON places_cache (cached_at);

-- Comments for documentation (only if column exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'places_cache' AND column_name = 'coords_key'
    ) THEN
        COMMENT ON TABLE places_cache IS 'Cache for Google Places API responses to reduce API costs';
        COMMENT ON COLUMN places_cache.coords_key IS 'Coordinate key in format lat_lng with 6 decimal precision (e.g., 33.081234_-96.812345)';
        COMMENT ON COLUMN places_cache.formatted_hours IS 'Parsed hours data from Google Places API including weekdayDescriptions';
        COMMENT ON COLUMN places_cache.cached_at IS 'When this cache entry was created/updated';
        COMMENT ON COLUMN places_cache.access_count IS 'Number of times this cache entry has been accessed';
    END IF;
END $$;
