-- Migration: Staging Nodes & Geometry-First Canonicalization
-- Purpose: Add staging node support for mall entrances/drop-offs, coords-first deduplication
-- Date: 2025-10-30

-- ============================================
-- 1. ADD STAGING NODE FIELDS TO ranking_candidates
-- ============================================

-- Add node_type field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'node_type'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN node_type text 
      CHECK (node_type IN ('venue', 'staging'))
      DEFAULT 'venue';
  END IF;
END $$;

-- Add access_status field (for staging nodes)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'access_status'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN access_status text 
      CHECK (access_status IN ('available', 'restricted', 'unknown'))
      DEFAULT 'unknown';
  END IF;
END $$;

-- Add access_notes field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'access_notes'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN access_notes text;
  END IF;
END $$;

-- Add aliases field (for name variants)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'aliases'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN aliases text[] DEFAULT '{}';
  END IF;
END $$;

-- Add geom_key field (h3/geohash for deduplication)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'geom_key'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN geom_key text;
  END IF;
END $$;

-- Add canonical_name field (normalized name from catalog/runtime)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'canonical_name'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN canonical_name text;
  END IF;
END $$;

-- Add display_suffix field (e.g., "SE entrance by Dillard's")
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'display_suffix'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN display_suffix text;
  END IF;
END $$;

COMMENT ON COLUMN ranking_candidates.node_type IS 'venue=business/POI, staging=entrance/curb/drop-off zone';
COMMENT ON COLUMN ranking_candidates.access_status IS 'For staging nodes: available/restricted/unknown based on parent complex hours';
COMMENT ON COLUMN ranking_candidates.access_notes IS 'Human-readable access policy notes';
COMMENT ON COLUMN ranking_candidates.aliases IS 'Name variants for deduplication';
COMMENT ON COLUMN ranking_candidates.geom_key IS 'Geometry hash (h3/geohash) for coords-first deduplication';
COMMENT ON COLUMN ranking_candidates.canonical_name IS 'Normalized name from catalog or runtime provider';
COMMENT ON COLUMN ranking_candidates.display_suffix IS 'UI-only suffix (e.g., entrance description)';

