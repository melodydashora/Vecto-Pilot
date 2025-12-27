-- Model-agnostic strategy persistence
-- Additive only: keeps all legacy columns for backward compatibility

-- Identity + linkage
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS strategy_id uuid DEFAULT gen_random_uuid();

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_strategy_strategy_id'
  ) THEN
    ALTER TABLE strategies ADD CONSTRAINT uq_strategy_strategy_id UNIQUE (strategy_id);
  END IF;
END $$;

-- Canonical user location (precise address copied at snapshot time)
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS user_resolved_address text,
  ADD COLUMN IF NOT EXISTS user_resolved_city    text,
  ADD COLUMN IF NOT EXISTS user_resolved_state   text;

-- Model-agnostic provider outputs
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS minstrategy           text,           -- short "now" strategy (model-agnostic)
  ADD COLUMN IF NOT EXISTS briefing_news         jsonb,          -- do NOT default; null means "not written yet"
  ADD COLUMN IF NOT EXISTS briefing_events       jsonb,
  ADD COLUMN IF NOT EXISTS briefing_traffic      jsonb,
  ADD COLUMN IF NOT EXISTS consolidated_strategy text;           -- UI shows this when ready

-- Optional backfill from legacy (non-destructive, idempotent)
UPDATE strategies SET
  minstrategy           = COALESCE(minstrategy, claude_strategy, strategy_for_now, strategy),
  briefing_news         = COALESCE(briefing_news, gemini_news, news),
  briefing_events       = COALESCE(briefing_events, gemini_events, events),
  briefing_traffic      = COALESCE(briefing_traffic, gemini_traffic, traffic),
  consolidated_strategy = COALESCE(consolidated_strategy, gpt5_consolidated)
WHERE snapshot_id IS NOT NULL
  AND (minstrategy IS NULL OR briefing_news IS NULL OR briefing_events IS NULL 
       OR briefing_traffic IS NULL OR consolidated_strategy IS NULL);

-- Event trigger: notify when any provider field or consolidated changes
CREATE OR REPLACE FUNCTION notify_strategy_update() RETURNS trigger AS $$
BEGIN
  -- Send notification on strategy_ready channel (used by SSE)
  PERFORM pg_notify('strategy_ready', json_build_object('snapshot_id', NEW.snapshot_id, 'status', NEW.status)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategy_update ON strategies;
CREATE TRIGGER trg_strategy_update
AFTER INSERT OR UPDATE OF
  minstrategy, briefing_news, briefing_events, briefing_traffic, consolidated_strategy, status
ON strategies
FOR EACH ROW EXECUTE FUNCTION notify_strategy_update();
