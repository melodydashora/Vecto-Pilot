-- Purpose: Create/repair event schema + staging + enrichment in one go (idempotent)
-- NOTE: No hardcoded user or location data. All fields are generic.

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- useful for fuzzy name ops later

-- 1) events_facts (includes proximity metadata)
CREATE TABLE IF NOT EXISTS events_facts (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_url text,
  venue_place_id text,           -- nullable for proximity-only events
  venue_name text,
  event_title text NOT NULL,
  event_type text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  confidence double precision DEFAULT 0.0,
  coordinates jsonb,             -- {"lat":..., "lng":...}
  description text,
  tags text[],
  expires_at timestamptz,
  coordinates_source text CHECK (coordinates_source IN ('perplexity','geocoder','runtime','manual')),
  location_quality  text CHECK (location_quality IN ('exact','approx')),
  radius_hint_m int,             -- approximate footprint
  impact_hint text CHECK (impact_hint IN ('none','low','med','high')) DEFAULT 'none',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe
  ON events_facts ((COALESCE(venue_place_id, '')), (LOWER(event_title)), start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_events_time_window ON events_facts(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_events_expires_at ON events_facts(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_place_time ON events_facts(venue_place_id, start_time, end_time);

COMMENT ON TABLE events_facts IS 'Venue/district events from web/APIs/runtime (coords+metadata)';

-- 2) ranking_candidates: ensure missing columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='event_badge_missing') THEN
    ALTER TABLE ranking_candidates ADD COLUMN event_badge_missing boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='node_type') THEN
    ALTER TABLE ranking_candidates ADD COLUMN node_type text CHECK (node_type IN ('venue','staging')) DEFAULT 'venue';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='access_status') THEN
    ALTER TABLE ranking_candidates ADD COLUMN access_status text CHECK (access_status IN ('available','restricted','unknown')) DEFAULT 'unknown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='access_notes') THEN
    ALTER TABLE ranking_candidates ADD COLUMN access_notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='aliases') THEN
    ALTER TABLE ranking_candidates ADD COLUMN aliases text[] DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='geom_key') THEN
    ALTER TABLE ranking_candidates ADD COLUMN geom_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='canonical_name') THEN
    ALTER TABLE ranking_candidates ADD COLUMN canonical_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ranking_candidates' AND column_name='display_suffix') THEN
    ALTER TABLE ranking_candidates ADD COLUMN display_suffix text;
  END IF;
END $$;

COMMENT ON COLUMN ranking_candidates.event_badge_missing IS 'Neutral UI state when enrichment ran but no overlapping events found';
COMMENT ON COLUMN ranking_candidates.node_type IS 'venue=POI, staging=entrance/curb/drop-off';
COMMENT ON COLUMN ranking_candidates.display_suffix IS 'UI-only suffix (e.g., "SE entrance by ...")';

