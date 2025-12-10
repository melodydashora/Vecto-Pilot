# Infrastructure Module (`server/lib/infrastructure/`)

## Purpose

Background job queue infrastructure for fire-and-forget tasks.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `job-queue.js` | Background job queue with retry | `jobQueue.enqueue()` |

## Usage

```javascript
import { jobQueue } from '../../lib/infrastructure/job-queue.js';

// Enqueue a fire-and-forget job
await jobQueue.enqueue('strategy-gen-123', async () => {
  await generateStrategy(snapshotId);
}, { maxRetries: 3, context: { snapshotId } });

// Get queue metrics
const metrics = jobQueue.getMetrics();
// { total: 10, succeeded: 8, failed: 1, retrying: 1 }

// Get job status
const job = jobQueue.getJob('strategy-gen-123');
// { status: 'succeeded', attempts: 1, ... }
```

## Features

- Fire-and-forget execution (non-blocking)
- Automatic retry with exponential backoff
- Job status tracking
- Metrics for monitoring

## Connections

- **Used by:** `server/api/location/location.js`, `server/api/health/job-metrics.js`
- **For logging:** Use `server/logger/` instead

## Import Paths

```javascript
// From server/api/*/
import { jobQueue } from '../../lib/infrastructure/job-queue.js';

// From server/jobs/
import { jobQueue } from '../lib/infrastructure/job-queue.js';
```
