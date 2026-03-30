-- migrations/20260109_briefing_ready_notify.sql
-- Add NOTIFY trigger for briefing_ready channel
-- Fires when briefing has traffic_conditions populated (indicates briefing is usable)
--
-- 2026-01-09: Created as part of SSE consolidation
-- The /events/briefing SSE endpoint subscribes to this channel but had no producer

-- Drop any existing trigger/function
DROP TRIGGER IF EXISTS trg_briefing_complete ON briefings;
DROP TRIGGER IF EXISTS trg_briefing_complete_insert ON briefings;
DROP FUNCTION IF EXISTS notify_briefing_complete();

-- Create function that fires pg_notify
CREATE OR REPLACE FUNCTION notify_briefing_complete()
RETURNS trigger AS $$
BEGIN
  -- Fire when traffic_conditions becomes populated
  -- This indicates the briefing has core data needed for strategy
  IF NEW.traffic_conditions IS NOT NULL THEN
    PERFORM pg_notify('briefing_ready', json_build_object(
      'snapshot_id', NEW.snapshot_id,
      'has_traffic', NEW.traffic_conditions IS NOT NULL,
      'has_events', NEW.events IS NOT NULL,
      'has_weather', NEW.weather_current IS NOT NULL
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on UPDATE when traffic_conditions goes from NULL to NOT NULL
CREATE TRIGGER trg_briefing_complete
AFTER UPDATE ON briefings
FOR EACH ROW
WHEN (
  NEW.traffic_conditions IS NOT NULL
  AND OLD.traffic_conditions IS NULL
)
EXECUTE FUNCTION notify_briefing_complete();

-- Trigger on INSERT with traffic_conditions already populated (rare)
CREATE TRIGGER trg_briefing_complete_insert
AFTER INSERT ON briefings
FOR EACH ROW
WHEN (NEW.traffic_conditions IS NOT NULL)
EXECUTE FUNCTION notify_briefing_complete();
