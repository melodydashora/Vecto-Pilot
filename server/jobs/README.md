# Jobs Module (`server/jobs/`)

## Purpose

Background workers for async processing. Currently contains the strategy consolidation listener.

## Files

| File | Purpose |
|------|---------|
| `triad-worker.js` | LISTEN-only consolidation worker |

## triad-worker.js

Event-driven worker that listens for PostgreSQL NOTIFY events on the `strategy_ready` channel.

### How It Works

```
1. Postgres NOTIFY 'strategy_ready' (from blocks-fast.js)
       ↓
2. triad-worker.js receives notification
       ↓
3. Verify minstrategy + briefing are present
       ↓
4. Call consolidateStrategy() → write consolidated_strategy
       ↓
5. Call generateEnhancedSmartBlocks() → write rankings
```

### Key Features

- **No polling**: Event-driven via Postgres LISTEN/NOTIFY
- **Graceful shutdown**: Handles SIGINT/SIGTERM
- **Idempotent**: Checks if consolidation already done

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
[triad-worker] Listening for strategy_ready events...
[triad-worker] Received strategy_ready for snapshot abc123
[triad-worker] Consolidation complete for abc123
```

## Connections

- **Imports from:** `../lib/ai/providers/consolidator.js`, `../lib/venue/enhanced-smart-blocks.js`
- **Spawned by:** `../bootstrap/workers.js`
- **Triggered by:** Postgres NOTIFY from `../routes/blocks-fast.js`

## Worker Modes

| Mode | Behavior |
|------|----------|
| `mono` | Worker runs in same process as web server |
| `webservice` | No worker (external process handles) |
| `worker` | Worker only, no web routes |

## Import Paths

```javascript
// From server/jobs/
import { consolidateStrategy } from '../lib/ai/providers/consolidator.js';
import { generateEnhancedSmartBlocks } from '../lib/venue/enhanced-smart-blocks.js';
import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
```
