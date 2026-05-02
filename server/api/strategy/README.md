> **Last Verified:** 2026-01-10

# Strategy API (`server/api/strategy/`)

## Purpose

Strategy generation pipeline - the core endpoint for venue recommendations.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `blocks-fast.js` | `/api/blocks-fast` | Main strategy + venue generation (triggers pipeline) |
| `strategy.js` | `/api/strategy/*` | Strategy fetching, retry, daily strategy |
| `content-blocks.js` | `/api/blocks/*` | Read-only block status polling (NO generation) |
| `strategy-events.js` | `/events/*` | SSE real-time strategy updates |
| `tactical-plan.js` | `/api/strategy/tactical-plan` | AI tactical analysis for missions |

### blocks-fast.js vs content-blocks.js (IMPORTANT)

| Endpoint | File | Purpose | Generates? |
|----------|------|---------|------------|
| `/api/blocks-fast` | `blocks-fast.js` | Full pipeline trigger | **YES** - triggers strategy + venues |
| `/api/blocks/strategy/:id` | `content-blocks.js` | Status polling | **NO** - read-only, returns current state |

**Usage Pattern:**
1. Client calls `POST /api/blocks-fast` to trigger generation
2. Client polls `GET /api/blocks/strategy/:snapshotId` until status is `ok`
3. SSE `/events/strategy` provides real-time updates (when working)

**2026-01-10 Update:** `content-blocks.js` now uses `toApiBlock()` transformer instead of manual mapping for consistent casing.

## Endpoints

### Main Pipeline
```
POST /api/blocks-fast             - Trigger full strategy generation
GET  /api/blocks-fast             - Get blocks for snapshot
```

### Strategy Access
```
GET  /api/strategy/:snapshotId    - Get strategy for snapshot
POST /api/strategy/:id/retry      - Retry failed strategy
POST /api/strategy/daily/:id      - Generate 8-12hr daily strategy (on-demand)
GET  /api/strategy/history        - Get strategy history for user
```

### Block Polling
```
GET  /api/blocks/strategy/:id     - Poll for strategy + blocks completion
```

### Real-time Events (SSE)
```
GET  /events/strategy             - SSE stream for strategy_ready notifications
GET  /events/blocks               - SSE stream for blocks_ready notifications
```

## Strategy Pipeline Flow

```
POST /api/blocks-fast
    ↓
Phase 1: Briefing
  - Briefer (Gemini 3.0 Pro) → events, traffic, news, weather
    ↓
Phase 2: Immediate Strategy
  - GPT-5.2 → strategy_for_now (1hr tactical)
    ↓
Phase 3: Venue Generation
  - Venue Planner (GPT-5.2) → Smart Blocks
  - Google APIs → distances, business hours
    ↓
Return venue recommendations

POST /api/strategy/daily/:snapshotId (On-Demand)
    ↓
Daily Consolidator (Gemini) → consolidated_strategy (8-12hr)
```

## Response Format

### POST /api/blocks-fast Response

```json
{
  "status": "ok",
  "snapshot_id": "uuid",
  "blocks": [
    {
      "name": "Venue Name",
      "coordinates": { "lat": 33.123, "lng": -96.456 },
      "estimated_distance_miles": 5.2,
      "driveTimeMinutes": 11,
      "proTips": ["tip1", "tip2"],
      "businessHours": "5:00 PM - 2:00 AM",
      "isOpen": true
    }
  ],
  "ranking_id": "uuid",
  "strategy": {
    "strategy_for_now": "Immediate 1-hour tactical advice",
    "consolidated": "8-12 hour strategic overview (if requested)"
  },
  "audit": [...]
}
```

### GET /api/blocks/strategy/:snapshotId Response

```json
{
  "status": "ok|pending|pending_blocks|missing|error",
  "snapshot_id": "uuid",
  "timeElapsedMs": 12345,
  "phase": "starting|resolving|analyzing|immediate|venues|enriching|complete",
  "strategy": {
    "strategy_for_now": "...",
    "consolidated": "...",
    "holiday": "none|christmas|...",
    "briefing": { "events": [], "news": [], "traffic": {} }
  },
  "blocks": [...],
  "ranking_id": "uuid"
}
```

**Important:** The `strategy` object is always included in successful responses so the UI can display strategy text alongside venue blocks.

## Connections

- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Uses:** `../../lib/ai/providers/` for AI calls
- **Uses:** `../../lib/venue/` for enrichment
- **Called by:** Client on location change

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { strategies, snapshots, rankings, ranking_candidates, briefings } from '../../../shared/schema.js';

// AI providers
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { runImmediateStrategy, runConsolidator } from '../../lib/ai/providers/consolidator.js';

// Strategy utils
import { ensureStrategyRow, updatePhase } from '../../lib/strategy/strategy-utils.js';

