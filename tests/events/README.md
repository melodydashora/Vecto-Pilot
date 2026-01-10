> **Last Verified:** 2026-01-09

# Events ETL Pipeline Tests (`tests/events/`)

## Purpose

Integration tests for the canonical ETL (Extract → Transform → Load) pipeline modules that process event data from discovery providers through to database storage.

## Structure

| File | Purpose |
|------|---------|
| `pipeline.test.js` | Tests for normalizeEvent, validateEvent, hashEvent modules |

## What These Tests Cover

### Normalization Tests (normalizeEvent.js)
- Title normalization (quote removal, whitespace collapse)
- Venue name extraction (splits "Venue, Address" formats)
- Date normalization (MM/DD/YYYY → YYYY-MM-DD)
- Time normalization (12-hour → 24-hour format)
- Coordinate precision (6 decimal places)
- Category mapping (concert, sports, nightlife, etc.)
- Attendance/impact normalization (high/medium/low)

### Validation Tests (validateEvent.js)
- Required field validation (title, location, date, time)
- TBD/Unknown pattern detection
- Date format validation (YYYY-MM-DD)
- Schema version tracking for read-time validation skip
- Batch validation with statistics

### Hashing Tests (hashEvent.js)
- Deterministic hash generation (MD5)
- Venue suffix stripping ("at Venue", "@ Venue", "- Venue")
- Time normalization for hash consistency
- Duplicate detection across discovery runs
- Hash-based grouping utilities

### Integration Tests
- Full pipeline: raw → normalized → validated → hashed
- Normalization idempotency (double-normalize produces same output)
- Hash stability (same event from different providers produces same hash)

## Running Tests

```bash
# Run all ETL pipeline tests
node tests/events/pipeline.test.js
```

## Canonical Modules Tested

These tests verify the canonical modules in `server/lib/events/pipeline/`:

| Module | Purpose |
|--------|---------|
| `types.js` | JSDoc type definitions (RawEvent, NormalizedEvent, etc.) |
| `normalizeEvent.js` | Raw → Normalized transformation |
| `validateEvent.js` | Hard filter validation |
| `hashEvent.js` | MD5 hash generation for deduplication |

## Key Invariants Tested

1. **Normalization is deterministic** - Same input always produces same output
2. **Validation is consistent** - Event that passes once will always pass
3. **Hash is stable** - Same event produces same hash regardless of:
   - Time format (7 PM vs 19:00)
   - Title variations ("Concert" vs "Concert at Venue")
   - Provider differences (SerpAPI vs Gemini vs Claude)

## Related Documentation

- [server/lib/events/pipeline/README.md](../../server/lib/events/pipeline/README.md) - Pipeline module docs
- [docs/architecture/ai-pipeline.md](../../docs/architecture/ai-pipeline.md) - Full AI pipeline architecture
