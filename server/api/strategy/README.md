# Strategy API (`server/api/strategy/`)

## Purpose

Strategy generation pipeline - the core endpoint for venue recommendations.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `blocks-fast.js` | `/api/blocks-fast` | Main strategy + venue generation |
| `strategy.js` | `/api/strategy/*` | Strategy fetching, retry, daily strategy |
| `content-blocks.js` | `/api/blocks/*` | Block status polling |
| `strategy-events.js` | `/events/*` | SSE real-time strategy updates |

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
  - GPT-5.1 → strategy_for_now (1hr tactical)
    ↓
Phase 3: Venue Generation
  - Venue Planner (GPT-5.1) → Smart Blocks
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

### isOpen Field Path

The `isOpen` field is stored in `ranking_candidates.features.isOpen` (not in `business_hours`):

```javascript
// blocks-fast.js - Correct path
isOpen: c.features?.isOpen,  // ✓ Correct
// NOT: c.business_hours?.isOpen  // ✗ Wrong - business_hours is a string
```

**Why?** The `business_hours` field contains the condensed hours string (e.g., "5:00 PM - 2:00 AM"), while `isOpen` is stored in the `features` JSONB column set during venue enrichment.

### Stale isOpen Values

The server-side `isOpen` is calculated once during venue enrichment. For real-time accuracy, the client (`BarsTable.tsx`) recalculates based on current time. See `client/src/components/README.md` for details.

### Strategy Types

| Field | Purpose | Generated |
|-------|---------|-----------|
| `strategy_for_now` | 1-hour tactical "GO NOW" advice | Automatically (blocks-fast) |
| `consolidated_strategy` | 8-12 hour daily planning | On-demand (POST /api/strategy/daily) |
