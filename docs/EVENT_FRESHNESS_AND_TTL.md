# Event Freshness and TTL System

This document describes the event freshness filtering and TTL (Time-To-Live) automation system implemented to prevent stale events from appearing in the briefing tab.

**Last Updated:** 2026-01-14

## Problem Statement

The briefing tab was displaying stale events that had already ended (e.g., a Prestonwood play in Frisco, TX that ended December 14 was still showing). This created a poor user experience and potentially misleading information for rideshare drivers.

## Solution Overview

A multi-layer defense-in-depth approach was implemented:

1. **Server-side filtering** - Filter stale events at multiple levels
2. **Client-side defensive filtering** - Fallback filter in the UI
3. **Event verification subagent** - LLM-powered verification with fallback chain
4. **TTL-based expiration** - Automatic cleanup of expired events
5. **Pre-insert validation** - Prevent stale events from entering the database

## Canonical Field Names (2026-01-10)

All event date/time fields now use **symmetric naming**:

| Field | Format | Description |
|-------|--------|-------------|
| `event_start_date` | `YYYY-MM-DD` | Event start date (required) |
| `event_start_time` | `HH:MM` (24h) | Event start time (required) |
| `event_end_date` | `YYYY-MM-DD` | Event end date (defaults to start_date for single-day) |
| `event_end_time` | `HH:MM` (24h) or `h:mm AM/PM` | Event end time (required since schema v3) |

**Why end_time is required:** Rideshare drivers need to predict pickup surge timing. Without end_time, we can't calculate when an event ends and when demand spikes.

**Legacy field mappings (for backward compatibility):**
- `event_date` → `event_start_date`
- `event_time` → `event_start_time`
- `end_time` → `event_end_time`

## Architecture

```
Event Sources (Gemini Discovery, SerpAPI)
          │
          ▼
   ┌──────────────────┐
   │ Normalize        │ ← normalizeEvent.js: RawEvent → NormalizedEvent
   │ (ETL Pipeline)   │   Converts to canonical field names
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Validate         │ ← validateEvent.js: Schema v3 requires event_end_time
   │ (Hard Filters)   │   Rejects TBD/Unknown/missing fields
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Hash & Store     │ ← hashEvent.js: MD5(title|venue|date|time)
   │ (discovered_events)│  ON CONFLICT event_hash DO UPDATE
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Event Cleanup    │ ← Runs every hour to delete
   │ Job              │   events where expires_at < now()
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Briefing Service │ ← filterFreshEvents() applied with timezone
   │ (briefing-service)│  after DB query
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ API Response     │ ← filterFreshEvents() applied
   │ (briefing.js)    │   before returning to client
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Client UI        │ ← useMemo() with filterFreshEvents()
   │ (BriefingPage)   │   as final fallback
   └──────────────────┘
```

## Files Modified/Created

### Events ETL Pipeline (server/lib/events/pipeline/)

**`server/lib/events/pipeline/normalizeEvent.js`**
- `normalizeEvent()` - Converts RawEvent → NormalizedEvent with canonical field names
- `normalizeEvents()` - Batch normalization
- Helper functions: `normalizeTitle()`, `normalizeVenueName()`, `normalizeDate()`, `normalizeTime()`, `normalizeCategory()`, `normalizeAttendance()`
- 2026-01-10: Renamed fields to symmetric naming (`event_start_date`, `event_start_time`)
- 2026-01-10: Removed `zip`, `lat`, `lng`, `source_url`, `raw_source_data` (geocoding now in venue_catalog)

**`server/lib/events/pipeline/validateEvent.js`**
- `validateEvent()` - Single event validation against hard filter rules
- `validateEventsHard()` - Batch validation with logging
- `VALIDATION_SCHEMA_VERSION = 3` - Current schema version (2026-01-10: added event_end_time requirement)
- Validation rules:
  - Rule 1-5: Title, venue, address presence and no TBD/Unknown
  - Rule 6-7: `event_start_time` required, no TBD
  - Rule 8-9: `event_end_time` required, no TBD (added schema v3)
  - Rule 10-11: `event_start_date` required, YYYY-MM-DD format

