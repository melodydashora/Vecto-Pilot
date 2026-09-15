> **Last Verified:** 2026-09-13 — source and focused regression tests

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
| `hashEvent.js` | MD5 hash for storage dedup (ON CONFLICT) | generateEventHash, buildHashInput, eventsHaveSameHash |
| `deduplicateEventsSemantic.js` | Title-similarity (semantic) dedup, runs after hash dedup | deduplicateEventsSemantic, titlesMatch, normalizeTitleForComparison |
| `canonicalizeMatchup.js` | Order-invariant "a vs b" === "b vs a" canonicalization (shared by hash + semantic stages) | canonicalizeMatchup |

## Usage

### Normalization

```javascript
import { normalizeEvent, normalizeEvents } from '../events/pipeline/normalizeEvent.js';

// Single event
const normalized = normalizeEvent(rawEvent, { city: snapshot.city, state: snapshot.state });

// Batch
const normalizedArray = normalizeEvents(rawEvents, { city: snapshot.city, state: snapshot.state });
```

### Validation

```javascript
import { validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../events/pipeline/validateEvent.js';

// Validate at STORE time (canonical)
const { valid, invalid, stats } = validateEventsHard(normalizedEvents, {
  logRemovals: true,
  phase: 'SYNC_EVENTS',
  context: { timezone: snapshot.timezone }
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

## Hash Contract (2026-09-13, v5 — see hashEvent.js header for history)

```
Hash input = canonicalizeMatchup(normalize(title)) | normalize(venue_name) | extract_street(address) | normalize(city) | date
Hash algorithm = MD5 (32-char hex)
date = event_start_date for single-day; "start_end" span for multi-day events
```

**Title Stripping:** Removes venue suffixes (" at Venue", " @ Venue", " - Venue"), content
prefixes ("Live Music:", "Concert:", …) and parentheticals, so e.g.
"Cirque du Soleil at Cosm" === "Cirque du Soleil".

**Matchup order-invariance (v4, 2026-06-11):** `canonicalizeMatchup` sorts the two sides of a
"a vs b" / "a versus b" title so "Cowboys vs Eagles" === "Eagles vs Cowboys". The SAME helper
runs in `deduplicateEventsSemantic.normalizeTitleForComparison`, keeping the hash and semantic
stages in agreement. **Migration:** v3 matchup rows won't collide with the new canonical hash
until re-hashed — run `server/scripts/migrate-event-hashes.js` in the deployed env, or let the
in-pipeline safety net (`collapseDuplicateEventSpans`, per briefing fetch) drain the transient.

**No time component (since v2):** "Bruno Mars 7:00 PM" and "7:30 PM" at the same venue/date are
the same event with a corrected time — they UPDATE rather than create a duplicate.

## Validation Rules (VALIDATION_SCHEMA_VERSION = 7)

> **2026-01-10: Symmetric Naming Convention**
> Fields renamed: `event_date` → `event_start_date`, `event_time` → `event_start_time`

| Rule | Field | Pattern |
|------|-------|---------|
| Required | title | Must be non-empty |
| Required | venue_name OR address | At least one location |
| Required | event_start_date | Real calendar date in YYYY-MM-DD format |
| Required | event_start_time | Valid clock time; normalized to HH:MM |
| Required | event_end_time | Valid clock time; never invented from event category |
| TBD/Unknown | title, venue, address, start_time, end_time | Pattern matching for incomplete data |

**Patterns Rejected:**
- `TBD`, `Unknown`, `To Be Determined`, `Not Yet Announced`
- `Various Locations`, `Coming Soon`

### event_end_time Requirement (2026-01-10)

**Rule:** Every event MUST have an `event_end_time`. Events without end times are rejected at validation.

**Why:** Frontend (BriefingTab.tsx) requires both start and end times to display events correctly. The end time is also critical for rideshare drivers to predict pickup surge timing.

**Published timing only:** The discovery prompt requests verified start/end times.
Normalization preserves unknown times as null and validation rejects them. It does not
invent a category-based duration or map "All Day" to arbitrary opening hours. Overnight
end dates are inferred only from supplied valid clocks when an end date is absent.

**Unicode identity (v5):** Hash and runtime dedupe retain Unicode letters, numbers, and
combining marks under NFC normalization. Existing ASCII hash inputs are unchanged.
Previously overwritten/collapsed events cannot be reconstructed by this code change;
no historical rehash or database migration is performed. Rediscovery may create a new
correct Unicode identity alongside an older malformed identity.

**Cleanup:** `briefing/cleanup-events.js` uses each event's existing venue timezone and
compares the resolved end instant against the two-hour cutoff. An ambiguous fall-back
clock resolves to its later standard-time occurrence, conservatively retaining the event
until either possible end instant is old enough. Stored local clocks do not distinguish
the two occurrences. Missing/invalid timezone or malformed timing
is preserved with a warning count for repair, not interpreted in another driver's zone.

## When to Call Validation

1. **At STORE time** (`briefing/pipelines/events.js`) — active per-snapshot path
2. **At READ time** ONLY for legacy rows with `schema_version < VALIDATION_SCHEMA_VERSION`

This prevents redundant validation of already-clean data while ensuring legacy data is filtered.

## Related Files

| File | Relationship |
|------|--------------|
| `server/scripts/sync-events.mjs` | Legacy manual sync consumer |
| `server/lib/briefing/pipelines/events.js` | Active discovery, normalization, validation, and persistence |
| `server/lib/ai/providers/consolidator.js` | Uses validateEventsHard for read-time validation |
| `server/logger/workflow.js` | Provides eventsLog for ETL phase logging |

## Testing

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/events/ tests/eventMatchupDedup.test.js --runInBand
```

See `tests/events/README.md` for test documentation.

The cleanup SQL suite can additionally run against an installed test-only PGlite module:
set `VECTO_TEST_PGLITE_MODULE` to that package path. It creates only disposable in-memory
tables and never opens `DATABASE_URL`; without that optional dependency, its SQL cases
are skipped while the mocked failure-policy case still runs.