-- 3) Utility functions
CREATE OR REPLACE FUNCTION fn_compute_event_badge(
  p_event_title text,
  p_event_type text,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS TABLE (badge text, summary text) AS $$
BEGIN
  RETURN QUERY SELECT
    CASE p_event_type
      WHEN 'sports' THEN '⚽ ' || p_event_title
      WHEN 'concert' THEN '🎵 ' || p_event_title
      WHEN 'festival' THEN '🎉 ' || p_event_title
      WHEN 'school' THEN '🏫 ' || p_event_title
      WHEN 'construction' THEN '🚧 ' || p_event_title
      WHEN 'closure' THEN '⚠️ ' || p_event_title
      ELSE '📅 ' || p_event_title
    END,
    p_event_title || ' (' ||
      to_char(p_start_time, 'HH12:MI AM') || '-' ||
      to_char(p_end_time, 'HH12:MI AM') || ')';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_haversine_distance(
  lat1 float, lng1 float, lat2 float, lng2 float
)
RETURNS float AS $$
DECLARE
  R float := 6371000;
  dLat float; dLng float; a float; c float;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  dLat := radians(lat2 - lat1);
  dLng := radians(lng2 - lng1);
  a := sin(dLat/2)^2 + cos(radians(lat1))*cos(radians(lat2))*sin(dLng/2)^2;
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4) Upsert (17 args) to match seeder
CREATE OR REPLACE FUNCTION fn_upsert_event(
  p_source text,
  p_source_url text,
  p_venue_place_id text,
  p_venue_name text,
  p_event_title text,
  p_event_type text DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_confidence double precision DEFAULT 0.0,
  p_coordinates jsonb DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_coordinates_source text DEFAULT 'manual',
  p_location_quality text DEFAULT 'exact',
  p_radius_hint_m int DEFAULT NULL,
  p_impact_hint text DEFAULT 'none'
)
RETURNS uuid AS $$
DECLARE v_event_id uuid;
BEGIN
  INSERT INTO events_facts(
    source, source_url, venue_place_id, venue_name,
    event_title, event_type, start_time, end_time,
    confidence, coordinates, description, tags, expires_at,
    coordinates_source, location_quality, radius_hint_m, impact_hint,
    created_at, updated_at
  ) VALUES (
    p_source, p_source_url, p_venue_place_id, p_venue_name,
    p_event_title, p_event_type, p_start_time, p_end_time,
    p_confidence, p_coordinates, p_description, p_tags, p_expires_at,
    p_coordinates_source, p_location_quality, p_radius_hint_m, p_impact_hint,
    now(), now()
  )
  ON CONFLICT ((COALESCE(venue_place_id, '')), (LOWER(event_title)), start_time, end_time)
  DO UPDATE SET
    source_url = EXCLUDED.source_url,
    venue_name = COALESCE(EXCLUDED.venue_name, events_facts.venue_name),
    event_type = EXCLUDED.event_type,
    confidence = GREATEST(events_facts.confidence, EXCLUDED.confidence),
    coordinates = COALESCE(EXCLUDED.coordinates, events_facts.coordinates),
    description = COALESCE(EXCLUDED.description, events_facts.description),
    tags = COALESCE(EXCLUDED.tags, events_facts.tags),
    expires_at = COALESCE(EXCLUDED.expires_at, events_facts.expires_at),
    coordinates_source = COALESCE(EXCLUDED.coordinates_source, events_facts.coordinates_source),
    location_quality = COALESCE(EXCLUDED.location_quality, events_facts.location_quality),
    radius_hint_m = COALESCE(EXCLUDED.radius_hint_m, events_facts.radius_hint_m),
    impact_hint = COALESCE(EXCLUDED.impact_hint, events_facts.impact_hint),
    updated_at = now()
  RETURNING event_id INTO v_event_id;
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- 5) Staging helpers (generic, no hardcoded malls)
CREATE OR REPLACE FUNCTION fn_detect_staging_node(
  p_name text, p_category text DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  RETURN (
    p_name ~* '(entrance|drop-?off|curb|loop|loading|pick-?up|ride-?share|staging)'
    OR COALESCE(p_category,'') IN ('parking','point_of_interest','transit_station')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_generate_geom_key(p_lat float, p_lng float, p_precision int DEFAULT 9)
RETURNS text AS $$
DECLARE lat_bucket int; lng_bucket int; precision_factor float;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN NULL; END IF;
  precision_factor := power(10, p_precision);
  lat_bucket := floor(p_lat * precision_factor);
  lng_bucket := floor(p_lng * precision_factor);
  RETURN lat_bucket::text || ':' || lng_bucket::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_find_parent_complex_name(p_candidate_name text)
RETURNS text AS $$
BEGIN
  -- generic: strip " (…)" or " - …"
  RETURN trim(regexp_replace(p_candidate_name, '\s*[(\-].*$', ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6) Reclassify obvious staging nodes (idempotent; safe)
UPDATE ranking_candidates
SET
  node_type = 'staging',
  access_status = COALESCE(access_status, 'unknown'),
  access_notes = COALESCE(access_notes, 'Entrance/curb resource; access depends on parent complex policy.')
WHERE
  node_type = 'venue'
  AND fn_detect_staging_node(
        name,
        COALESCE(NULLIF(features->>'category',''), NULL)
      );

-- 7) Proximity-aware enrichment refresh
CREATE OR REPLACE FUNCTION fn_refresh_venue_enrichment(p_snapshot_id uuid)
RETURNS void AS $$
DECLARE
  v_snapshot_time timestamptz;
  v_event_assoc_radius_m int := 350;
BEGIN
  SELECT created_at INTO v_snapshot_time
  FROM snapshots
  WHERE snapshot_id = p_snapshot_id;

  IF v_snapshot_time IS NULL THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  UPDATE ranking_candidates rc
  SET
    venue_events = (
      SELECT jsonb_build_object(
        'badge', COALESCE(string_agg(b.badge, ' + ' ORDER BY e.start_time), NULL),
        'summary', COALESCE(string_agg(b.summary, '; ' ORDER BY e.start_time), NULL),
        'event_ids', COALESCE(jsonb_agg(e.event_id ORDER BY e.start_time), '[]'::jsonb),
        'count', COUNT(e.event_id),
        'nearby', bool_or(
          e.venue_place_id IS DISTINCT FROM rc.place_id AND
          e.coordinates IS NOT NULL AND
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
            WHEN e.coordinates IS NULL THEN NULL
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
      CROSS JOIN LATERAL fn_compute_event_badge(e.event_title, e.event_type, e.start_time, e.end_time) b
      WHERE
        (e.expires_at IS NULL OR e.expires_at > v_snapshot_time)
        AND e.start_time <= v_snapshot_time + interval '24 hours'
        AND e.end_time   >= v_snapshot_time
        AND (
          e.venue_place_id = rc.place_id
          OR (
            e.coordinates IS NOT NULL
            AND COALESCE(rc.coords, NULL) IS NOT NULL
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
        AND e.end_time   >= v_snapshot_time
        AND (
          e.venue_place_id = rc.place_id
          OR (
            e.coordinates IS NOT NULL
            AND COALESCE(rc.coords, NULL) IS NOT NULL
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

-- 8) Trigger: refresh enrichment when events change
CREATE OR REPLACE FUNCTION fn_trigger_enrichment_on_event()
RETURNS trigger AS $$
BEGIN
  PERFORM fn_refresh_venue_enrichment(s.snapshot_id)
  FROM snapshots s
  WHERE s.created_at > now() - interval '1 hour'
    AND EXISTS (
      SELECT 1 FROM ranking_candidates rc
      WHERE rc.snapshot_id = s.snapshot_id
        AND (rc.place_id = NEW.venue_place_id)
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enrichment_on_event ON events_facts;
CREATE TRIGGER trigger_enrichment_on_event
  AFTER INSERT OR UPDATE ON events_facts
  FOR EACH ROW EXECUTE FUNCTION fn_trigger_enrichment_on_event();

-- 9) Coach view
CREATE OR REPLACE VIEW v_coach_strategy_context AS
SELECT
  rc.snapshot_id            AS active_snapshot_id,
  rc.id                     AS candidate_id,
  rc.name,
  rc.place_id,
  rc.lat, rc.lng,
  rc.rank,
  rc.drive_time_min,
  rc.model_score,
  rc.est_earnings_per_ride,
  rc.pro_tips,
  rc.closed_reasoning,
  rc.staging_tips,
  rc.venue_events,
  rc.event_badge_missing,
  rc.features,
  s.formatted_address       AS snapshot_address,
  s.lat                     AS snapshot_lat,
  s.lng                     AS snapshot_lng,
  s.timezone,
  s.day_part_key,
  s.weather,
  s.air,
  s.airport_context,
  s.news_briefing,
  st.strategy               AS current_strategy,
  st.valid_window_start,
  st.valid_window_end,
  st.strategy_timestamp
FROM ranking_candidates rc
JOIN snapshots s ON rc.snapshot_id = s.snapshot_id
LEFT JOIN strategies st ON st.snapshot_id = s.snapshot_id AND st.status='ok'
ORDER BY rc.rank;

-- 10) Verification (no location literals)
DO $$
BEGIN
  ASSERT to_regclass('public.events_facts') IS NOT NULL, 'events_facts missing';
  ASSERT to_regclass('public.idx_events_dedupe') IS NOT NULL, 'idx_events_dedupe missing';
  ASSERT (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('fn_upsert_event','fn_haversine_distance','fn_refresh_venue_enrichment','fn_detect_staging_node')) >= 4,
         'one or more functions missing';
  RAISE NOTICE '✅ 0006_unblock_enrichment_and_staging applied';
END $$;