**`server/lib/events/pipeline/hashEvent.js`**
- `generateEventHash()` - MD5 hash of normalized(title|venue|date|time)
- `buildHashInput()` - Constructs hash input string
- `stripVenueSuffix()` - Removes "at Venue" suffixes to prevent duplicates
- 2026-01-10: Uses `event_start_date`/`event_start_time` fields

**`server/lib/events/pipeline/types.js`**
- JSDoc type definitions for: `RawEvent`, `NormalizedEvent`, `ValidatedEvent`, `StoredEvent`, `BriefingEvent`
- Documents the ETL flow: RawEvent → NormalizedEvent → ValidatedEvent → StoredEvent → BriefingEvent
- 2026-01-10: Updated field names to symmetric naming

### Core Freshness Filtering Utility

**`server/lib/strategy/strategy-utils.js`**
- `filterFreshEvents(events, now, timezone)` - Filters stale events
- `isEventFresh(event, now, timezone)` - Single event freshness check
- `getEventEndTime(event, timezone)` - Extracts end time from multiple field formats
- `getEventStartTime(event, timezone)` - Extracts start time from multiple field formats
- `createDateInTimezone()` - Converts local time + timezone to UTC Date
- `parseTimeString()` - Parses "3:30 PM" format times
- 2026-01-10: Uses canonical field names (`event_start_date`, `event_start_time`, `event_end_date`, `event_end_time`)
- Handles legacy field names for backward compatibility

### Server-Side Filtering

**`server/api/briefing/briefing.js`**
- Imports `filterFreshEvents` from strategy-utils
- Applies filter with `snapshot.timezone` for correct local time handling
- Logs count of filtered stale events

**`server/lib/briefing/briefing-service.js`**
- Service layer for briefing operations
- Applies `filterFreshEvents()` after DB query

### Client-Side Filtering

**`client/src/pages/co-pilot/BriefingPage.tsx`**
- Local `filterFreshEvents()` function as fallback
- Applied via `useMemo()` for performance

### Event Verification Subagent

**`server/lib/subagents/event-verifier.js`**
- Uses fallback chain: anthropic → openai → google
- Verifies: validity, freshness, impact scoring
- Exports: `verifyEvent()`, `verifyEventBatch()`, `filterVerifiedEvents()`, `isEventFresh()`

### TTL Automation

**`drizzle/0008_event_ttl_automation.sql`**
- `fn_validate_event_before_insert()` - Rejects past events, auto-sets expires_at
- `trigger_validate_event` - BEFORE INSERT trigger
- `fn_backfill_event_expiry()` - Backfills existing events
- Runs cleanup on migration

### Scheduled Cleanup

**`server/jobs/event-cleanup.js`**
- `cleanupExpiredEvents()` - Calls `fn_cleanup_expired_events()`
- `startCleanupLoop()` - Runs every hour (configurable via `EVENT_CLEANUP_INTERVAL_MS`)
- `stopCleanupLoop()` - Graceful shutdown
- `getCleanupStatus()` - Health check

**`gateway-server.js`**
- Imports and starts cleanup loop on server init

### Pre-Insert Validation (Legacy)

**`server/lib/perplexity-event-prompt.js`** (deprecated - events now from Gemini)
- Modified `parseEventResponse()` to filter stale events during parsing
- Logs filtered events for debugging

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVENT_CLEANUP_INTERVAL_MS` | `3600000` (1 hour) | Cleanup job interval |
| `EVENT_CLEANUP_ENABLED` | `true` | Enable/disable cleanup job |

## Database Changes

### Stored Event Fields (discovered_events table)

```sql
-- Canonical field names (2026-01-10)
event_start_date  DATE          -- YYYY-MM-DD (required)
event_start_time  VARCHAR(10)   -- HH:MM or "h:mm AM/PM" (required)
event_end_date    DATE          -- YYYY-MM-DD (defaults to event_start_date)
event_end_time    VARCHAR(10)   -- HH:MM or "h:mm AM/PM" (required since schema v3)
```

### New Trigger

```sql
CREATE TRIGGER trigger_validate_event
  BEFORE INSERT ON events_facts
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_event_before_insert();
```

### Behavior

1. Rejects events where `event_end_time < now()` (returns NULL to skip insert)
2. Auto-sets `expires_at = event_end_time + 24 hours` if not provided
3. For events without `event_end_time`: `expires_at = event_start_time + 4 hours`

## Usage

### Freshness Filtering (Canonical - use this)

```javascript
import { filterFreshEvents, isEventFresh } from '../../lib/strategy/strategy-utils.js';

