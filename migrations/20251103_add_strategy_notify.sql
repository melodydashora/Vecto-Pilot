-- migrations/20251103_add_strategy_notify.sql

-- Function to notify when a strategy row is updated with content
CREATE OR REPLACE FUNCTION notify_strategy_ready()
RETURNS trigger AS $$
DECLARE
  payload JSON;
BEGIN
  IF NEW.minstrategy IS NOT NULL AND NEW.status = 'complete' THEN
    payload := json_build_object(
      'snapshot_id', NEW.snapshot_id,
      'user_id', NEW.user_id
    );
    PERFORM pg_notify('strategy_ready', payload::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on strategies table
DROP TRIGGER IF EXISTS strategies_ready_trigger ON strategies;
CREATE TRIGGER strategies_ready_trigger
AFTER UPDATE ON strategies
FOR EACH ROW
WHEN (NEW.minstrategy IS NOT NULL AND NEW.status = 'complete')
EXECUTE FUNCTION notify_strategy_ready();
