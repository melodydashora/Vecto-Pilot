-- migrations/20260824_offer_outcomes_fare_validation.sql
-- Upfront-fare validation on settled offers (Earnings Log Module, spec §3 Offer
-- Analyzer tab): when the driver records an Accepted offer, the payout is assumed
-- to equal the accepted upfront fare (actual_pay pre-filled and locked in the UI);
-- tips and tolls are added on top, and an explicit "paid different than accepted"
-- path records a fare mismatch — a per-offer test of whether the platform honors
-- its upfront fares. Saving settles the outcome and removes the offer from the
-- Recent Offers queue.
--
-- Additive only (no drops/alters of existing columns). total_earned (GENERATED
-- STORED over actual_pay/reimbursements/extras/other) is deliberately untouched:
-- the grand total including tips+tolls is computed at read time
-- (COALESCE(total_earned,0)+COALESCE(tips,0)+COALESCE(tolls,0)) in
-- server/api/offer-analyzer/index.js and rideshare-coach-dal.js getOfferPatterns.

ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS tips double precision;
ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS tolls double precision;

-- Snapshot of offer_intelligence.price at validation time. The FK is ON DELETE
-- SET NULL, so the mismatch evidence must survive offer-row deletion on its own.
ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS upfront_price double precision;

ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS fare_matched_upfront boolean;

-- NULL = outcome still open in the Recent Offers queue; set when the driver
-- settles (Rejected/Cancelled settle on selection; Accepted/Completed settle when
-- the fare validation is saved).
ALTER TABLE offer_outcomes ADD COLUMN IF NOT EXISTS settled_at timestamptz;

COMMENT ON COLUMN offer_outcomes.fare_matched_upfront IS
  'Upfront-fare honesty test: NULL until validated; TRUE = payout matched the accepted upfront fare (actual_pay copied from upfront_price); FALSE = differed (actual_pay is the driver-entered real payout, upfront_price what was accepted)';

COMMENT ON COLUMN offer_outcomes.settled_at IS
  'NULL while the offer is still open in the Recent Offers queue; stamped when the driver settles the outcome (UI then hides the row)';
