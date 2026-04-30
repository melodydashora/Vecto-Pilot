# Event Freshness and TTL System

Describes how the briefing pipeline keeps `discovered_events` fresh and how stale events are filtered out before they reach the driver's briefing tab.

**Last Updated:** 2026-04-18 — **MAJOR REWRITE.** The previous version of this document described a TTL automation system (`expires_at` column, BEFORE INSERT trigger on a table called `events_facts`, a scheduled `startCleanupLoop()`, and an LLM-powered event-verifier subagent) that was designed in January 2026 but **never implemented in the database or wired into the runtime**. The actual mechanism is simpler: per-snapshot soft deactivation via `is_active` flag + read-time freshness filter. This rewrite replaces the phantom content with the mechanism that actually runs in production.

## Problem

The briefing tab was displaying stale events (e.g., a Prestonwood play in Frisco, TX that ended Dec 14 was still showing). Rideshare drivers need accurate, current event data for surge prediction and pickup positioning.

## Solution

Three defense-in-depth layers, all currently active:

1. **Per-snapshot deactivation** — `deactivatePastEvents(timezone)` called at the top of every briefing run sets `is_active = false` on events that have already ended (timezone-aware).
2. **Read-time freshness filter** — `filterFreshEvents(events, now, timezone)` applied after every DB query that surfaces events to the client.
3. **Validation at ingest** — `validateEventsHard()` rejects raw events missing required fields or with TBD values before they hit the DB.

