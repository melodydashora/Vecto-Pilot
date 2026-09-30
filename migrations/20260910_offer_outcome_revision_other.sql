-- Melody requested a distinct Other/error outcome and recoverable saved forms.
-- Forward, data-preserving change: retain every outcome and extend the allowed values.
ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'offer_outcomes'::regclass AND conname = 'offer_outcomes_revision_check') THEN
    ALTER TABLE offer_outcomes ADD CONSTRAINT offer_outcomes_revision_check CHECK (revision >= 1);
  END IF;
END $$;
-- The original named CHECK must be replaced to allow Other; no stored decision is rewritten.
ALTER TABLE offer_outcomes DROP CONSTRAINT IF EXISTS offer_outcomes_driver_decision_check;
ALTER TABLE offer_outcomes ADD CONSTRAINT offer_outcomes_driver_decision_check
  CHECK (driver_decision IN ('Accepted', 'Rejected', 'Cancelled', 'Completed', 'Other'));
