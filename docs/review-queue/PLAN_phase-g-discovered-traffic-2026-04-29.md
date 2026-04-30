# PLAN — Phase G: `discovered_traffic` Cache Table (Circuit Breaker)

**Date:** 2026-04-29
**Author:** Claude Opus 4.7 (1M context)
**Status:** DRAFT — awaiting Melody approval
**Predecessor:** Plan A (Phase F Restore) lands first per Path C

---

## Objective

Decouple the strategy map's traffic-incident layer from briefing assembly via a snapshot-scoped cache table. Make the Phase F regression class (briefing layer strips coords → map silently disabled) **structurally impossible at the cache boundary** by enforcing `lat NOT NULL, lng NOT NULL` at write time.

This is not just a cache — it's a **circuit breaker**. A bug in briefing consolidation can no longer silently disable the map.

## Architecture

```
TomTom called (existing path in briefing-service.js:2030)
  ↓
  ├─→ INSERT into discovered_traffic (NEW — snapshot-scoped, lat/lng enforced)
  └─→ Gemini consolidation → briefings.traffic.narrative (existing, unchanged)

Map render path:
  Client → useTrafficIncidents hook → GET /api/traffic/incidents?snapshot_id=<current>
                                    → returns rows from discovered_traffic
                                    → StrategyMap renders triangles
```

Briefing narrative (text summary in traffic card) continues to read from `briefings.traffic` exactly as today. The map gets its own data path.

## Schema (parallel to `discovered_events`)

```sql
CREATE TABLE discovered_traffic (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  device_id       text NOT NULL,
  incident_id     text NOT NULL,                  -- TomTom's stable id for per-snapshot dedup
  category        text NOT NULL,                  -- 'Jam', 'Lane Closed', 'Road Works', etc.
  severity        text NOT NULL,                  -- 'high'|'medium'|'low'
  description     text,
  road            text,
  location        text,
  is_highway      boolean NOT NULL DEFAULT false,
  delay_minutes   integer,
  length_miles    double precision,
  distance_miles  double precision,
  lat             double precision NOT NULL,      -- enforce coords at write time
  lng             double precision NOT NULL,
  raw_payload     jsonb,                          -- full TomTom incident object (forensics)
  fetched_at      timestamp with time zone NOT NULL DEFAULT now(),

  UNIQUE (snapshot_id, incident_id)
);

CREATE INDEX idx_discovered_traffic_snapshot ON discovered_traffic(snapshot_id);
CREATE INDEX idx_discovered_traffic_device   ON discovered_traffic(device_id);
```

**Key structural choices:**
- `lat NOT NULL, lng NOT NULL` — incidents without coords get filtered before insert, never silently dropped at render time
- `ON DELETE CASCADE` from `snapshots` — piggybacks on the existing snapshot lifecycle; no new truncation mechanism needed
- `UNIQUE (snapshot_id, incident_id)` — per-snapshot dedup (TomTom can return the same incident multiple times across pages or close-in-time fetches)

## Lifecycle (truncates per user sign-off / snapshot rotation)

| Event | Effect on `discovered_traffic` |
|---|---|
| New snapshot created | Next TomTom call writes new rows scoped to new `snapshot_id`. Old snapshot's rows still exist but no longer queried. |
| Snapshot pruned (existing mechanism) | `ON DELETE CASCADE` removes traffic rows automatically. |
| User sign-off | Existing snapshot-clear logic (per Zombie Snapshot fix 2026-04-10) clears the user's snapshot → cascade removes traffic rows. |

If snapshots aren't currently pruned aggressively, the table grows monotonically per device. Either:
- (a) accept slow growth (rows are small, ~500 bytes; 1 snapshot ≈ 15 rows; 1000 snapshots ≈ 7.5k rows ≈ 4MB — negligible)
- (b) add a TTL job: `DELETE FROM discovered_traffic WHERE snapshot_id IN (SELECT snapshot_id FROM snapshots WHERE created_at < now() - interval '7 days')` nightly
- (c) extend the existing snapshot-prune job to also prune traffic via cascade

