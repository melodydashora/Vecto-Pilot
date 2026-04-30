-- 2026-04-29: Plan G — discovered_traffic cache table (circuit breaker for Phase F regression class)
--
-- Purpose: snapshot-scoped cache of TomTom incidents, decoupled from briefing assembly.
-- The Phase F regression (briefing-service.js silently dropping lat/lon from prioritizedIncidents)
-- silently disabled the map's incident layer. The lat NOT NULL constraint here makes that
-- regression class structurally impossible at the cache boundary: incidents without coords
-- get filtered before insert (clean), or fail loudly at insert (visible bug), but never silent.
--
-- Lifecycle: ON DELETE CASCADE from snapshots(snapshot_id) → traffic rows live and die with
-- the snapshot they're scoped to. No new truncation mechanism needed — piggybacks on existing
-- snapshot lifecycle (matches the events pipeline pattern + Rule 11 snapshot fidelity).

CREATE TABLE IF NOT EXISTS discovered_traffic (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  device_id       text NOT NULL,
  incident_id     text NOT NULL,                   -- TomTom's stable id (per-snapshot dedup)
  category        text NOT NULL,                   -- 'Jam', 'Lane Closed', 'Road Works', 'Accident', etc.
  severity        text NOT NULL,                   -- 'high' | 'medium' | 'low'
  description     text,
  road            text,
  location        text,
  is_highway      boolean NOT NULL DEFAULT false,
  delay_minutes   integer,
  length_miles    double precision,
  distance_miles  double precision,                -- from driver's snapshot position
  lat             double precision NOT NULL,       -- enforce coords at write time
  lng             double precision NOT NULL,
  raw_payload     jsonb,                           -- full TomTom incident object for forensics
  fetched_at      timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT discovered_traffic_snapshot_incident_unique UNIQUE (snapshot_id, incident_id)
);

CREATE INDEX IF NOT EXISTS idx_discovered_traffic_snapshot ON discovered_traffic(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_discovered_traffic_device   ON discovered_traffic(device_id);

COMMENT ON TABLE discovered_traffic IS
  'Snapshot-scoped cache of TomTom traffic incidents. Decouples map render path from briefing consolidation. lat/lng NOT NULL is the structural defense against the 2026-04 Phase F regression class (briefing-service silently dropping coords).';
COMMENT ON COLUMN discovered_traffic.snapshot_id IS
  'FK to snapshots; ON DELETE CASCADE means traffic rows are pruned with their snapshot.';
COMMENT ON COLUMN discovered_traffic.incident_id IS
  'TomTom-provided stable id, used with snapshot_id for per-snapshot dedup.';
