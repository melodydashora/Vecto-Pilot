> **Last Verified:** 2026-04-14

# Strategy API (`server/api/strategy/`)

## Purpose

Strategy generation pipeline and read API for venue recommendations (Smart Blocks).

## Files

| File | Route | Purpose |
|------|-------|---------|
| `blocks-fast.js` | `/api/blocks-fast` | Pipeline trigger: briefing → strategy → venues |
| `content-blocks.js` | `/api/blocks/*` | Primary read-only polling (camelCase, current client contract) |
| `strategy.js` | `/api/strategy/*` | Legacy summary routes + daily strategy + retry |
| `strategy-events.js` | `/events/*` | SSE real-time strategy/blocks updates |
| `tactical-plan.js` | `/api/strategy/tactical-plan` | AI tactical analysis for missions |

## Client Usage Pattern

The current client (`CoPilotContext`) uses this flow:

1. **Trigger:** `POST /api/blocks-fast` → starts pipeline
2. **Poll:** `GET /api/blocks/strategy/:snapshotId` (3s interval) → strategy + blocks in camelCase
3. **Briefing sections:** `GET /api/briefing/*` via `useBriefingQueries()` → weather, traffic, events, news, closures, airport
4. **Daily strategy:** `POST /api/strategy/daily/:snapshotId` → on-demand 8-12hr plan
5. **SSE:** `/events/strategy`, `/events/blocks` → real-time notifications that trigger React Query refetch

Route constants are in `client/src/constants/apiRoutes.ts`.

## Endpoints

### Primary (current client contract)

| Method | Route | Purpose | Response |
|--------|-------|---------|----------|
| POST | `/api/blocks-fast` | Trigger full pipeline | `{ status, blocks, strategy, rankingId }` |
| GET | `/api/blocks-fast?snapshotId=X` | Generate-if-missing | Same as POST |
| GET | `/api/blocks/strategy/:snapshotId` | Poll for completion (camelCase) | `{ status, snapshotId, strategy, blocks, phase }` |
| POST | `/api/strategy/daily/:snapshotId` | Generate daily strategy | `{ ok, strategy }` |
| POST | `/api/strategy/:snapshotId/retry` | Retry failed pipeline | `{ status }` |

### Legacy (admin/debug, not used by current client)

| Method | Route | Purpose | Note |
|--------|-------|---------|------|
| GET | `/api/strategy/:snapshotId` | Summary + partial briefing (mixed case) | Prefer `blocks/strategy` |
| GET | `/api/strategy/briefing/:snapshotId` | Full briefing (DB column names) | Prefer `/api/briefing/*` |
| GET | `/api/strategy/history` | User strategy history | Active, used by admin |
| POST | `/api/strategy/seed` | Seed strategy (dev) | Dev only |
| POST | `/api/strategy/run/:snapshotId` | Direct run (dev) | Dev only |

## Pipeline Flow

```
POST /api/blocks-fast
    ↓
Phase: analyzing (10-15s)
  BRIEFING_* roles → briefings table (7 parallel subsystems)
    ↓
Phase: immediate (5-8s)
  STRATEGY_TACTICAL role → strategies.strategy_for_now
  Input: snapshot + briefing + driver preferences + earnings context
    ↓
Phase: venues (6-10s)
  VENUE_SCORER role → ranking_candidates
  Input: strategy + briefing + live discovered_events (NEAR/FAR bucketed)
    ↓
Phase: routing (2-5s) → Google Routes API
Phase: places (2-5s) → Google Places API
Phase: verifying (5-8s) → VENUE_EVENT_VERIFIER role
Phase: complete → response
```

See `docs/architecture/STRATEGY.md` for full architecture and `docs/AI_ROLE_MAP.md` for model ownership.

## Response Shapes

### GET /api/blocks/strategy/:snapshotId (primary polling)

```json
{
  "status": "ok",
  "snapshotId": "uuid",
  "timeElapsedMs": 45000,
  "phase": "complete",
  "strategy": {
    "strategyForNow": "GO: Position near...",
    "consolidated": "8-12 hour plan..."
  },
  "blocks": [
    {
      "name": "Venue Name",
      "coordinates": { "lat": 33.123, "lng": -96.456 },
      "estimatedDistanceMiles": 5.2,
      "driveTimeMinutes": 11,
      "valuePerMin": 0.75,
      "valueGrade": "B",
      "proTips": ["tip1", "tip2"],
      "isOpen": true,
      "hasEvent": true,
      "eventBadge": "Concert at 7 PM",
      "venueId": "uuid",
      "eventSummary": "concert at 19:00"
    }
  ],
  "rankingId": "uuid"
}
```

## Key Implementation Notes

### Staleness Detection

`POST /api/blocks-fast` checks strategy age > 30 minutes AND stuck status → resets and re-runs.

### toApiBlock() Transformer

All block responses use `toApiBlock()` from `server/validation/transformers.js` for consistent camelCase output. Never use manual field mapping.

### Advisory Locks

PostgreSQL `pg_advisory_xact_lock` prevents duplicate pipeline runs for the same snapshot.
