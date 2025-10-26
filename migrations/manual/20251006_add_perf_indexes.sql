-- drizzle/20251006_add_perf_indexes.sql
-- Safe, concurrent index builds for performance optimization
-- Run with: psql $DATABASE_URL -f drizzle/20251006_add_perf_indexes.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS snapshots_user_id_idx ON snapshots(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS snapshots_created_at_idx ON snapshots(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS strategies_status_idx ON strategies(status) WHERE status IN ('pending', 'queued');
CREATE INDEX CONCURRENTLY IF NOT EXISTS rankings_snapshot_id_idx ON rankings(snapshot_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ranking_candidates_ranking_id_idx ON ranking_candidates(ranking_id);