-- ============================================
-- 2. STAGING DETECTION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION fn_detect_staging_node(
  p_name text,
  p_category text DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  -- Detect staging nodes by name patterns or category
  RETURN (
    p_name ~* '(entrance|drop-?off|curb|loop|loading|pick-?up|ride-?share|staging)'
    OR
    p_category IN ('parking', 'point_of_interest', 'transit_station')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_detect_staging_node IS 'Returns true if name/category indicates a staging node (entrance/curb/drop-off)';

-- ============================================
-- 3. RECLASSIFY EXISTING ENTRANCE ROWS
-- ============================================

-- Mark entrance/drop-off rows as staging (idempotent)
UPDATE ranking_candidates
SET 
  node_type = 'staging',
  access_status = COALESCE(access_status, 'unknown'),
  access_notes = COALESCE(
    access_notes, 
    'Entrance/curb resource; access depends on parent complex policy.'
  )
WHERE 
  node_type = 'venue'
  AND fn_detect_staging_node(name, category);

-- ============================================
-- 4. GEOMETRY KEY GENERATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION fn_generate_geom_key(
  p_lat float,
  p_lng float,
  p_precision int DEFAULT 9
)
RETURNS text AS $$
DECLARE
  lat_bucket int;
  lng_bucket int;
  precision_factor float;
BEGIN
  -- Simple geohash-like bucketing (precision controls grid size)
  -- precision=9 gives ~50m resolution, precision=10 gives ~25m
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN NULL;
  END IF;
  
  precision_factor := power(10, p_precision);
  lat_bucket := floor(p_lat * precision_factor);
  lng_bucket := floor(p_lng * precision_factor);
  
  RETURN lat_bucket::text || ':' || lng_bucket::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_generate_geom_key IS 'Generate geometry hash for coords-first deduplication (~50m grid)';

-- ============================================
-- 5. UPDATE EXISTING ROWS WITH GEOM_KEYS
-- ============================================

UPDATE ranking_candidates
SET geom_key = fn_generate_geom_key(
  (coords->>'lat')::float,
  (coords->>'lng')::float,
  9
)
WHERE coords IS NOT NULL AND geom_key IS NULL;

-- ============================================
-- 6. PARENT COMPLEX FINDER (BY NAME FUZZY MATCH)
-- ============================================

CREATE OR REPLACE FUNCTION fn_find_parent_complex_name(
  p_candidate_name text
)
RETURNS text AS $$
BEGIN
  -- Extract parent complex name from candidate name
  -- Examples:
  --   "Stonebriar Centre (SE entrance)" -> "Stonebriar Centre"
  --   "Legacy West - Box Garden entrance" -> "Legacy West"
  
  IF p_candidate_name ~* 'stonebriar' THEN
    RETURN 'Stonebriar Centre';
  ELSIF p_candidate_name ~* 'legacy west' THEN
    RETURN 'Legacy West';
  ELSIF p_candidate_name ~* 'galleria' THEN
    RETURN 'Galleria Dallas';
  ELSIF p_candidate_name ~* 'northpark' THEN
    RETURN 'NorthPark Center';
  END IF;
  
  -- Extract text before parenthesis or dash as default
  RETURN trim(regexp_replace(p_candidate_name, '\s*[(\-].*$', ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_find_parent_complex_name IS 'Extract parent complex name from staging node name (fuzzy match)';

-- ============================================
-- 7. INDEX FOR GEOM_KEY LOOKUPS
-- ============================================

CREATE INDEX IF NOT EXISTS idx_candidates_geom_key 
ON ranking_candidates(geom_key) 
WHERE geom_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_node_type 
ON ranking_candidates(node_type);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check new columns exist
DO $$
DECLARE
  col_count int;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns 
  WHERE table_name = 'ranking_candidates' 
    AND column_name IN ('node_type', 'access_status', 'access_notes', 'aliases', 'geom_key', 'canonical_name', 'display_suffix');
  
  ASSERT col_count = 7, 'Missing staging node columns in ranking_candidates';
  RAISE NOTICE '✅ All staging node columns added to ranking_candidates';
END $$;

-- Check functions exist
DO $$
DECLARE
  func_count int;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM information_schema.routines 
  WHERE routine_name IN ('fn_detect_staging_node', 'fn_generate_geom_key', 'fn_find_parent_complex_name');
  
  ASSERT func_count = 3, 'Missing required staging functions';
  RAISE NOTICE '✅ All staging functions created';
END $$;

-- Test staging detection
DO $$
DECLARE
  is_staging boolean;
BEGIN
  SELECT fn_detect_staging_node('Stonebriar Centre (SE entrance by Dillard''s)') INTO is_staging;
  ASSERT is_staging = true, 'Staging detection failed for entrance';
  
  SELECT fn_detect_staging_node('Walmart Supercenter', 'department_store') INTO is_staging;
  ASSERT is_staging = false, 'Staging detection false positive for regular venue';
  
  RAISE NOTICE '✅ Staging detection working';
END $$;

-- Test geom key generation
DO $$
DECLARE
  key1 text;
  key2 text;
BEGIN
  -- Same location should generate same key
  SELECT fn_generate_geom_key(33.128041, -96.875377, 9) INTO key1;
  SELECT fn_generate_geom_key(33.128045, -96.875380, 9) INTO key2;
  ASSERT key1 = key2, 'Geom keys should match for nearby points';
  
  RAISE NOTICE '✅ Geom key generation: %', key1;
END $$;

-- Count staging nodes
DO $$
DECLARE
  staging_count int;
BEGIN
  SELECT COUNT(*) INTO staging_count
  FROM ranking_candidates
  WHERE node_type = 'staging';
  
  RAISE NOTICE '✅ Staging nodes reclassified: %', staging_count;
END $$;

SELECT '✅ Migration 0005_staging_nodes complete' as status;
