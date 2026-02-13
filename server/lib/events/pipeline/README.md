> **Last Verified:** 2026-01-10

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
| `normalizeEvent.js` | Raw → Normalized transformation | normalizeEvent, normalizeEvents, normalizeTitle, normalizeDate, normalizeTime, cleanVenueName |
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

## Validation Rules (VALIDATION_SCHEMA_VERSION = 3)

> **2026-01-10: Symmetric Naming Convention**
> Fields renamed: `event_date` → `event_start_date`, `event_time` → `event_start_time`

| Rule | Field | Pattern |
|------|-------|---------|
| Required | title | Must be non-empty |
| Required | venue_name OR address | At least one location |
| Required | event_start_date | Must be YYYY-MM-DD format |
| Required | event_start_time | Must be non-empty |
| Required | event_end_time | **Must be non-empty (2026-01-10)** |
| TBD/Unknown | title, venue, address, start_time, end_time | Pattern matching for incomplete data |

**Patterns Rejected:**
- `TBD`, `Unknown`, `To Be Determined`, `Not Yet Announced`
- `Various Locations`, `Coming Soon`

### event_end_time Requirement (2026-01-10)

**Rule:** Every event MUST have an `event_end_time`. Events without end times are rejected at validation.

**Why:** Frontend (BriefingTab.tsx) requires both start and end times to display events correctly. The end time is also critical for rideshare drivers to predict pickup surge timing.

**LLM Prompt Instruction:** If end time is not listed, LLM must ESTIMATE:
- Concerts: 2-3 hours after start
- Sports: NBA ~2.5hr, NFL ~3.5hr, MLB ~3hr
- Theater: 2-3 hours
- Festivals: Use posted closing time

Events where end time cannot be determined should NOT be returned by the LLM.

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
