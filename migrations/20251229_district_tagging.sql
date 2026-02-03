-- Migration: District Tagging for Venue Catalog
-- Created: 2025-12-29
-- Purpose: Add district fields to improve Places API matching accuracy
--
-- Problem Solved:
--   GPT-5.2 provides approximate coordinates that may be 50-150m off.
--   Places API searches at those coords and finds wrong businesses.
--   District tagging enables text search fallback: "Legacy Hall Legacy West Plano TX"
--
-- Tables Modified:
--   - venue_catalog: Add district identity fields
--   - ranking_candidates: Add district from LLM output

-- ============================================================================
-- VENUE_CATALOG: Add district identity fields
-- ============================================================================

-- District name (human-readable)
-- Example: "Legacy West", "Deep Ellum", "Bishop Arts District"
ALTER TABLE venue_catalog
ADD COLUMN IF NOT EXISTS district text;

-- District slug (normalized for lookups)
-- Example: "legacy-west", "deep-ellum", "bishop-arts"
ALTER TABLE venue_catalog
ADD COLUMN IF NOT EXISTS district_slug text;

-- District centroid coordinates (calculated from clustered venues)
-- Used for validation: if venue coords are >1km from district centroid, flag it
ALTER TABLE venue_catalog
ADD COLUMN IF NOT EXISTS district_centroid_lat double precision;

ALTER TABLE venue_catalog
ADD COLUMN IF NOT EXISTS district_centroid_lng double precision;

-- ============================================================================
-- RANKING_CANDIDATES: Add district from LLM output
-- ============================================================================

-- District name from GPT-5.2 tactical planner
-- Stored per-recommendation for matching and deduplication
ALTER TABLE ranking_candidates
ADD COLUMN IF NOT EXISTS district text;

-- ============================================================================
-- INDEXES: Optimize district lookups
-- ============================================================================

-- Index for district slug lookups (find all venues in a district)
CREATE INDEX IF NOT EXISTS idx_venue_catalog_district_slug
ON venue_catalog(district_slug);

-- Composite index for city + district queries
CREATE INDEX IF NOT EXISTS idx_venue_catalog_city_district
ON venue_catalog(city, district_slug);

-- Index for ranking candidates district (for deduplication queries)
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_district
ON ranking_candidates(district);

-- ============================================================================
-- COMMENTS: Document the fields
-- ============================================================================

COMMENT ON COLUMN venue_catalog.district IS
'Human-readable district/neighborhood name (e.g., "Legacy West", "Deep Ellum")';

COMMENT ON COLUMN venue_catalog.district_slug IS
'URL-safe normalized district name for lookups (e.g., "legacy-west")';

COMMENT ON COLUMN venue_catalog.district_centroid_lat IS
'Latitude of district center, calculated from clustered venues';

COMMENT ON COLUMN venue_catalog.district_centroid_lng IS
'Longitude of district center, calculated from clustered venues';

COMMENT ON COLUMN ranking_candidates.district IS
'District name from LLM output, used for text search fallback and deduplication';

-- ============================================================================
-- VERIFICATION: Check columns were added
-- ============================================================================

DO $$
BEGIN
  -- Verify venue_catalog columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'venue_catalog' AND column_name = 'district') THEN
    RAISE EXCEPTION 'Migration failed: venue_catalog.district not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ranking_candidates' AND column_name = 'district') THEN
    RAISE EXCEPTION 'Migration failed: ranking_candidates.district not created';
  END IF;

  RAISE NOTICE 'District tagging migration completed successfully';
END $$;
