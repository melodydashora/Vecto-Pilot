-- Migration: Event Enrichment System
-- Purpose: Add events_facts table, enrichment functions, triggers, and coach view
-- Date: 2025-10-30

-- ============================================
-- 0. EXTENSIONS
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- text similarity for name matching

-- ============================================
-- 1. CREATE events_facts TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS events_facts (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_url text,
  venue_place_id text,  -- NULLABLE for proximity/zone events
  venue_name text,
  event_title text NOT NULL,
  event_type text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  confidence double precision DEFAULT 0.0,
  coordinates jsonb,
  description text,
  tags text[],
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Dedupe key: same title + time window (place_id OR empty string for proximity events)
  UNIQUE (COALESCE(venue_place_id, ''), LOWER(event_title), start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_events_place_time ON events_facts(venue_place_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_events_time_window ON events_facts(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_events_expires_at ON events_facts(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE events_facts IS 'Venue events from external sources (web scraping, APIs, research)';

-- ============================================
-- 2. ADD event_badge_missing TO ranking_candidates
-- ============================================

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ranking_candidates' AND column_name = 'event_badge_missing'
  ) THEN
    ALTER TABLE ranking_candidates ADD COLUMN event_badge_missing boolean DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN ranking_candidates.event_badge_missing IS 'True when enrichment ran but no overlapping events found (enables neutral UI state)';

-- ============================================
-- 3. FUNCTION: fn_compute_event_badge
-- ============================================

CREATE OR REPLACE FUNCTION fn_compute_event_badge(
  p_event_title text,
  p_event_type text,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS TABLE (badge text, summary text) AS $$
BEGIN
  -- Generate badge text (e.g., "🎃 Halloween Event")
  RETURN QUERY SELECT
    CASE p_event_type
      WHEN 'sports' THEN '⚽ ' || p_event_title
      WHEN 'concert' THEN '🎵 ' || p_event_title
      WHEN 'festival' THEN '🎉 ' || p_event_title
      WHEN 'school' THEN '🏫 ' || p_event_title
      WHEN 'construction' THEN '🚧 ' || p_event_title
      WHEN 'closure' THEN '⚠️ ' || p_event_title
      ELSE '📅 ' || p_event_title
    END as badge,
    p_event_title || ' (' || 
      to_char(p_start_time, 'HH:MI AM') || '-' || 
      to_char(p_end_time, 'HH:MI AM') || ')' as summary;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_compute_event_badge IS 'Generates badge and summary text for event display';

-- ============================================
-- 4. FUNCTION: fn_upsert_event
-- ============================================

CREATE OR REPLACE FUNCTION fn_upsert_event(
  p_source text,
  p_source_url text,
  p_venue_place_id text,
  p_venue_name text,
  p_event_title text,
  p_event_type text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_confidence double precision DEFAULT 0.85,
  p_coordinates jsonb DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO events_facts (
    source,
    source_url,
    venue_place_id,
    venue_name,
    event_title,
    event_type,
    start_time,
    end_time,
    confidence,
    coordinates,
    description,
    tags,
    expires_at
  ) VALUES (
    p_source,
    p_source_url,
    p_venue_place_id,
    p_venue_name,
    p_event_title,
    p_event_type,
    p_start_time,
    p_end_time,
    p_confidence,
    p_coordinates,
    p_description,
    p_tags,
    p_expires_at
  )
  ON CONFLICT (COALESCE(venue_place_id, ''), LOWER(event_title), start_time, end_time)
  DO UPDATE SET
    source = EXCLUDED.source,
    source_url = EXCLUDED.source_url,
    venue_name = COALESCE(EXCLUDED.venue_name, events_facts.venue_name),
    event_type = EXCLUDED.event_type,
    confidence = GREATEST(events_facts.confidence, EXCLUDED.confidence),
    coordinates = COALESCE(EXCLUDED.coordinates, events_facts.coordinates),
    description = COALESCE(EXCLUDED.description, events_facts.description),
    tags = COALESCE(EXCLUDED.tags, events_facts.tags),
    expires_at = COALESCE(EXCLUDED.expires_at, events_facts.expires_at),
    updated_at = now()
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_upsert_event IS 'Idempotent event insertion/update with proper deduplication on (place_id, title, time_window)';

-- ============================================
-- 5. FUNCTION: fn_refresh_venue_enrichment
-- ============================================

CREATE OR REPLACE FUNCTION fn_refresh_venue_enrichment(p_snapshot_id uuid)
RETURNS void AS $$
BEGIN
  -- Update ranking_candidates with overlapping events
  UPDATE ranking_candidates rc
  SET 
    venue_events = (
      SELECT jsonb_build_object(
        'badge', array_to_string(array_agg(badge.badge), ', '),
        'summary', array_to_string(array_agg(badge.summary), ' | '),
        'event_ids', array_agg(ef.event_id),
        'count', count(*)
      )
      FROM events_facts ef
      CROSS JOIN LATERAL fn_compute_event_badge(
        ef.event_title,
        ef.event_type,
        ef.start_time,
        ef.end_time
      ) badge
      WHERE ef.venue_place_id = rc.place_id
        AND (ef.expires_at IS NULL OR ef.expires_at > now())
        AND tstzrange(ef.start_time, ef.end_time) && tstzrange(
          (SELECT created_at FROM snapshots WHERE snapshot_id = p_snapshot_id),
          (SELECT created_at FROM snapshots WHERE snapshot_id = p_snapshot_id) + interval '6 hours'
        )
      GROUP BY ef.venue_place_id
    ),
    event_badge_missing = NOT EXISTS (
      SELECT 1 FROM events_facts ef
      WHERE ef.venue_place_id = rc.place_id
        AND (ef.expires_at IS NULL OR ef.expires_at > now())
        AND tstzrange(ef.start_time, ef.end_time) && tstzrange(
          (SELECT created_at FROM snapshots WHERE snapshot_id = p_snapshot_id),
          (SELECT created_at FROM snapshots WHERE snapshot_id = p_snapshot_id) + interval '6 hours'
        )
    )
  WHERE rc.snapshot_id = p_snapshot_id
    AND rc.place_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_refresh_venue_enrichment IS 'Enriches ranking_candidates with overlapping events for a snapshot';

-- ============================================
-- 6. TRIGGER: Auto-refresh on new events
-- ============================================

CREATE OR REPLACE FUNCTION fn_trigger_enrichment_on_event()
RETURNS trigger AS $$
BEGIN
  -- When a new event is inserted/updated, refresh all active snapshots
  -- that might be affected (within last hour)
  PERFORM fn_refresh_venue_enrichment(s.snapshot_id)
  FROM snapshots s
  WHERE s.created_at > now() - interval '1 hour'
    AND EXISTS (
      SELECT 1 FROM ranking_candidates rc
      WHERE rc.snapshot_id = s.snapshot_id
        AND rc.place_id = NEW.venue_place_id
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enrichment_on_event ON events_facts;
CREATE TRIGGER trigger_enrichment_on_event
  AFTER INSERT OR UPDATE ON events_facts
  FOR EACH ROW
  EXECUTE FUNCTION fn_trigger_enrichment_on_event();

COMMENT ON TRIGGER trigger_enrichment_on_event ON events_facts IS 'Auto-refreshes enrichment when events are added/updated';

-- ============================================
-- 7. VIEW: v_coach_strategy_context
-- ============================================

CREATE OR REPLACE VIEW v_coach_strategy_context AS
SELECT
  rc.snapshot_id as active_snapshot_id,
  rc.id as candidate_id,
  rc.name,
  rc.place_id,
  rc.lat,
  rc.lng,
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
  s.formatted_address as snapshot_address,
  s.lat as snapshot_lat,
  s.lng as snapshot_lng,
  s.timezone,
  s.day_part_key,
  s.weather,
  s.air,
  s.airport_context,
  s.news_briefing,
  st.strategy as current_strategy,
  st.valid_window_start,
  st.valid_window_end,
  st.strategy_timestamp
FROM ranking_candidates rc
JOIN snapshots s ON rc.snapshot_id = s.snapshot_id
LEFT JOIN strategies st ON st.snapshot_id = s.snapshot_id AND st.status = 'ok'
ORDER BY rc.rank;

COMMENT ON VIEW v_coach_strategy_context IS 'Snapshot-wide context for strategy coach - includes all candidates with enrichment and strategy';

-- ============================================
-- 8. CLEANUP: Remove expired events
-- ============================================

CREATE OR REPLACE FUNCTION fn_cleanup_expired_events()
RETURNS integer AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM events_facts
  WHERE expires_at IS NOT NULL
    AND expires_at < now();
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_cleanup_expired_events IS 'Removes expired events - run periodically via cron or maintenance script';

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- Verify tables exist
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'events_facts') = 1,
    'events_facts table not created';
  ASSERT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'ranking_candidates' AND column_name = 'event_badge_missing') = 1,
    'event_badge_missing column not added';
  
  RAISE NOTICE '✅ Event enrichment migration complete';
  RAISE NOTICE '   - events_facts table created';
  RAISE NOTICE '   - event_badge_missing column added';
  RAISE NOTICE '   - 4 functions created';
  RAISE NOTICE '   - 1 trigger created';
  RAISE NOTICE '   - 1 view created';
END $$;
