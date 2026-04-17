-- 2026-04-16: Add missing unique constraint on news_deactivations (user_id, news_hash)
-- Bug: Coach DEACTIVATE_NEWS action used ON CONFLICT (user_id, news_hash) DO UPDATE
-- but the constraint didn't exist — PG error 42P10 caused every deactivation to fail silently.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_deactivations_unique ON news_deactivations (user_id, news_hash);
CREATE INDEX IF NOT EXISTS idx_news_deactivations_user_id ON news_deactivations (user_id);
CREATE INDEX IF NOT EXISTS idx_news_deactivations_news_hash ON news_deactivations (news_hash);
