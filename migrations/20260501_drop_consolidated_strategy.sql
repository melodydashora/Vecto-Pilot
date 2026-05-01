-- migrations/20260501_drop_consolidated_strategy.sql
-- Phase 3 Schema Fix: drop strategies.consolidated_strategy column
--
-- The STRATEGY_DAILY AI role was retired on 2026-04-27 (doc references
-- swept on 2026-04-30 in commit adb981cb). This column is its dead
-- storage surface. Trigger trg_strategy_ready_v2 references the column
-- in its WHEN clause and function body, so we rewrite both inside the
-- same transaction before dropping the column.
--
-- Plan: docs/review-queue/PLAN_drop-consolidated-strategy-2026-05-01.md

BEGIN;

-- 1) Drop existing triggers and the function (same names will be recreated)
DROP TRIGGER IF EXISTS trg_strategy_ready_v2 ON strategies;
DROP TRIGGER IF EXISTS trg_strategy_ready_v2_insert ON strategies;
DROP FUNCTION IF EXISTS notify_strategy_ready_v2();

-- 2) Recreate function — only fires for strategy_for_now (NOW strategy)
CREATE OR REPLACE FUNCTION notify_strategy_ready_v2()
RETURNS trigger AS $$
BEGIN
  IF (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL) THEN
    -- TG_OP = 'INSERT' has no OLD row; UPDATE checks the transition explicitly.
    IF (TG_OP = 'INSERT' OR OLD.strategy_for_now IS NULL OR OLD.strategy_for_now = '') THEN
      PERFORM pg_notify('strategy_ready', json_build_object(
        'snapshot_id', NEW.snapshot_id,
        'user_id',     NEW.user_id,
        'status',      NEW.status,
        'type',        'now'
      )::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Recreate triggers without the consolidated_strategy OR-branch
CREATE TRIGGER trg_strategy_ready_v2
AFTER UPDATE ON strategies
FOR EACH ROW
WHEN (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
EXECUTE FUNCTION notify_strategy_ready_v2();

CREATE TRIGGER trg_strategy_ready_v2_insert
AFTER INSERT ON strategies
FOR EACH ROW
WHEN (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
EXECUTE FUNCTION notify_strategy_ready_v2();

-- 4) Drop the column (3 non-null rows out of 349 in dev will lose their text;
--    those rows were residue from the deprecated STRATEGY_DAILY era)
ALTER TABLE strategies DROP COLUMN IF EXISTS consolidated_strategy;

COMMIT;

COMMENT ON FUNCTION notify_strategy_ready_v2() IS
'Phase 3 (2026-05-01): Fires strategy_ready SSE only for NOW strategy
(strategy_for_now). The consolidated_strategy column was dropped together
with the deprecated STRATEGY_DAILY role. Supersedes 20260110_fix_strategy_now_notify.sql.';
