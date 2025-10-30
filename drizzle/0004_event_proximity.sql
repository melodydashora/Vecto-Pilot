-- Migration: Event Proximity Association
-- Purpose: Add proximity-based event matching for district-level events
-- Date: 2025-10-30

-- ============================================
-- 1. EXTEND events_facts WITH PROXIMITY FIELDS
-- ============================================

-- Add coordinates_source field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events_facts' AND column_name = 'coordinates_source'
  ) THEN
    ALTER TABLE events_facts ADD COLUMN coordinates_source text 
      CHECK (coordinates_source IN ('perplexity', 'geocoder', 'runtime', 'manual'));
  END IF;
END $$;

-- Add location_quality field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events_facts' AND column_name = 'location_quality'
  ) THEN
    ALTER TABLE events_facts ADD COLUMN location_quality text 
      CHECK (location_quality IN ('exact', 'approx'));
  END IF;
END $$;

-- Add radius_hint_m field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events_facts' AND column_name = 'radius_hint_m'
  ) THEN
    ALTER TABLE events_facts ADD COLUMN radius_hint_m int;
  END IF;
END $$;

-- Add impact_hint field
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events_facts' AND column_name = 'impact_hint'
  ) THEN
    ALTER TABLE events_facts ADD COLUMN impact_hint text 
      CHECK (impact_hint IN ('none', 'low', 'med', 'high'))
      DEFAULT 'none';
  END IF;
END $$;

COMMENT ON COLUMN events_facts.coordinates_source IS 'Source of event coordinates (perplexity, geocoder, runtime, manual)';
COMMENT ON COLUMN events_facts.location_quality IS 'Quality of location data (exact=place_id match, approx=proximity/district)';
COMMENT ON COLUMN events_facts.radius_hint_m IS 'Approximate crowd/footprint radius in meters';
COMMENT ON COLUMN events_facts.impact_hint IS 'Expected rideshare demand impact (none, low, med, high)';

-- ============================================
-- 2. HAVERSINE DISTANCE FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION fn_haversine_distance(
  lat1 float,
  lng1 float,
  lat2 float,
  lng2 float
)
RETURNS float AS $$
DECLARE
  R float := 6371000; -- Earth radius in meters
  dLat float;
  dLng float;
  a float;
  c float;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;

  dLat := radians(lat2 - lat1);
  dLng := radians(lng2 - lng1);
  
  a := sin(dLat/2) * sin(dLat/2) +
       cos(radians(lat1)) * cos(radians(lat2)) *
       sin(dLng/2) * sin(dLng/2);
  
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  RETURN R * c; -- Distance in meters
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_haversine_distance IS 'Calculate distance in meters between two lat/lng points';

-- ============================================
-- 3. UPDATE fn_refresh_venue_enrichment WITH PROXIMITY
-- ============================================

CREATE OR REPLACE FUNCTION fn_refresh_venue_enrichment(p_snapshot_id uuid)
RETURNS void AS $$
DECLARE
  v_snapshot_time timestamptz;
  v_event_assoc_radius_m int := 350; -- Default, override via env in app
