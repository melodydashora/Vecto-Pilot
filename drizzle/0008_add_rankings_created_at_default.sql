-- Migration: Add default NOW() to rankings.created_at
-- This change was already applied to the database, this migration documents it

-- Already applied via: ALTER TABLE rankings ALTER COLUMN created_at SET DEFAULT NOW();
-- No action needed, database is in sync
