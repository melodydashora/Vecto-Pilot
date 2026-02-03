> **Last Verified:** 2026-01-06

# Jobs Module (`server/jobs/`)

## Purpose

Background workers for async processing.

## Files

| File | Purpose |
|------|---------|
| `triad-worker.js` | LISTEN-only SmartBlocks worker |
| `event-sync-job.js` | Daily event discovery sync |
| `event-cleanup.js` | Past event cleanup job |
| `change-analyzer-job.js` | Documentation change analyzer job |

## triad-worker.js

Event-driven worker that listens for PostgreSQL NOTIFY events on the `strategy_ready` channel.

### How It Works

```
1. Postgres NOTIFY 'strategy_ready' (from blocks-fast.js)
       ↓
2. triad-worker.js receives notification
       ↓
3. Verify strategy_for_now + briefing are present
       ↓
4. Call generateEnhancedSmartBlocks() → write rankings
       ↓
5. Send NOTIFY 'blocks_ready' for SSE listeners
```

**NOTE**: Strategy generation (briefing + immediate strategy) now runs synchronously in `blocks-fast.js`. This worker only handles SmartBlocks generation.

### Key Features

- **No polling**: Event-driven via Postgres LISTEN/NOTIFY
- **Graceful shutdown**: Handles SIGINT/SIGTERM
- **Idempotent**: Checks if blocks already generated

### Usage

Started automatically by `bootstrap/workers.js` in mono mode:

```javascript
import { startStrategyWorker } from './bootstrap/workers.js';

if (DEPLOY_MODE === 'mono') {
  startStrategyWorker();
}
```

### Manual Run

```bash
node server/jobs/triad-worker.js
```

### Logging

```
[consolidation-listener] Listening on channel: strategy_ready
[consolidation-listener] Notification: strategy_ready -> abc12345
[consolidation-listener] Status for abc12345: { hasStrategyForNow: true, hasBriefing: true }
[consolidation-listener] Generating enhanced smart blocks for abc12345...
[consolidation-listener] Enhanced smart blocks generated for abc12345
[consolidation-listener] NOTIFY blocks_ready sent for abc12345
```

## Connections

- **Imports from:** `../lib/venue/enhanced-smart-blocks.js`, `../db/drizzle.js`
- **Spawned by:** `../bootstrap/workers.js`
- **Triggered by:** Postgres NOTIFY from `../api/strategy/blocks-fast.js`

## Worker Modes

| Mode | Behavior |
|------|----------|
| `mono` | Worker runs in same process as web server |
| `webservice` | No worker (external process handles) |
| `worker` | Worker only, no web routes |

## Import Paths

```javascript
// From server/jobs/
import { generateEnhancedSmartBlocks } from '../lib/venue/enhanced-smart-blocks.js';
import { db } from '../db/drizzle.js';
import { strategies, snapshots, briefings } from '../../shared/schema.js';
```

## event-sync-job.js

Daily event discovery sync job that keeps local events fresh for all active users.

### How It Works

```
1. Runs daily at 6 AM (configurable)
       ↓
2. Clean up past events (mark is_active=false)
       ↓
3. Get unique city/state from recent snapshots (7 days)
       ↓
4. Run syncEventsForLocation() for each location
       ↓
5. Events stored with deduplication via event_hash
```

### Key Features

- **Daily schedule**: Runs at 6 AM automatically
- **Past event cleanup**: Deactivates events with event_date < today
- **Multi-location**: Syncs all active user locations
- **All AI models**: Uses daily mode (SerpAPI + GPT-5.2 + Gemini + Claude + Perplexity)
- **Geocoding**: Fills in missing lat/lng coordinates via Google Geocoding

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `EVENT_SYNC_RUN_ON_START` | Set to `true` to run sync immediately on server start |

### Manual Run

```bash
node server/jobs/event-sync-job.js
```

### Logging

```
[EventSync] DAILY EVENT SYNC STARTED
[EventSync] Step 1: Cleaning up past events...
[EventSync] Deactivated 12 past events
[EventSync] Step 2: Finding active user locations...
[EventSync] Found 3 unique locations
[EventSync] Step 3: Syncing events for each location...
[EventSync] Syncing: Dallas, TX
[EventSync] Dallas: +25 new, 8 duplicates
[EventSync] DAILY SYNC COMPLETE
```
