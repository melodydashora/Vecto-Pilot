-- migrations/20260110_fix_strategy_now_notify.sql
-- S-001 FIX: SSE `strategy_ready` never fires for NOW strategy
--
-- PROBLEM:
--   Previous trigger (20251209) only fires when:
--     NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL
--   But immediate pipeline writes strategy_for_now, NOT consolidated_strategy
--   So SSE strategy_ready NEVER fires for the main use case!
--
-- FIX:
--   Fire when strategy_for_now becomes non-null (NOW strategy ready)
--   OR when consolidated_strategy becomes non-null (Daily strategy ready)
--
-- See: .serena/memories/strategy-pipeline-audit-2026-01-10.md

-- Drop the broken trigger that only fires for consolidated_strategy
DROP TRIGGER IF EXISTS trg_strategy_complete ON strategies;
DROP TRIGGER IF EXISTS trg_strategy_complete_insert ON strategies;
DROP FUNCTION IF EXISTS notify_strategy_complete();

-- Create new function that fires for BOTH strategy types
CREATE OR REPLACE FUNCTION notify_strategy_ready_v2()
RETURNS trigger AS $$
BEGIN
  -- Fire when NOW strategy becomes ready
  -- status='ok' or 'pending_blocks' means immediate strategy is complete
  IF (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL) THEN
    -- Only fire if strategy_for_now just became non-null (was null before)
    IF (OLD.strategy_for_now IS NULL OR OLD.strategy_for_now = '') THEN
      PERFORM pg_notify('strategy_ready', json_build_object(
        'snapshot_id', NEW.snapshot_id,
        'user_id', NEW.user_id,
        'status', NEW.status,
        'type', 'now'
      )::text);
    END IF;
  END IF;

  -- Fire when DAILY strategy becomes ready (consolidated)
  IF (NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL) THEN
    -- Only fire if consolidated_strategy just became non-null
    IF (OLD.consolidated_strategy IS NULL OR OLD.consolidated_strategy = '') THEN
      PERFORM pg_notify('strategy_ready', json_build_object(
        'snapshot_id', NEW.snapshot_id,
        'user_id', NEW.user_id,
        'status', NEW.status,
        'type', 'daily'
      )::text);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for UPDATE (most common case)
CREATE TRIGGER trg_strategy_ready_v2
AFTER UPDATE ON strategies
FOR EACH ROW
WHEN (
  -- Fire when status changes to ok/pending_blocks with strategy_for_now
  (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
  OR
  -- Or when consolidated becomes ready
  (NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL)
)
EXECUTE FUNCTION notify_strategy_ready_v2();

-- Create trigger for INSERT (rare but possible)
CREATE TRIGGER trg_strategy_ready_v2_insert
AFTER INSERT ON strategies
FOR EACH ROW
WHEN (
  (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
  OR
  (NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL)
)
EXECUTE FUNCTION notify_strategy_ready_v2();

-- Add comment for documentation
COMMENT ON FUNCTION notify_strategy_ready_v2() IS
'S-001 FIX (2026-01-10): Fires strategy_ready SSE for BOTH NOW strategy (strategy_for_now)
and Daily strategy (consolidated_strategy). Previous version only fired for consolidated.';
