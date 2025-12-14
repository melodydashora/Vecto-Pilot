-- Migration: Add event_end_time column to discovered_events table
-- For storing event end times (e.g., "10:00 PM")

ALTER TABLE discovered_events
ADD COLUMN IF NOT EXISTS event_end_time TEXT;

COMMENT ON COLUMN discovered_events.event_end_time IS 'Event end time in format like "10:00 PM"';
