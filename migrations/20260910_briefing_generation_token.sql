-- Source-only forward migration. Apply before deploying the fenced Briefing writer.
-- Existing completed rows remain readable; the next generation claims a new token.
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS generation_token uuid;