Recommendation: (a) for now, (c) when we add the prune job for snapshots.

## Files affected (~7-8)

| File | Action |
|---|---|
| `migrations/20260429_discovered_traffic.sql` | NEW — DDL above |
| `shared/schema.js` | NEW — Drizzle table definition for `discoveredTraffic` |
| `server/lib/traffic/tomtom.js` | ADD — write path: after `getTomTomTraffic` returns, INSERT incidents (with coords) into `discovered_traffic` keyed by current snapshot |
| `server/lib/briefing/briefing-service.js` | UNCHANGED narrative path; only the write site for traffic data moves to live alongside the consolidation |
| `server/api/traffic/index.js` (or extend existing) | NEW endpoint: `GET /api/traffic/incidents?snapshot_id=<uuid>` returns array of `discovered_traffic` rows for that snapshot |
| `client/src/hooks/useTrafficIncidents.ts` | REFACTOR — replace `briefingData.traffic.incidents` source with `fetch('/api/traffic/incidents?snapshot_id=...')` |
| `client/src/components/strategy/StrategyMap.tsx` | UNCHANGED (consumes the same prop) |
| `docs/architecture/BRIEFING.md` (and/or VENUELOGIC.md / EVENTS.md sibling) | NEW section documenting the data flow + circuit-breaker rationale |

## Test plan (Melody to verify after migration + Play restart)

| # | Test | Expected |
|---|---|---|
| 1 | Apply migration on dev DB | `psql $DATABASE_URL -f migrations/20260429_discovered_traffic.sql` succeeds; `\d discovered_traffic` shows columns |
| 2 | Trigger snapshot, observe rows | After /co-pilot/strategy loads with TOMTOM_API_KEY set: `SELECT count(*) FROM discovered_traffic WHERE snapshot_id = '<your-snapshot>';` returns N > 0 |
| 3 | All rows have coords | `SELECT count(*) FROM discovered_traffic WHERE lat IS NULL OR lng IS NULL;` returns 0 (the constraint enforces this) |
| 4 | API endpoint returns rows | `curl /api/traffic/incidents?snapshot_id=<uuid>` returns same rows as DB query |
| 5 | Map renders triangles from new path | Reload `/co-pilot/strategy` — triangles render, count matches API result |
| 6 | Briefing narrative still works | Traffic card text summary still appears (regression check) |
| 7 | Snapshot rotation preserves both sides | New snapshot fires → new rows inserted with new `snapshot_id`; old rows still exist (until pruned) |
| 8 | Constraint enforcement | Manually attempt `INSERT INTO discovered_traffic (..., lat, lng, ...) VALUES (..., NULL, NULL, ...)` — fails with `null value in column "lat"` |

## Risks

- **Double-write storms** — if two snapshot-rotations happen near-simultaneously and TomTom calls both fire, `UNIQUE (snapshot_id, incident_id)` protects against duplicate rows within a snapshot, but each snapshot still gets its own write. Acceptable cost.
- **Briefing consolidation drift** — the narrative path (`briefings.traffic.narrative`) continues to consume the same TomTom data shape; if Gemini's prompt is sensitive to incident shape changes, that's a separate concern but unaffected by this plan.
- **Migration on prod** — applies cleanly on dev; prod application is a separate Melody-approved deploy step (per Rule 13 + the prod-migration-checklist memory row from the pending.md retirement plan).

## Why "circuit breaker" not "cache"

A cache speeds up repeat reads. A circuit breaker isolates failure domains. The Phase F regression was a circuit-breaker case, not a cache miss: a briefing-layer bug silently disabled the map. This plan's value isn't read speedup — it's that **the map can no longer be silently disabled by upstream consolidation bugs**. Naming it correctly reframes the value proposition and makes the design constraints (NOT NULL coords, snapshot scoping) load-bearing rather than incidental.
