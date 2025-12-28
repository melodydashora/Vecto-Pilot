-- 2025-12-27: Add deactivation tracking fields to discovered_events
-- Used by AI Coach to mark events as inactive with a reason

-- Add deactivation_reason column
ALTER TABLE discovered_events
ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

-- Add deactivated_at timestamp
ALTER TABLE discovered_events
ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Add deactivated_by to track who deactivated (ai_coach or user_id)
ALTER TABLE discovered_events
ADD COLUMN IF NOT EXISTS deactivated_by TEXT;

-- Add comment explaining the reason values
COMMENT ON COLUMN discovered_events.deactivation_reason IS
  'Reason for deactivation: event_ended, incorrect_time, no_longer_relevant, cancelled, duplicate, other';

COMMENT ON COLUMN discovered_events.deactivated_by IS
  'Who deactivated: ai_coach or user_id';
