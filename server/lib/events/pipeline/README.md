> **Last Verified:** 2026-01-09

# Event Pipeline (`server/lib/events/pipeline/`)

## Purpose

Canonical modules for the ETL (Extract → Transform → Load) pipeline that processes event data from discovery providers through to database storage and briefings.

## Architecture

```
RawEvent (providers) → NormalizedEvent → ValidatedEvent → StoredEvent (DB)
                                                              ↓
BriefingEvent ← (DB read) ← discovered_events ← (DB write)
```

**Key Invariant:** Strategy LLMs ONLY receive BriefingEvent from DB rows. Raw provider payloads are NEVER passed to strategy LLMs.

## Modules

| File | Purpose | Key Functions |
|------|---------|---------------|
| `types.js` | JSDoc type definitions | RawEvent, NormalizedEvent, ValidatedEvent, StoredEvent, BriefingEvent |
| `normalizeEvent.js` | Raw → Normalized transformation | normalizeEvent, normalizeEvents, normalizeTitle, normalizeDate, normalizeTime |
| `validateEvent.js` | Hard filter validation | validateEvent, validateEventsHard, needsReadTimeValidation |
| `hashEvent.js` | MD5 hash for deduplication | generateEventHash, buildHashInput, eventsHaveSameHash |

## Usage

### Normalization

```javascript
import { normalizeEvent, normalizeEvents } from '../events/pipeline/normalizeEvent.js';

// Single event
const normalized = normalizeEvent(rawEvent, { city: 'Dallas', state: 'TX' });

// Batch
const normalizedArray = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });
```

### Validation

```javascript
import { validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../events/pipeline/validateEvent.js';

// Validate at STORE time (canonical)
const { valid, invalid, stats } = validateEventsHard(normalizedEvents, {
  logRemovals: true,
  phase: 'SYNC_EVENTS'
});

// Check if read-time validation needed (for legacy rows)
if (needsReadTimeValidation(row.schema_version)) {
  // Row was stored before current validation rules - re-validate
}
```

### Hashing

```javascript
import { generateEventHash, eventsHaveSameHash } from '../events/pipeline/hashEvent.js';

// Generate hash for storage/dedup
const hash = generateEventHash(normalizedEvent);

// Compare events
if (eventsHaveSameHash(event1, event2)) {
  // These are duplicates
}
```

## Hash Contract (2026-01-09)

```
Hash input = normalize(title_stripped) + "|" + normalize(venue_address) + "|" + date + "|" + time
Hash algorithm = MD5 (32-char hex)
```

**Title Stripping:** Removes venue suffixes like " at Venue", " @ Venue", " - Venue" to prevent duplicates like:
- "Cirque du Soleil" vs "Cirque du Soleil at Cosm"

**Time Inclusion:** Same event at different times produces different hashes:
- Matinee show at 14:00
- Evening show at 20:00

## Validation Rules (VALIDATION_SCHEMA_VERSION = 2)

| Rule | Field | Pattern |
|------|-------|---------|
| Required | title | Must be non-empty |
| Required | venue_name OR address | At least one location |
| Required | event_date | Must be YYYY-MM-DD format |
| Required | event_time | Must be non-empty |
| TBD/Unknown | title, venue, address, time | Pattern matching for incomplete data |

**Patterns Rejected:**
- `TBD`, `Unknown`, `To Be Determined`, `Not Yet Announced`
- `Various Locations`, `Coming Soon`

## When to Call Validation

1. **At STORE time** (sync-events.mjs) - PRIMARY, canonical location
2. **At READ time** ONLY for legacy rows with `schema_version < VALIDATION_SCHEMA_VERSION`

This prevents redundant validation of already-clean data while ensuring legacy data is filtered.

## Related Files

| File | Relationship |
|------|--------------|
| `server/scripts/sync-events.mjs` | Primary consumer of all modules |
| `server/lib/briefing/briefing-service.js` | Uses validateEventsHard for legacy compat |
| `server/lib/ai/providers/consolidator.js` | Uses validateEventsHard for read-time validation |
| `server/logger/workflow.js` | Provides eventsLog for ETL phase logging |

## Testing

```bash
node tests/events/pipeline.test.js
```

See `tests/events/README.md` for test documentation.