// Filter array of events with timezone-aware comparison
const freshEvents = filterFreshEvents(events, new Date(), snapshot.timezone);

// Check single event freshness
if (isEventFresh(event, new Date(), 'America/Chicago')) {
  // Event is still active
}
```

### Event Normalization (ETL Pipeline)

```javascript
import { normalizeEvent, normalizeEvents } from '../../lib/events/pipeline/normalizeEvent.js';
import { validateEventsHard } from '../../lib/events/pipeline/validateEvent.js';
import { generateEventHash } from '../../lib/events/pipeline/hashEvent.js';

// Normalize raw provider events to canonical format
const normalized = normalizeEvents(rawEvents, { city: 'Dallas', state: 'TX' });

// Validate - removes TBD/Unknown/incomplete events
const { valid, invalid, stats } = validateEventsHard(normalized);

// Generate hash for deduplication
const hash = generateEventHash(normalizedEvent);
```

### Manual Cleanup

```javascript
import { cleanupExpiredEvents } from './server/jobs/event-cleanup.js';
await cleanupExpiredEvents(); // Returns count of deleted events
```

### Event Verification (LLM-powered)

```javascript
import { verifyEvent, verifyEventBatch } from './server/lib/subagents/event-verifier.js';

// Single event
const result = await verifyEvent(event);
// { valid: true, fresh: true, impact_hint: 'med', confidence: 0.85, reasoning: '...' }

// Batch verification
const results = await verifyEventBatch(events);
```

## Running the Migration

```bash
# Apply the migration
npm run db:migrate

# Or manually via psql
psql $DATABASE_URL < drizzle/0008_event_ttl_automation.sql
```

## Testing

1. Create an event with `event_end_time` in the past - should be rejected by validation
2. Create an event without `event_end_time` - should be rejected (required since schema v3)
3. Create an event without `expires_at` - should auto-set to `event_end_time + 24h`
4. Wait for cleanup job to run - expired events should be deleted
5. Check briefing tab - no stale events should appear

### Testing Field Names

```javascript
// Test that canonical field names are used throughout
const testEvent = {
  title: 'Test Concert',
  venue_name: 'Test Venue',
  address: '123 Main St',
  city: 'Dallas',
  state: 'TX',
  event_start_date: '2026-01-15',   // Required: YYYY-MM-DD
  event_start_time: '7:00 PM',      // Required: h:mm AM/PM or HH:MM
  event_end_date: '2026-01-15',     // Optional: defaults to start_date
  event_end_time: '10:00 PM',       // Required: schema v3
  category: 'concert',
  expected_attendance: 'high'
};

// Validate
const { valid, reason } = validateEvent(testEvent);
console.assert(valid === true, `Validation failed: ${reason}`);

// Check freshness
const isFresh = isEventFresh(testEvent, new Date(), 'America/Chicago');
console.assert(isFresh === true, 'Event should be fresh');
```

## Monitoring

Check cleanup job status:
```javascript
import { getCleanupStatus } from './server/jobs/event-cleanup.js';
console.log(getCleanupStatus());
// { enabled: true, running: true, intervalMs: 3600000, isCleanupInProgress: false }
```

Check server logs for:
- `[event-cleanup] ✅ Cleaned up X expired events`
- `[filterFreshEvents] Filtered: X stale, Y missing dates (kept Z/N) tz=America/Chicago`
- `[EVENTS 2/5 - Transform|Validate] Removed (missing_end_time): "Event Title"`

### Validation Schema Version

The current validation schema version is tracked in `validateEvent.js`:

```javascript
export const VALIDATION_SCHEMA_VERSION = 3;
// v1: Initial validation (title, venue, date)
// v2: Added event_time requirement
// v3: Added event_end_time requirement (2026-01-10)
```

Events stored with older schema versions may need read-time revalidation:

```javascript
import { needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../../lib/events/pipeline/validateEvent.js';

if (needsReadTimeValidation(event.schema_version)) {
  // Re-validate legacy events
}
```
