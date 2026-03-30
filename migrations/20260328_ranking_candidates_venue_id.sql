-- 2026-03-28: Add venue_id FK to ranking_candidates
-- Bridges SmartBlocks pipeline to canonical venue_catalog identity
-- Enables cross-session venue learning and joins to events/bars/map systems

ALTER TABLE ranking_candidates
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venue_catalog(venue_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ranking_candidates_venue_id
  ON ranking_candidates (venue_id) WHERE venue_id IS NOT NULL;

-- Backfill: link existing candidates to catalog where place_id matches (idempotent)
UPDATE ranking_candidates rc
  SET venue_id = vc.venue_id
  FROM venue_catalog vc
  WHERE rc.place_id = vc.place_id
    AND rc.place_id IS NOT NULL
    AND rc.venue_id IS NULL;
