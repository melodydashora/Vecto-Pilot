-- Migration: Rename event columns for semantic consistency
-- From: event_date, event_time (asymmetric)
-- To: event_start_date, event_start_time (symmetric with event_end_*)
--
-- Created: 2026-01-10
-- Issue: D-030 - Code expects event_start_date but DB has event_date
--
-- IMPORTANT: Run this migration BEFORE deploying code that uses event_start_date

-- Step 1: Rename the columns
ALTER TABLE discovered_events RENAME COLUMN event_date TO event_start_date;
ALTER TABLE discovered_events RENAME COLUMN event_time TO event_start_time;

-- Step 2: Drop old index and create new one with correct name
DROP INDEX IF EXISTS idx_discovered_events_date;
CREATE INDEX IF NOT EXISTS idx_discovered_events_start_date ON discovered_events (event_start_date);

-- Step 3: Update any views or materialized views that reference old column names
-- (None currently exist for discovered_events)

-- Step 4: Add comments for clarity
COMMENT ON COLUMN discovered_events.event_start_date IS 'Event start date in YYYY-MM-DD format (renamed from event_date for symmetry with event_end_date)';
COMMENT ON COLUMN discovered_events.event_start_time IS 'Event start time, e.g., "7:00 PM", "All Day" (renamed from event_time for symmetry with event_end_time)';
