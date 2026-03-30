-- migrations/20260205_add_event_cleanup_indices.sql
-- Add indices to efficiently filter old events for cleanup/truncation
-- Supports query: WHERE event_end_date < CURRENT_DATE OR (event_end_date = CURRENT_DATE AND event_end_time < NOW)

CREATE INDEX IF NOT EXISTS idx_discovered_events_end_date ON discovered_events (event_end_date);
CREATE INDEX IF NOT EXISTS idx_discovered_events_end_time ON discovered_events (event_end_time);