// Venue lib
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
```

## Key Implementation Notes

### isOpen Field Path and Casing (Updated 2026-01-10)

The `isOpen` field is stored in `ranking_candidates.features.isOpen` (not in `business_hours`).

**Casing Tolerance:** Due to mixed snake_case/camelCase in the codebase, always use the transformer:

```javascript
// RECOMMENDED: Use transformer for consistent output
import { toApiBlock } from '../../validation/transformers.js';
const apiBlock = toApiBlock(dbBlock);  // Handles all casing variants

// blocks-fast.js mapCandidatesToBlocks - fallback chain
isOpen: c.features?.isOpen ?? c.features?.is_open ?? c.isOpen ?? c.is_open ?? null
```

**Why?** The `business_hours` field contains the condensed hours string (e.g., "5:00 PM - 2:00 AM"), while `isOpen` is stored in the `features` JSONB column set during venue enrichment.

### Stale isOpen Values

The server-side `isOpen` is calculated once during venue enrichment. For real-time accuracy, the client (`BarsTable.tsx`) trusts the server's timezone-aware calculation. See `client/src/components/README.md` for details.

### Staleness Detection (Added 2026-01-10)

**Problem:** Previous sessions could leave `status='pending_blocks'` if blocks generation failed mid-execution. New requests would see "complete" status and serve stale cached data instead of running fresh TRIAD pipeline.

**Fix:** POST `/api/blocks-fast` now checks strategy staleness:
- Threshold: 30 minutes (pipeline normally completes in ~2 minutes)
- If stale AND status is `pending_blocks` or in-progress → reset to `pending` and delete stale data
- Deletes: strategy row reset, triad_job row, briefing row
- Result: Fresh TRIAD pipeline runs with new briefing + strategy

```javascript
// Staleness check (line 576-602 in blocks-fast.js)
const STALENESS_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const strategyAge = Date.now() - new Date(existingStrategy.updated_at).getTime();
if (strategyAge > STALENESS_THRESHOLD_MS && (isStuckPendingBlocks || isStuckInProgress)) {
  // Reset and regenerate
}
```

### Known Issues (2026-01-10)

See `docs/DOC_DISCREPANCIES.md` for tracked issues:
- **S-001:** SSE `strategy_ready` only fires for `consolidated_strategy`, not `strategy_for_now` - polling dominates
- **S-002:** Advisory locks use session-level (can leak) instead of transaction-scoped
- **S-003:** Error message says "consolidated" but checks `strategy_for_now`

### Strategy Types

| Field | Purpose | Generated |
|-------|---------|-----------|
| `strategy_for_now` | 1-hour tactical "GO NOW" advice | Automatically (blocks-fast) |
| `consolidated_strategy` | 8-12 hour daily planning | On-demand (POST /api/strategy/daily) |

## Logging Conventions (matrixLog Tier 3 — 2026-05-02)

This module uses the `matrixLog` 8-field structured logger (`server/logger/matrix.js`).

### Categories used

- `category: 'STRATEGY'` — pipeline orchestration (formerly `TRIAD`; aliased per memory row 233)
- `connection`: `'AI'` for `callModel(...)` calls; `'DB'` for `strategies` / `rankings` / `ranking_candidates` writes; `'SSE'` for `strategy_ready` broadcasts
- `action`: `VERIFY` (snapshot/briefing readiness checks), `DISPATCH` (AI calls), `STORE`, `RETRY`, `EMIT_READY`, `STALENESS_RESET`, etc.
- `roleName`: `STRATEGIST`, `BRIEFER`, `CONSOLIDATOR`, `VENUE_PLANNER` (matches `model-registry.js` roles)
- `tableName`: `STRATEGIES`, `RANKINGS`, `RANKING_CANDIDATES`, `BRIEFINGS`, `TRIAD_JOBS` (when `connection='DB'`)
- `location`: `blocks-fast.js:<functionName>`, `strategy.js:<functionName>`, etc.

### Redaction policy

Per Tier 3 plan §3 and matrixLog spec at `server/logger/matrix.js:26-39`:

- **Coordinates** — never in messages.
- **City / state** — never in messages; available via JSON sidecar.
- **Snapshot context fields** (timezone, day_part, holiday flags) — dropped from messages per "content text" rule. Field-presence flags OK.
- **Snapshot ID** — full UUID forbidden in messages; correlation via `withContext({ snapshot_id })` JSON output.

### `action: 'VERIFY'` — what it means

In `blocks-fast.js`, `action: 'VERIFY'` indicates a pre-pipeline readiness check (e.g., "snapshot row populated", "briefing fields present"). Replaces the legacy inline `[VERIFY]` prefix that lived in message strings before the Tier 3 migration. Search past logs for `[STRATEGY] [VERIFY]` to find these checkpoints.
