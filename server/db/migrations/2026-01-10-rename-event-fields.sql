-- Migration: Rename event_date → event_start_date, event_time → event_start_time
-- Date: 2026-01-10
-- Reason: Symmetric naming convention with event_end_date and event_end_time
--
-- This migration renames fields for consistency:
--   event_date  → event_start_date
--   event_time  → event_start_time

-- Rename columns in discovered_events table
ALTER TABLE discovered_events RENAME COLUMN event_date TO event_start_date;
ALTER TABLE discovered_events RENAME COLUMN event_time TO event_start_time;

-- Verify the changes
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'discovered_events'
-- AND column_name LIKE 'event_%';

-- Note: This is a non-destructive rename. No data is lost.
-- Rollback if needed:
-- ALTER TABLE discovered_events RENAME COLUMN event_start_date TO event_date;
-- ALTER TABLE discovered_events RENAME COLUMN event_start_time TO event_time;
