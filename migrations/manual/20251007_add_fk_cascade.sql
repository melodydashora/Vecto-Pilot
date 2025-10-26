
-- Migration: Add CASCADE behavior to foreign key constraints
-- This ensures that when a snapshot is deleted, related strategies, rankings, and candidates are automatically cleaned up

BEGIN;

-- Drop existing foreign key constraints
ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_snapshot_id_snapshots_snapshot_id_fk;
ALTER TABLE rankings DROP CONSTRAINT IF EXISTS rankings_snapshot_id_snapshots_snapshot_id_fk;
ALTER TABLE ranking_candidates DROP CONSTRAINT IF EXISTS ranking_candidates_ranking_id_rankings_ranking_id_fk;

-- Recreate with CASCADE behavior
ALTER TABLE strategies 
  ADD CONSTRAINT strategies_snapshot_id_snapshots_snapshot_id_fk 
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE CASCADE;

ALTER TABLE rankings 
  ADD CONSTRAINT rankings_snapshot_id_snapshots_snapshot_id_fk 
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE CASCADE;

ALTER TABLE ranking_candidates 
  ADD CONSTRAINT ranking_candidates_ranking_id_rankings_ranking_id_fk 
  FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id) ON DELETE CASCADE;

COMMIT;

-- Data Lifecycle Policy:
-- - Snapshots are the root entity (never auto-deleted)
-- - Strategies CASCADE with snapshots (1:1 relationship)
-- - Rankings CASCADE with snapshots (cleanup view logs)
-- - Ranking candidates CASCADE with rankings (cleanup interaction logs)
-- - Manual cleanup: Delete snapshots older than 90 days via cron job
