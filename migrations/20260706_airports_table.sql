-- 20260706_airports_table.sql
--
-- Airports table: the deterministic identity layer for airport selection
-- (todo #22, Melody-approved 50-mile radius). Replaces BOTH prior sources:
--   1. faa-asws.js getMajorUSAirports — a HARDCODED 20-airport US-only list
--      with coordinates baked into code (violated no-hardcoded-location;
--      missing Austin/Nashville/San Diego entirely)
--   2. the BRIEFING_AIRPORT prompt asking the model to "find airports within
--      50 miles" — model-discovered sets varied run to run (1 vs 3 airports)
--
-- Coordinates are seeded EXCLUSIVELY by scripts/seed-airports.mjs via Google
-- Places Text Search (rule: coords from Google/DB at six decimals, never from
-- a model). This migration creates the table only — no coordinate literals.
--
-- terminals jsonb: per-airport static inventory —
--   [{ terminal, clear_available, checkpoints_estimate, rideshare_pickup }]
-- terminal facts carry provenance (e.g. DFW Clear-at-E is Melody-stated);
-- live checkpoint names/waits are researched by the BRIEFING_AIRPORT role at
-- briefing time, never stored here.

CREATE TABLE IF NOT EXISTS airports (
  iata TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  country TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  coord_source TEXT NOT NULL DEFAULT 'google_places',
  is_major BOOLEAN NOT NULL DEFAULT true,
  terminals JSONB,
  terminals_provenance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_airports_lat_lng ON airports (lat, lng);