What the previous doc described but **does not exist in code**:
- ❌ `expires_at` column on `discovered_events` — the schema uses `is_active` + `deactivated_at` instead
- ❌ `events_facts` table — this table was never created
- ❌ BEFORE INSERT trigger (`trigger_validate_event`) — no DB trigger exists
- ❌ `startCleanupLoop()` from `server/jobs/event-cleanup.js` — file exists but is **not imported anywhere** (confirmed 2026-04-18)
- ❌ `verifyEvent()` / `event-verifier.js` — file exists but is **not imported anywhere**
- ❌ `EVENT_CLEANUP_INTERVAL_MS` / `EVENT_CLEANUP_ENABLED` env vars — not read by any code
- ❌ `drizzle/0008_event_ttl_automation.sql` — if present, was not applied (referenced table doesn't exist)

## Canonical Field Names

All event date/time fields use **symmetric naming**:

| Field | Format | Description |
|-------|--------|-------------|
| `event_start_date` | `YYYY-MM-DD` | Event start date (required) |
| `event_start_time` | `HH:MM` (24h) or `h:mm AM/PM` | Event start time (required) |
| `event_end_date` | `YYYY-MM-DD` | Event end date (defaults to `event_start_date` for single-day) |
| `event_end_time` | `HH:MM` or `h:mm AM/PM` | Event end time (required since schema v3) |

**Why `event_end_time` is required:** drivers need to predict surge timing. Without end time, we can't compute when demand spikes.

**Legacy → canonical mapping** (supported by read-time helpers for backward compatibility):
- `event_date` → `event_start_date`
- `event_time` → `event_start_time`
- `end_time` → `event_end_time`

## Architecture (what actually runs)

```
Event Sources (Gemini google_search discovery in briefing pipeline)
          │
          ▼
   normalizeEvent()               server/lib/events/pipeline/normalizeEvent.js
   (RawEvent → NormalizedEvent, canonical field names)
          │
          ▼
   validateEventsHard()           server/lib/events/pipeline/validateEvent.js
   (schema v3: rejects TBD/Unknown/missing fields; requires event_end_time)
          │
          ▼
   generateEventHash()            server/lib/events/pipeline/hashEvent.js
   (MD5 of normalized title|venue|date|time — dedup key)
          │
          ▼
   geocodeEventAddress() + findOrCreateVenue()
   (Google Geocoding → venue_catalog link via venue_id FK)
          │
          ▼
   INSERT discovered_events ON CONFLICT (event_hash) DO UPDATE
          │
          ▼
   Next snapshot → fetchEventsForBriefing()
      └─► deactivatePastEvents(timezone)     server/lib/briefing/cleanup-events.js
            (sets is_active = false, deactivated_at = NOW() on ended events)
          │
          ▼
   Read-path SELECT from discovered_events WHERE is_active = true
      └─► filterFreshEvents(events, now, timezone)
            server/lib/strategy/strategy-utils.js
            (final safety net: catches any that slipped through)
          │
          ▼
   API response / briefing JSONB
```

## Active Code Files

### ETL Pipeline — `server/lib/events/pipeline/`

- **`normalizeEvent.js`** — `normalizeEvent(raw, { city, state })`, `normalizeEvents(...)`. Also: `normalizeTitle`, `normalizeVenueName`, `normalizeDate`, `normalizeTime`, `normalizeCategory`, `normalizeAttendance`.
- **`validateEvent.js`** — `validateEvent(e)`, `validateEventsHard(events)`. Exports `VALIDATION_SCHEMA_VERSION = 3`.
  - Rules: title/venue/address presence, no TBD/Unknown, `event_start_date` YYYY-MM-DD, `event_start_time` required, `event_end_time` required.
- **`hashEvent.js`** — `generateEventHash(event)` returns MD5 over `normalize(title|venue|date|time)`. Helper `stripVenueSuffix` prevents `"Event at Venue"` duplicates.
- **`geocodeEvent.js`** — `geocodeEventAddress({ venue_name, city, state })` → `{ lat, lng, place_id, formatted_address }` via Google Geocoding.
- **`deduplicateEventsSemantic.js`** — title-similarity safety net that catches near-duplicates hash dedup misses (e.g., "Jon Wolfe Concert" vs "Jon Wolfe").
- **`types.js`** — JSDoc-only type definitions for `RawEvent → NormalizedEvent → ValidatedEvent → StoredEvent → BriefingEvent`.

### Per-Snapshot Deactivation — `server/lib/briefing/cleanup-events.js`

- `deactivatePastEvents(timezone)` → soft-deactivates events where `event_end_date < today` OR (`event_end_date = today AND event_end_time < now`).
- Timezone is **required** (throws if missing — no UTC fallback per `NO FALLBACKS` rule).
- Sets `is_active = false` and `deactivated_at = NOW()`.
- Called from `briefing-service.js:1065` inside `fetchEventsForBriefing()`.

### Read-Time Filter — `server/lib/strategy/strategy-utils.js`

- `filterFreshEvents(events, now, timezone)` — filters out events whose end time has passed.
- `isEventFresh(event, now, timezone)` — single-event check.
- `getEventEndTime(event, timezone)` and `getEventStartTime(event, timezone)` — extract times handling both canonical and legacy field names.
- `parseTimeString("3:30 PM")` — handles 12h and 24h inputs.

### Read-Path Application Points

- `server/api/briefing/briefing.js` — applies `filterFreshEvents()` and `deduplicateEventsSemantic()` on every `/events/:snapshotId` response.
- `server/lib/briefing/briefing-service.js` — applies the same filters before writing the briefing row's `events` JSONB.
- `client/src/pages/co-pilot/BriefingPage.tsx` — defensive client-side `filterFreshEvents()` via `useMemo()` as the final UI safety net.

### Other Deactivation Paths (point-deactivation, not bulk)

- `PATCH /api/briefing/event/:eventId/deactivate` (`server/api/briefing/briefing.js:1078`, `requireAuth` applied) — single event deactivation from UI.
- `coachDAL.deactivateEvent()` — Rideshare Coach deactivation via memory/chat actions.
- `POST /api/chat/deactivate-event` — user-triggered deactivation through chat ("This event is cancelled").
- `scripts/db-detox.js` — operator script that hard-DELETEs past events (use sparingly; production prefers soft deactivation).

## Schema (discovered_events)

```sql
-- Lifecycle management (what actually exists, per shared/schema.js)
is_active          boolean      DEFAULT true     -- false means deactivated / past / rejected
deactivated_at     timestamptz                   -- set when is_active flips to false
event_hash         varchar      UNIQUE           -- dedup key (MD5 of normalized fields)
schema_version     integer      DEFAULT 3        -- for read-time revalidation of legacy rows

-- Canonical field names (2026-01-10)
event_start_date   date                          -- YYYY-MM-DD (required)
event_start_time   varchar(10)                   -- HH:MM or h:mm AM/PM (required)
event_end_date     date                          -- YYYY-MM-DD (defaults to start_date)
event_end_time     varchar(10)                   -- HH:MM or h:mm AM/PM (required since v3)
```

There is **no** `expires_at` column. Deactivation is via the `is_active` flag.

## Usage

### Filter stale events at read time

```javascript
import { filterFreshEvents, isEventFresh } from '../../lib/strategy/strategy-utils.js';

const fresh = filterFreshEvents(events, new Date(), snapshot.timezone);
if (isEventFresh(event, new Date(), 'America/Chicago')) {
  // still active
}
```

### Deactivate ended events (called per snapshot, not manually)

```javascript
import { deactivatePastEvents } from '../../lib/briefing/cleanup-events.js';

// Runs automatically at the top of fetchEventsForBriefing()
await deactivatePastEvents(snapshot.timezone);
```

### ETL pipeline (ingest from Gemini)

```javascript
import { normalizeEvents } from '../../lib/events/pipeline/normalizeEvent.js';
import { validateEventsHard } from '../../lib/events/pipeline/validateEvent.js';
import { generateEventHash } from '../../lib/events/pipeline/hashEvent.js';

const normalized = normalizeEvents(rawEvents, { city: snapshot.city, state: snapshot.state });
const { valid, invalid, stats } = validateEventsHard(normalized);
for (const e of valid) e.event_hash = generateEventHash(e);
// INSERT ... ON CONFLICT (event_hash) DO UPDATE
```

## Testing

1. Create an event with `event_end_time` in the past → rejected by `validateEventsHard` (Rule 8).
2. Create an event without `event_end_time` → rejected (Rule 8, required since schema v3).
3. Run a snapshot at 3 AM local time with a yesterday-evening event → `deactivatePastEvents` flips `is_active = false`; briefing tab excludes it.
4. Query `/api/briefing/events/:snapshotId` after an event has ended but **before** the next snapshot runs → `filterFreshEvents` catches it in the response.

### Canonical test event

```javascript
const testEvent = {
  title: 'Test Concert',
  venue_name: 'Test Venue',
  address: '123 Main St',
  city: 'Dallas',  // example only — no market is hardcoded anywhere
  state: 'TX',
  event_start_date: '2026-04-20',
  event_start_time: '19:00',
  event_end_date:   '2026-04-20',
  event_end_time:   '22:00',
  category: 'concert',
  expected_attendance: 'high',
};
const { valid, reason } = validateEvent(testEvent);
```

## Monitoring (real log lines)

- `[cleanup-events] deactivated N past events (tz=<IANA>)` — from `deactivatePastEvents`
- `[BriefingRoute] Freshness filter: X → Y events (removed Z stale/invalid)` — from `briefing.js`
- `[BriefingRoute] Dedup: X → Y events (removed Z duplicates)` — hash dedup
- `[BriefingRoute] Semantic dedup: X → Y events (removed Z title-variant duplicates)` — title-similarity pass
- `[EVENTS 2/5 - Transform|Validate] Removed (missing_end_time): "<title>"` — validation rejection

## Validation Schema Version

Tracked in `validateEvent.js`:

```javascript
export const VALIDATION_SCHEMA_VERSION = 3;
// v1: Initial validation (title, venue, date)
// v2: Added event_time requirement
// v3: Added event_end_time requirement (2026-01-10)
```

Events stored under older schema versions can be read-time-revalidated via `needsReadTimeValidation(event.schema_version)`.

## Dead Code (flagged for deletion)

These files exist on disk but are not imported anywhere. Confirmed with a full codebase scan on 2026-04-18. Candidates for deletion:

- `server/jobs/event-cleanup.js` — `startCleanupLoop()` never called; superseded by per-snapshot `deactivatePastEvents`.
- `server/lib/subagents/event-verifier.js` — `verifyEvent`/`filterVerifiedEvents` never imported; LLM verification was considered too slow for the hot path.
- `server/lib/briefing/event-schedule-validator.js` — commented out in `briefing-service.js:7` since the Gemini migration.
- `server/lib/briefing/event-proximity-boost.js` — never integrated.
- `server/lib/briefing/context-loader.js` — no external consumers.

## See also

- `docs/BRIEFING_AND_EVENTS_ISSUES.md` — cross-verified issue tracker (kept in sync with this doc)
- `docs/VENUELOGIC.md` — venue catalog architecture (events link via `venue_id` FK)
- `server/lib/briefing/briefing-service.js` — orchestration entry point
- `server/lib/briefing/cleanup-events.js` — per-snapshot deactivation implementation
