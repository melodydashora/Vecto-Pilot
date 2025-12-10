# Strategy API (`server/api/strategy/`)

## Purpose

Strategy generation pipeline - the core endpoint for venue recommendations.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `blocks-fast.js` | `/api/blocks-fast` | Main strategy + venue generation |
| `strategy.js` | `/api/strategy/*` | Strategy fetching, retry |
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
POST /api/strategy/retry          - Retry failed strategy
GET  /api/strategy/status/:id     - Check generation status
```

### Block Polling
```
GET  /api/blocks/strategy/:id     - Poll for strategy completion
GET  /api/blocks/venues/:id       - Poll for venue completion
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
Phase 1 (Parallel):
  - Strategist (Claude Opus 4.5) → minstrategy
  - Briefer (Gemini 3.0 Pro) → events, traffic, news
  - Holiday Checker → holiday detection
    ↓
Phase 2 (Parallel):
  - Daily Consolidator (Gemini) → 8-12hr strategy
  - Immediate Consolidator (GPT-5.1) → 1hr strategy
    ↓
Phase 3: Venue Planner (GPT-5.1) → Smart Blocks
    ↓
Phase 4: Event Validator (Claude) → verification
    ↓
Return venue recommendations
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
    "consolidated": "8-12 hour strategic overview",
    "min": "Raw minstrategy from Claude"
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
  "strategy": {
    "strategy_for_now": "...",
    "consolidated": "...",
    "min": "...",
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
- **Uses:** `../../lib/strategy/` for pipeline
- **Uses:** `../../lib/ai/adapters/` for model calls
- **Uses:** `../../lib/venue/` for enrichment
- **Called by:** Client on location change

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { strategies, snapshots, rankings, ranking_candidates } from '../../../shared/schema.js';

// Strategy lib
import { generateStrategyForSnapshot } from '../../lib/strategy/strategy-generator.js';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';

// Venue lib
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { expensiveLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

// Logging
import { ndjson } from '../../logger/ndjson.js';
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
