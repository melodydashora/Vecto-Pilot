-- Migration: Drop unused columns from snapshots table
-- Date: 2025-12-28
-- Purpose: Remove user_id and device columns - snapshots are point-in-time records
--          that must be complete on creation (fail-fast principle)

-- Drop user_id column (was nullable, never used in production flow)
ALTER TABLE snapshots DROP COLUMN IF EXISTS user_id;

-- Drop device column (jsonb, was nullable, never populated)
ALTER TABLE snapshots DROP COLUMN IF EXISTS device;

-- Verify remaining structure
-- snapshots should now have only required fields with NOT NULL constraints
