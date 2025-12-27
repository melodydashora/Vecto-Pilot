-- Migration: Create discovered_events table for AI-discovered events
-- Used by daily event sync script to store events from SerpAPI, GPT-5.2, etc.

CREATE TABLE IF NOT EXISTS discovered_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identity
  title TEXT NOT NULL,
  venue_name TEXT,
  address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT,

  -- Event timing
  event_date TEXT NOT NULL,  -- YYYY-MM-DD format
  event_time TEXT,           -- e.g., "7:00 PM", "All Day"
  event_end_date TEXT,       -- For multi-day events

  -- Coordinates (optional)
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,

  -- Categorization
  category TEXT NOT NULL DEFAULT 'other',  -- concert, sports, theater, conference, festival, nightlife, civic, academic, airport, other
  expected_attendance TEXT DEFAULT 'medium', -- high, medium, low

  -- Discovery metadata
  source_model TEXT NOT NULL,  -- SerpAPI, GPT-5.2, Gemini, Claude, etc.
  source_url TEXT,
  raw_source_data JSONB,

  -- Deduplication
  event_hash TEXT NOT NULL UNIQUE,  -- MD5 of normalized(title + venue + date + city)

  -- Timestamps
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Flags
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_discovered_events_city ON discovered_events (city, state);
CREATE INDEX IF NOT EXISTS idx_discovered_events_date ON discovered_events (event_date);
CREATE INDEX IF NOT EXISTS idx_discovered_events_category ON discovered_events (category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_events_hash ON discovered_events (event_hash);
CREATE INDEX IF NOT EXISTS idx_discovered_events_discovered_at ON discovered_events (discovered_at DESC);

-- Comments
COMMENT ON TABLE discovered_events IS 'AI-discovered events from SerpAPI, GPT-5.2, and other sources for rideshare demand prediction';
COMMENT ON COLUMN discovered_events.event_hash IS 'MD5 hash of normalized(title + venue + date + city) for deduplication';
COMMENT ON COLUMN discovered_events.source_model IS 'AI model or API that discovered this event: SerpAPI, GPT-5.2, Gemini, Claude, etc.';
