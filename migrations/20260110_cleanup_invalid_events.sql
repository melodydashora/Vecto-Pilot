-- Migration: Clean up discovered_events with NULL date/time fields
-- Preserves venue data in venue_catalog before deletion
--
-- Created: 2026-01-10
-- Issue: D-031b - Events with NULL start_time/end_time break validation
--
-- IMPORTANT: Run this migration AFTER the event discovery prompt fix is deployed
-- This cleans up legacy bad data that was inserted before strict validation

-- Step 1: Report how many invalid events exist
DO $$
DECLARE
  invalid_count INTEGER;
  venue_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM discovered_events
  WHERE event_start_time IS NULL OR event_end_time IS NULL;

  RAISE NOTICE 'Found % events with NULL start_time or end_time', invalid_count;

  -- Count unique venues that would be preserved
  SELECT COUNT(DISTINCT venue_name || COALESCE(address, '')) INTO venue_count
  FROM discovered_events
  WHERE (event_start_time IS NULL OR event_end_time IS NULL)
    AND venue_name IS NOT NULL
    AND venue_name != '';

  RAISE NOTICE 'Will preserve venue data for % unique venues', venue_count;
END $$;

-- Step 2: Insert unique venues into venue_catalog (if not already present)
-- Uses ON CONFLICT to skip duplicates
INSERT INTO venue_catalog (
  venue_name,
  address,
  city,
  state,
  zip,
  lat,
  lng,
  category,
  discovery_source,
  source,
  source_model,
  venue_types
)
SELECT DISTINCT ON (de.venue_name, de.address)
  de.venue_name,
  COALESCE(de.address, de.city || ', ' || de.state), -- Fallback to city, state if no address
  de.city,
  de.state,
  de.zip,
  de.lat,
  de.lng,
  'event_host',                    -- Default category for event venues
  'event_discovery',               -- Mark source as from event discovery
  de.source_model,
  de.source_model,
  '["event_host"]'::jsonb          -- Tag as event host venue type
FROM discovered_events de
WHERE (de.event_start_time IS NULL OR de.event_end_time IS NULL)
  AND de.venue_name IS NOT NULL
  AND de.venue_name != ''
  AND de.venue_name NOT ILIKE '%tbd%'
  AND de.venue_name NOT ILIKE '%unknown%'
  AND NOT EXISTS (
    -- Skip if venue already exists in catalog (match on name + city or address)
    SELECT 1 FROM venue_catalog vc
    WHERE LOWER(vc.venue_name) = LOWER(de.venue_name)
      AND (vc.city = de.city OR vc.address = de.address)
  )
ON CONFLICT (coord_key) DO NOTHING;

-- Step 3: Delete events with NULL date/time fields
-- These will fail validation anyway, better to remove them
DELETE FROM discovered_events
WHERE event_start_time IS NULL OR event_end_time IS NULL;

-- Step 4: Report results
DO $$
DECLARE
  remaining_count INTEGER;
  venue_catalog_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM discovered_events;

  SELECT COUNT(*) INTO venue_catalog_count
  FROM venue_catalog
  WHERE discovery_source = 'event_discovery';

  RAISE NOTICE 'Cleanup complete:';
  RAISE NOTICE '  - Remaining valid events: %', remaining_count;
  RAISE NOTICE '  - Venue catalog entries from events: %', venue_catalog_count;
END $$;
