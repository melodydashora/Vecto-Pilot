# Event Freshness and TTL System

This document describes the event freshness filtering and TTL (Time-To-Live) automation system implemented to prevent stale events from appearing in the briefing tab.

## Problem Statement

The briefing tab was displaying stale events that had already ended (e.g., a Prestonwood play in Frisco, TX that ended December 14 was still showing). This created a poor user experience and potentially misleading information for rideshare drivers.

## Solution Overview

A multi-layer defense-in-depth approach was implemented:

1. **Server-side filtering** - Filter stale events at multiple levels
2. **Client-side defensive filtering** - Fallback filter in the UI
3. **Event verification subagent** - LLM-powered verification with fallback chain
4. **TTL-based expiration** - Automatic cleanup of expired events
5. **Pre-insert validation** - Prevent stale events from entering the database

## Architecture

```
Event Sources (Perplexity, LLM, Manual)
          │
          ▼
   ┌──────────────────┐
   │ Pre-Insert       │ ← Rejects events where end_time < now()
   │ Validation       │   (perplexity-event-prompt.js, DB trigger)
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ events_facts     │ ← Auto-sets expires_at = end_time + 24h
   │ Table (DB)       │   via BEFORE INSERT trigger
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
   │ Briefing         │ ← filterFreshEvents() applied
   │ Provider         │   after normalization
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ API Response     │ ← filterFreshEvents() applied
   │ (blocks-fast.js) │   before returning to client
   └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Client UI        │ ← useMemo() with filterFreshEvents()
   │ (BriefingPage)   │   as final fallback
   └──────────────────┘
```

## Files Modified/Created

### Core Filtering Utility

**`server/lib/strategy-utils.js`**
- Added `filterFreshEvents(events, now)` function
- Filters events where `end_time > now`
- Handles multiple end_time field names: `end_time`, `endTime`, `end_time_iso`, `endsAt`, `ends_at`
- Keeps events without end_time for legacy compatibility

### Server-Side Filtering

**`server/lib/providers/briefing.js`**
- Imports `filterFreshEvents`
- Applies filter after `normalizeBriefingShape()` call
- Logs count of filtered stale events

**`server/routes/blocks-fast.js`**
- Imports `filterFreshEvents`
- Applies filter in `getStrategyFast()` return value

### Client-Side Filtering

**`client/src/pages/BriefingPage.tsx`**
- Added local `filterFreshEvents()` function
- Applied via `useMemo()` for performance

### Event Verification Subagent

**`server/lib/subagents/event-verifier.js`** (NEW)
- Uses fallback chain: anthropic → openai → google
- Verifies: validity, freshness, impact scoring
- Exports: `verifyEvent()`, `verifyEventBatch()`, `filterVerifiedEvents()`, `isEventFresh()`

### TTL Automation

**`drizzle/0008_event_ttl_automation.sql`** (NEW)
- `fn_validate_event_before_insert()` - Rejects past events, auto-sets expires_at
- `trigger_validate_event` - BEFORE INSERT trigger
- `fn_backfill_event_expiry()` - Backfills existing events
- Runs cleanup on migration

### Scheduled Cleanup

**`server/jobs/event-cleanup.js`** (NEW)
- `cleanupExpiredEvents()` - Calls `fn_cleanup_expired_events()`
- `startCleanupLoop()` - Runs every hour (configurable via `EVENT_CLEANUP_INTERVAL_MS`)
- `stopCleanupLoop()` - Graceful shutdown
- `getCleanupStatus()` - Health check

**`gateway-server.js`**
- Imports and starts cleanup loop on server init

### Pre-Insert Validation

**`server/lib/perplexity-event-prompt.js`**
- Modified `parseEventResponse()` to filter stale events during parsing
- Logs filtered events for debugging

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVENT_CLEANUP_INTERVAL_MS` | `3600000` (1 hour) | Cleanup job interval |
| `EVENT_CLEANUP_ENABLED` | `true` | Enable/disable cleanup job |

## Database Changes

### New Trigger

```sql
CREATE TRIGGER trigger_validate_event
  BEFORE INSERT ON events_facts
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_event_before_insert();
```

### Behavior

1. Rejects events where `end_time < now()` (returns NULL to skip insert)
2. Auto-sets `expires_at = end_time + 24 hours` if not provided
3. For events without end_time: `expires_at = start_time + 4 hours`

## Usage

### Manual Cleanup

```javascript
import { cleanupExpiredEvents } from './server/jobs/event-cleanup.js';
await cleanupExpiredEvents(); // Returns count of deleted events
```

### Event Verification

```javascript
import { verifyEvent, verifyEventBatch } from './server/lib/subagents/event-verifier.js';

// Single event
const result = await verifyEvent(event);
// { valid: true, fresh: true, impact_hint: 'med', confidence: 0.85, reasoning: '...' }

// Batch verification
const results = await verifyEventBatch(events);
```

### Check Freshness (No LLM)

```javascript
import { isEventFresh } from './server/lib/subagents/event-verifier.js';
if (isEventFresh(event)) {
  // Event is still active
}
```

## Running the Migration

```bash
# Apply the migration
npm run db:migrate

# Or manually via psql
psql $DATABASE_URL < drizzle/0008_event_ttl_automation.sql
```

## Testing

1. Create an event with `end_time` in the past - should be rejected
2. Create an event without `expires_at` - should auto-set to `end_time + 24h`
3. Wait for cleanup job to run - expired events should be deleted
4. Check briefing tab - no stale events should appear

## Monitoring

Check cleanup job status:
```javascript
import { getCleanupStatus } from './server/jobs/event-cleanup.js';
console.log(getCleanupStatus());
// { enabled: true, running: true, intervalMs: 3600000, isCleanupInProgress: false }
```

Check server logs for:
- `[event-cleanup] ✅ Cleaned up X expired events`
- `[briefing] Filtered X stale events`
- `[perplexity] Filtering stale event: "..."`
