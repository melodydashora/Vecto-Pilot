# Infrastructure Module (`server/lib/infrastructure/`)

## Purpose

Cross-cutting infrastructure concerns: logging and background job queue.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `job-queue.js` | Background job queue | `enqueue()`, `processQueue()` |
| `logger.js` | Structured logging | `log()`, `logError()` |

## Usage

### Job Queue
```javascript
import { enqueue, processQueue } from './job-queue.js';

// Add job to queue
await enqueue({
  type: 'strategy_generation',
  payload: { snapshotId: '...' }
});

// Process pending jobs (called by worker)
await processQueue();
```

### Logging
```javascript
import { log, logError } from './logger.js';

log('strategy', 'Starting generation', { snapshotId });
// Output: [strategy] Starting generation { snapshotId: '...' }

logError('strategy', 'Generation failed', error);
// Output: [strategy] ERROR: Generation failed { message: '...', stack: '...' }
```

## Connections

- **Imports from:** `../../db/` (for persistent queue)
- **Exported to:** All modules (logging), `../../jobs/` (queue processing)

## Log Format

```
[module] message { context }
```

All logs include:
- Module prefix in brackets
- Human-readable message
- JSON context object

## Import Paths

```javascript
// From server/api/*/
import { enqueue } from '../../lib/infrastructure/job-queue.js';
import { log, logError } from '../../lib/infrastructure/logger.js';

// From server/lib/*/
import { log, logError } from '../infrastructure/logger.js';

// From server/jobs/
import { processQueue } from '../lib/infrastructure/job-queue.js';
```
