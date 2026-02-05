-- migrations/20260205_enforce_event_end_time.sql
-- Enforce NOT NULL on discovered_events.event_end_time
-- Goal: Ensure all events have resolved timing for accurate driver scheduling

-- 1. Backfill existing NULLs with estimated time (start_time + 3 hours)
-- Handle midnight rollover by wrapping hours > 24
UPDATE discovered_events
SET event_end_time = TO_CHAR(
    (CAST(SPLIT_PART(event_start_time, ':', 1) AS INTEGER) + 3) % 24, 
    'FM00'
) || ':' || SPLIT_PART(event_start_time, ':', 2)
WHERE event_end_time IS NULL 
  AND event_start_time IS NOT NULL 
  AND event_start_time ~ '^\d{2}:\d{2}$'; -- Only update if start_time is valid HH:MM

-- 2. Delete any remaining rows where end_time is still NULL (invalid start_time or other issues)
-- These are "zombie" events that break the contract and should not exist
DELETE FROM discovered_events
WHERE event_end_time IS NULL;

-- 3. Apply NOT NULL constraint
ALTER TABLE discovered_events
ALTER COLUMN event_end_time SET NOT NULL;
