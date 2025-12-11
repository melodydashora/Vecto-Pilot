# Logger (`server/logger/`)

## Purpose

Centralized logging utilities for server operations.

## Files

| File | Purpose | Export |
|------|---------|--------|
| `ndjson.js` | NDJSON structured logging | `ndjson(type, data)` |
| `logger.js` | Module logger with correlation IDs | `createLogger(module)` |
| `workflow.js` | Workflow-aware pipeline logging | `triadLog`, `venuesLog`, `briefingLog`, etc. |

## Usage

```javascript
import { ndjson } from '../../logger/ndjson.js';

// Log events with structured data
ndjson('snapshot.req', { cid: correlationId, path: '/snapshot' });
ndjson('health.ok', {});
ndjson('error', { message: 'Something failed', stack: error.stack });
```

### Module Logger (logger.js)

```javascript
import { createLogger, setCorrelationId } from '../../logger/logger.js';

const log = createLogger('my-module');
log.info('Request received', { path: '/api/foo' });
log.warn('Slow response', { ms: 5000 });
log.error('Failed', { error: err.message });

// With correlation ID for request tracking
const cleanup = setCorrelationId(requestId);
log.info('Processing'); // Includes correlationId
cleanup(); // Remove from stack
```

## Output Format

### NDJSON
Each log line is a JSON object:
```json
{"ts":"2025-12-10T04:05:06.123Z","type":"snapshot.req","cid":"uuid","path":"/snapshot"}
```

Fields:
- `ts` - ISO timestamp (auto-added)
- `type` - Event type (first argument)
- `...data` - Any additional fields (spread from second argument)

## Import Paths

```javascript
// From server/api/*/
import { ndjson } from '../../logger/ndjson.js';

// From server/lib/*/
import { ndjson } from '../logger/ndjson.js';

// Dynamic import (same paths apply)
const { ndjson } = await import('../../logger/ndjson.js');
```

## Workflow Logger (workflow.js)

Pipeline-aware logging that shows workflow phases clearly:

```javascript
import { triadLog, venuesLog, briefingLog } from '../../logger/workflow.js';

// TRIAD pipeline phases
triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);  // [TRIAD 1/4 - Strategist]
triadLog.done(1, `Saved (706 chars)`);                        // ✅ [TRIAD 1/4 - Strategist]

// Venue pipeline phases
venuesLog.start(`Dallas, TX (abc12345)`);  // 🏢 [VENUES START] ========== Dallas, TX ==========
venuesLog.phase(1, `Input ready`);          // 🏢 [VENUES 1/4 - Tactical Planner]
venuesLog.done(2, `Routes calculated`, 348); // ✅ [VENUES 2/4 - Routes API] (348ms)
venuesLog.complete(`5 venues`, 78761);       // 🏁 [VENUES COMPLETE] 5 venues in 78761ms

// Individual venue logging (for traceability)
console.log(`🏢 [VENUE "The Mitchell"] 5.2mi, 12min, isOpen=true`);
```

### Workflow Phases

| Component | Phases | Description |
|-----------|--------|-------------|
| TRIAD | 3 | 1=Briefer, 2=Immediate Strategy, 3=SmartBlocks |
| VENUES | 4 | 1=Tactical Planner, 2=Routes API, 3=Places API, 4=DB Store |
| BRIEFING | 3 | 1=Traffic, 2=Events Discovery, 3=Event Validation |
| LOCATION | 3 | 1=GPS Received, 2=Geocode/Cache, 3=Weather+Air |
| SNAPSHOT | 2 | 1=Create Record, 2=Enrich (Airport/Holiday) |

### Key Convention: VENUE-SPECIFIC LOGS

Always include the **venue name** in logs for traceability:
```javascript
// GOOD - Can trace which venue is being processed
console.log(`🏢 [VENUE "The Mitchell"] Calculating route from driver...`);
console.log(`🏢 [VENUE "The Mitchell"] Route: 5.2mi, 12min`);
console.log(`🏢 [VENUE "The Mitchell"] ✅ placeId=YES, status=OPEN, hours=5:00 PM - 2:00 AM`);

// BAD - Generic, can't trace which venue
console.log(`[Venue Enrichment] ✅ Distance: 5.2 mi, Drive time: 12 min`);
```

### Key Convention: NO MODEL NAMES

Use **role names** (Briefer, Consolidator, Immediate) not model names (Claude, Gemini, GPT-5):
```javascript
// GOOD
triadLog.phase(1, `Starting for ${snapshotId}`);  // [TRIAD 1/4 - Briefer]
console.log(`[immediate-strategy] GPT-5.1 returned: ...`);

// BAD
console.log(`[gpt5] Starting strategy for snapshot`);
```

## Connections

- **Used by:** `server/api/health/`, `server/api/location/`, `server/api/strategy/`, and other routes
- **ndjson.js:** Lightweight, for structured event logging
- **logger.js:** Full-featured, for module-scoped logging with correlation
- **workflow.js:** Pipeline-aware, for tracing strategy/venue generation
