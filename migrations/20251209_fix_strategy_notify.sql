-- migrations/20251209_fix_strategy_notify.sql
-- Fix NOTIFY trigger to only fire when strategy is FULLY READY
-- Prevents premature SSE events that cause polling spam

-- Drop the over-eager trigger that fires on every column change
DROP TRIGGER IF EXISTS trg_strategy_update ON strategies;
DROP FUNCTION IF EXISTS notify_strategy_update();

-- Drop the legacy trigger that fires on status='complete' (wrong condition)
DROP TRIGGER IF EXISTS strategies_ready_trigger ON strategies;
DROP FUNCTION IF EXISTS notify_strategy_ready();

-- Create a new trigger that ONLY fires when:
-- 1. status changes to 'ok' (consolidation complete)
-- 2. consolidated_strategy is populated
CREATE OR REPLACE FUNCTION notify_strategy_complete()
RETURNS trigger AS $$
BEGIN
  -- Only fire when consolidation is actually complete
  -- status='ok' is set by consolidator.js after writing consolidated_strategy
  IF NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL THEN
    PERFORM pg_notify('strategy_ready', json_build_object(
      'snapshot_id', NEW.snapshot_id,
      'user_id', NEW.user_id,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that only fires on status column changes
-- Using WHEN clause for efficiency - trigger function won't even be called
-- unless the conditions are met
CREATE TRIGGER trg_strategy_complete
AFTER UPDATE ON strategies
FOR EACH ROW
WHEN (
  NEW.status = 'ok'
  AND NEW.consolidated_strategy IS NOT NULL
  AND (OLD.status IS DISTINCT FROM NEW.status)
)
EXECUTE FUNCTION notify_strategy_complete();

-- Also add trigger for INSERT with status='ok' (rare but possible)
CREATE TRIGGER trg_strategy_complete_insert
AFTER INSERT ON strategies
FOR EACH ROW
WHEN (NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL)
EXECUTE FUNCTION notify_strategy_complete();
