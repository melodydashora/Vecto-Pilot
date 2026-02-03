-- ============================================
-- Migration: Event TTL Automation
-- Purpose: Automatically set expires_at and reject stale events
-- ============================================

-- ============================================
-- 1. FUNCTION: Validate event before insert
-- ============================================

CREATE OR REPLACE FUNCTION fn_validate_event_before_insert()
RETURNS trigger AS $$
BEGIN
  -- Reject events that have already ended (stale data)
  IF NEW.end_time IS NOT NULL AND NEW.end_time < now() THEN
    RAISE NOTICE '[event-ttl] Rejecting past event: % (ended %)', NEW.event_title, NEW.end_time;
    RETURN NULL; -- Skip insert (returns NULL to abort row)
  END IF;

  -- Auto-set expires_at if not provided: end_time + 24 hours buffer
  IF NEW.expires_at IS NULL AND NEW.end_time IS NOT NULL THEN
    NEW.expires_at := NEW.end_time + interval '24 hours';
  END IF;

  -- Auto-set expires_at for events without end_time: start_time + 4 hours
  IF NEW.expires_at IS NULL AND NEW.start_time IS NOT NULL AND NEW.end_time IS NULL THEN
    NEW.expires_at := NEW.start_time + interval '4 hours';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_validate_event_before_insert IS 'Validates events before insert: rejects past events, auto-sets expires_at';

-- ============================================
-- 2. TRIGGER: Apply validation on INSERT
-- ============================================

DROP TRIGGER IF EXISTS trigger_validate_event ON events_facts;

CREATE TRIGGER trigger_validate_event
  BEFORE INSERT ON events_facts
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_event_before_insert();

COMMENT ON TRIGGER trigger_validate_event ON events_facts IS 'Validates events before insert to prevent stale data and auto-set TTL';

-- ============================================
-- 3. FUNCTION: Backfill missing expires_at
-- ============================================

CREATE OR REPLACE FUNCTION fn_backfill_event_expiry()
RETURNS integer AS $$
DECLARE
  v_updated integer := 0;
  v_count integer;
BEGIN
  -- Set expires_at for events with end_time but no expires_at
  UPDATE events_facts
  SET expires_at = end_time + interval '24 hours',
      updated_at = now()
  WHERE expires_at IS NULL
    AND end_time IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_updated := v_updated + v_count;

  -- Set expires_at for events with start_time only (no end_time)
  UPDATE events_facts
  SET expires_at = start_time + interval '4 hours',
      updated_at = now()
  WHERE expires_at IS NULL
    AND start_time IS NOT NULL
    AND end_time IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_updated := v_updated + v_count;

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_backfill_event_expiry IS 'Backfills expires_at for existing events without expiry set';

-- ============================================
-- 4. Run backfill for existing events
-- ============================================

DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT fn_backfill_event_expiry() INTO updated_count;
  RAISE NOTICE '[event-ttl] Backfilled expires_at for % events', updated_count;
END;
$$;

-- ============================================
-- 5. Clean up any already-expired events
-- ============================================

DO $$
DECLARE
  deleted_count integer;
BEGIN
  SELECT fn_cleanup_expired_events() INTO deleted_count;
  RAISE NOTICE '[event-ttl] Cleaned up % expired events', deleted_count;
END;
$$;

-- ============================================
-- 6. INDEX: Optimize cleanup queries
-- ============================================

-- Index already exists from 0003_event_enrichment.sql:
-- CREATE INDEX idx_events_expires_at ON events_facts (expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

DO $$
BEGIN
  -- Verify trigger exists
  ASSERT (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name = 'trigger_validate_event') = 1,
    'trigger_validate_event not created';

  RAISE NOTICE '[event-ttl] Migration complete: TTL automation enabled';
END;
$$;
