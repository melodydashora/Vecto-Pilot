# Logging & Observability

Workflow-aware logging for pipeline operations. Located in `server/logger/`.

## Workflow Logger

Pipeline operations use structured logging that shows clear phase progression.

### Example Output

```
🎯 [TRIAD 1/4 - Strategist] Starting for abc12345
✅ [TRIAD 1/4 - Strategist] Saved (706 chars)
🎯 [TRIAD 3/4 - Daily+NOW Strategy] Starting for abc12345
✅ [TRIAD 3/4 - Daily+NOW Strategy] Saved strategy (2637 chars) (32150ms)

🏢 [VENUES START] ========== Dallas, TX (abc12345) ==========
🏢 [VENUES 1/4 - Tactical Planner] Input ready: strategy=394chars
🏢 [VENUE "The Star in Frisco"] 5.2mi, 12min, isOpen=true
🏢 [VENUE "Stonebriar Centre"] 6.8mi, 15min, isOpen=null
✅ [VENUES 4/4 - DB Store] Stored 5 candidates (78761ms)
🏁 [VENUES COMPLETE] 5 venues for Dallas, TX in 78761ms
```

## Logger Files

| File | Purpose |
|------|---------|
| `server/logger/workflow.js` | Workflow-aware logging utility |
| `server/logger/logger.js` | Module logger with correlation IDs |
| `server/logger/ndjson.js` | Structured event logging |
| `server/logger/README.md` | Full documentation |

## Workflow Phases

| Component | Phases | Labels |
|-----------|--------|--------|
| TRIAD | 4 | Strategist, Briefer, Daily+NOW Strategy, SmartBlocks |
| VENUES | 4 | Tactical Planner, Routes API, Places API, DB Store |
| BRIEFING | 3 | Traffic, Events Discovery, Event Validation |
| LOCATION | 3 | GPS Received, Geocode/Cache, Weather+Air |
| SNAPSHOT | 2 | Create Record, Enrich (Airport/Holiday) |

## Usage

### TRIAD Pipeline Logging

```javascript
import { triadLog } from '../../logger/workflow.js';

// Start a phase
triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);

// Complete a phase
triadLog.done(1, `Saved (706 chars)`);

// With timing
triadLog.done(3, `Saved strategy (2637 chars)`, 32150);
```

### Venue Pipeline Logging

```javascript
import { venuesLog } from '../../logger/workflow.js';

// Start venues workflow
venuesLog.start(`Dallas, TX (${snapshotId.slice(0, 8)})`);

// Log phase progress
venuesLog.phase(2, `Routes API: calculating distances`);

// Complete phase with timing
venuesLog.done(2, `5 venues enriched`, 348);

// Complete workflow
venuesLog.complete(`5 venues for Dallas, TX`, 78761);
```

## Logging Conventions

### 1. Always Include Venue Name

For traceability through the pipeline:

```javascript
// GOOD - Can trace "The Mitchell" through logs
console.log(`🏢 [VENUE "The Mitchell"] Route: 5.2mi, 12min`);
console.log(`🏢 [VENUE "The Mitchell"] ✅ placeId=YES, status=OPEN`);

// BAD - Generic, can't trace which venue
console.log(`[Venue Enrichment] ✅ Distance: 5.2 mi`);
```

### 2. Use Role Names, Not Model Names

```javascript
// GOOD - Role-based (doesn't change when models swap)
triadLog.phase(1, `Starting for ${snapshotId}`);
// Output: [TRIAD 1/4 - Strategist]

// BAD - Model-specific (confusing when models change)
console.log(`[minstrategy] Starting Claude Opus for snapshot`);
```

### 3. Include Snapshot ID (Truncated)

```javascript
// Always include snapshot ID for correlation
const shortId = snapshotId.slice(0, 8);
triadLog.phase(1, `Starting for ${shortId}`);
```

### 4. Log Timing for Performance Analysis

```javascript
const startTime = Date.now();
// ... operation ...
const duration = Date.now() - startTime;
triadLog.done(2, `Completed operation`, duration);
```

## Structured Logging (NDJSON)

For machine-readable logs:

```javascript
import { ndjsonLog } from '../../logger/ndjson.js';

ndjsonLog({
  event: 'strategy_generated',
  snapshot_id: snapshotId,
  model: 'claude-opus-4-5',
  tokens: 1234,
  duration_ms: 3500
});
```

Output:
```json
{"event":"strategy_generated","snapshot_id":"abc123","model":"claude-opus-4-5","tokens":1234,"duration_ms":3500,"timestamp":"2025-12-15T20:00:00Z"}
```

## Correlation IDs

Every request gets a correlation ID for tracing:

```javascript
import { createModuleLogger } from '../../logger/logger.js';

const log = createModuleLogger('venue-enrichment');

// All logs from this module include the correlation ID
log.info('Starting enrichment', { venues: 5 });
// Output: [venue-enrichment] [corr:abc123] Starting enrichment {"venues":5}
```

## ML Instrumentation

For counterfactual learning, log:
- Input snapshot hash
- Model ID and token budget
- Confidence scores
- Downstream outcome (accept/skip/abort)

```javascript
ndjsonLog({
  event: 'venue_recommendation',
  snapshot_hash: hash(snapshot),
  model_id: 'gpt-5.2',
  venue_id: venue.id,
  confidence: 0.85,
  outcome: 'accepted' // or 'skipped', 'aborted'
});
```

## See Also

- [Server Structure](server-structure.md) - Logger location
- [AI Pipeline](ai-pipeline.md) - Pipeline phases
- [Constraints](constraints.md) - Logging requirements
