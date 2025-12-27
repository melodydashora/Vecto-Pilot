-- Add NOTIFY trigger for blocks_ready
-- This enables event-driven blocks loading (no polling needed!)

-- Event trigger: notify when ranking + candidates are inserted
CREATE OR REPLACE FUNCTION notify_blocks_ready() RETURNS trigger AS $$
BEGIN
  -- Send notification on blocks_ready channel (used by SSE)
  -- Include snapshot_id for client-side filtering
  PERFORM pg_notify('blocks_ready', json_build_object(
    'ranking_id', NEW.ranking_id, 
    'snapshot_id', NEW.snapshot_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS trg_blocks_ready ON rankings;

-- Create trigger on rankings INSERT (fires when blocks are persisted)
CREATE TRIGGER trg_blocks_ready
AFTER INSERT ON rankings
FOR EACH ROW EXECUTE FUNCTION notify_blocks_ready();

-- Verify trigger exists
SELECT 
  tgname AS trigger_name,
  proname AS function_name,
  tgenabled AS enabled
FROM pg_trigger
JOIN pg_proc ON pg_trigger.tgfoid = pg_proc.oid
WHERE tgname = 'trg_blocks_ready';