BEGIN
  -- Get snapshot timestamp
  SELECT created_at INTO v_snapshot_time
  FROM snapshots
  WHERE snapshot_id = p_snapshot_id;

  IF v_snapshot_time IS NULL THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  -- Update all candidates for this snapshot with event enrichment
  UPDATE ranking_candidates rc
  SET 
    venue_events = (
      SELECT jsonb_build_object(
        'badge', COALESCE(string_agg(badge.badge, ' + ' ORDER BY e.start_time), NULL),
        'summary', COALESCE(string_agg(badge.summary, '; ' ORDER BY e.start_time), NULL),
        'event_ids', COALESCE(jsonb_agg(e.event_id ORDER BY e.start_time), '[]'::jsonb),
        'count', COUNT(e.event_id),
        'nearby', bool_or(
          e.venue_place_id != rc.place_id AND 
          fn_haversine_distance(
            (e.coordinates->>'lat')::float,
            (e.coordinates->>'lng')::float,
            COALESCE((rc.coords->>'lat')::float, rc.lat),
            COALESCE((rc.coords->>'lng')::float, rc.lng)
          ) <= v_event_assoc_radius_m
        ),
        'offset_m', MIN(
          CASE 
            WHEN e.venue_place_id = rc.place_id THEN 0
            ELSE fn_haversine_distance(
              (e.coordinates->>'lat')::float,
              (e.coordinates->>'lng')::float,
              COALESCE((rc.coords->>'lat')::float, rc.lat),
              COALESCE((rc.coords->>'lng')::float, rc.lng)
            )
          END
        ),
        'location_quality', MIN(e.location_quality)
      )
      FROM events_facts e
      CROSS JOIN LATERAL fn_compute_event_badge(
        e.event_title,
        e.event_type,
        e.start_time,
        e.end_time
      ) badge
      WHERE 
        e.expires_at IS NULL OR e.expires_at > v_snapshot_time
        AND e.start_time <= v_snapshot_time + interval '24 hours'
        AND e.end_time >= v_snapshot_time
        AND (
          -- Exact match by place_id
          e.venue_place_id = rc.place_id
          OR
          -- Proximity match within radius
          (
            e.coordinates IS NOT NULL
            AND (rc.coords IS NOT NULL OR (rc.lat IS NOT NULL AND rc.lng IS NOT NULL))
            AND fn_haversine_distance(
              (e.coordinates->>'lat')::float,
              (e.coordinates->>'lng')::float,
              COALESCE((rc.coords->>'lat')::float, rc.lat),
              COALESCE((rc.coords->>'lng')::float, rc.lng)
            ) <= v_event_assoc_radius_m
          )
        )
    ),
    event_badge_missing = NOT EXISTS (
      SELECT 1 FROM events_facts e
      WHERE 
        (e.expires_at IS NULL OR e.expires_at > v_snapshot_time)
        AND e.start_time <= v_snapshot_time + interval '24 hours'
        AND e.end_time >= v_snapshot_time
        AND (
          e.venue_place_id = rc.place_id
          OR
          (
            e.coordinates IS NOT NULL
            AND (rc.coords IS NOT NULL OR (rc.lat IS NOT NULL AND rc.lng IS NOT NULL))
            AND fn_haversine_distance(
              (e.coordinates->>'lat')::float,
              (e.coordinates->>'lng')::float,
              COALESCE((rc.coords->>'lat')::float, rc.lat),
              COALESCE((rc.coords->>'lng')::float, rc.lng)
            ) <= v_event_assoc_radius_m
          )
        )
    )
  WHERE rc.snapshot_id = p_snapshot_id;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_refresh_venue_enrichment IS 'Refresh venue_events for all candidates, matching by place_id OR proximity (350m radius)';

-- ============================================
-- 4. VERIFICATION QUERIES
-- ============================================

-- Check new columns exist
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_name = 'events_facts' AND column_name IN ('coordinates_source', 'location_quality', 'radius_hint_m', 'impact_hint')) = 4,
    'Missing proximity columns in events_facts';
    
  RAISE NOTICE '✅ All proximity columns added to events_facts';
END $$;

-- Check functions exist
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.routines 
    WHERE routine_name IN ('fn_haversine_distance', 'fn_upsert_event', 'fn_refresh_venue_enrichment')) = 3,
    'Missing required functions';
    
  RAISE NOTICE '✅ All proximity functions created';
END $$;

-- Test haversine (Dallas to Fort Worth ~50km)
DO $$
DECLARE
  dist_m float;
BEGIN
  SELECT fn_haversine_distance(32.7767, -96.7970, 32.7555, -97.3308) INTO dist_m;
  ASSERT dist_m BETWEEN 48000 AND 52000, 'Haversine distance calculation failed';
  RAISE NOTICE '✅ Haversine distance: % meters (expected ~50km)', round(dist_m);
END $$;

SELECT '✅ Migration 0004_event_proximity complete' as status;
