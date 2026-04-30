-- 2026-04-16 (Pass F bug): app_feedback inserts did not include user_id
-- The column didn't exist in the schema. Auth was required but identity was lost.
-- Idempotent: ADD COLUMN IF NOT EXISTS

ALTER TABLE app_feedback
  ADD COLUMN IF NOT EXISTS user_id uuid;

COMMENT ON COLUMN app_feedback.user_id IS 'Authenticated user who submitted the feedback. Added 2026-04-16 — previously app feedback was anonymous despite requiring auth (Pass F finding).';
