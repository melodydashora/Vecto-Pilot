-- Migration: Fix FK CASCADE behavior (Issue #7)
-- This migration drops existing NO ACTION constraints and recreates them with CASCADE
-- Ensures data integrity: deleting a snapshot automatically cleans up related records

BEGIN;

-- 1. strategies.snapshot_id → snapshots.snapshot_id (ON DELETE/UPDATE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_snapshot_id_fkey'
  ) THEN
    ALTER TABLE strategies DROP CONSTRAINT strategies_snapshot_id_fkey;
  END IF;
END$$;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_snapshot_id_fkey
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. rankings.snapshot_id → snapshots.snapshot_id (ON DELETE/UPDATE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rankings_snapshot_id_snapshots_snapshot_id_fk'
  ) THEN
    ALTER TABLE rankings DROP CONSTRAINT rankings_snapshot_id_snapshots_snapshot_id_fk;
  END IF;
END$$;

ALTER TABLE rankings
  ADD CONSTRAINT rankings_snapshot_id_snapshots_snapshot_id_fk
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. ranking_candidates.ranking_id → rankings.ranking_id (ON DELETE/UPDATE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ranking_candidates_ranking_id_rankings_ranking_id_fk'
  ) THEN
    ALTER TABLE ranking_candidates DROP CONSTRAINT ranking_candidates_ranking_id_rankings_ranking_id_fk;
  END IF;
END$$;

ALTER TABLE ranking_candidates
  ADD CONSTRAINT ranking_candidates_ranking_id_rankings_ranking_id_fk
  FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. actions.ranking_id → rankings.ranking_id (ON DELETE/UPDATE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'actions_ranking_id_rankings_ranking_id_fk'
  ) THEN
    ALTER TABLE actions DROP CONSTRAINT actions_ranking_id_rankings_ranking_id_fk;
  END IF;
END$$;

ALTER TABLE actions
  ADD CONSTRAINT actions_ranking_id_rankings_ranking_id_fk
  FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. llm_venue_suggestions.ranking_id → rankings.ranking_id (ON DELETE/UPDATE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'llm_venue_suggestions_ranking_id_rankings_ranking_id_fk'
  ) THEN
    ALTER TABLE llm_venue_suggestions DROP CONSTRAINT llm_venue_suggestions_ranking_id_rankings_ranking_id_fk;
  END IF;
END$$;

ALTER TABLE llm_venue_suggestions
  ADD CONSTRAINT llm_venue_suggestions_ranking_id_rankings_ranking_id_fk
  FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

-- Verification query (run separately):
-- SELECT conname, confdeltype, confupdtype FROM pg_constraint 
-- WHERE contype='f' AND (conname LIKE '%strategies%' OR conname LIKE '%rankings%');
-- Expected: confdeltype='c' and confupdtype='c' (CASCADE)
