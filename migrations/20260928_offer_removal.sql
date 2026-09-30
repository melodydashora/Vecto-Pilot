-- Reversible, owner-scoped exclusion for offer-history corrections.
-- Original captured offer data and offer_outcomes are never deleted or rewritten.
ALTER TABLE offer_intelligence
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

ALTER TABLE offer_intelligence
  ADD COLUMN IF NOT EXISTS removal_revision INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'offer_intelligence'::regclass
      AND conname = 'offer_intelligence_removal_revision_check'
  ) THEN
    ALTER TABLE offer_intelligence
      ADD CONSTRAINT offer_intelligence_removal_revision_check
      CHECK (removal_revision >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oi_user_created
  ON offer_intelligence (user_id, created_at DESC, id DESC)
  WHERE user_id IS NOT NULL;
