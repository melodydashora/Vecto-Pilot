# Briefing API (`server/api/briefing/`)

## Purpose

Real-time intelligence: events, traffic, news, weather summaries. Includes event discovery system with multi-model AI search.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `briefing.js` | `/api/briefing/*` | Briefing data endpoints + event discovery |
| `events.js` | `/events` | SSE stream for real-time updates |

## Endpoints

### Briefing Data
```
GET  /api/briefing/current              - Latest briefing for user
POST /api/briefing/generate             - Generate new briefing
POST /api/briefing/refresh              - Force refresh briefing
GET  /api/briefing/snapshot/:snapshotId - Full briefing for snapshot
```

### Section-Specific (FETCH-ONCE pattern)
```
GET  /api/briefing/events/:snapshotId         - Events from discovered_events table
GET  /api/briefing/traffic/:snapshotId        - Cached traffic data
GET  /api/briefing/rideshare-news/:snapshotId - Cached news data
GET  /api/briefing/school-closures/:snapshotId - School closures
GET  /api/briefing/airport/:snapshotId        - Airport conditions
GET  /api/briefing/weather/:snapshotId        - Fresh weather data
```

### Daily Data Refresh
```
POST /api/briefing/refresh-daily/:snapshotId    - Refresh events + news (recommended)
POST /api/briefing/discover-events/:snapshotId  - DEPRECATED: Events only (use refresh-daily)
GET  /api/briefing/discovered-events/:snapshotId - Raw discovered_events data
POST /api/briefing/confirm-event-details        - Confirm TBD event details
```

### Event Management (AI Coach)
```
PATCH /api/briefing/event/:eventId/deactivate   - Mark event as inactive
PATCH /api/briefing/event/:eventId/reactivate   - Reactivate an event
```

### Real-time
```
GET  /api/briefing/traffic/realtime   - Fresh traffic (requires lat, lng)
GET  /api/briefing/weather/realtime   - Fresh weather (requires lat, lng)
GET  /events                          - SSE stream
```

## Daily Data Refresh System

### POST /api/briefing/refresh-daily/:snapshotId (Recommended)
Refreshes events AND news in a single call. Called when user clicks "Refresh Daily Data" in BriefingTab.

**Query Parameters:**
- `daily=true` (default) - Use all 6 models for events (comprehensive)
- `daily=false` - Use only SerpAPI + GPT-5.2 for events (fast)

**Response:**
```json
{
  "ok": true,
  "snapshot_id": "uuid",
  "mode": "daily",
  "events": {
    "total_discovered": 45,
    "inserted": 12,
    "skipped": 33
  },
  "news": {
    "count": 5,
    "items": [...]
  }
}
```

### POST /api/briefing/discover-events/:snapshotId (Deprecated)
**DEPRECATED:** Use `/refresh-daily` instead. Events-only discovery.

**Response:**
```json
{
  "ok": true,
  "snapshot_id": "uuid",
  "mode": "daily",
  "total_discovered": 45,
  "inserted": 12,
  "skipped": 33,
  "events": [...]
}
```

### GET /api/briefing/events/:snapshotId
Reads events from `discovered_events` table for snapshot's city/state, next 7 days.

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "title": "Taylor Swift - Eras Tour",
      "venue": "AT&T Stadium",
      "address": "1 AT&T Way, Arlington, TX",
      "event_date": "2024-12-15",
      "event_time": "7:00 PM",
      "event_end_time": "11:00 PM",
      "impact": "high",
      "subtype": "concert",
      "latitude": 32.7473,
      "longitude": -97.0945
    }
  ],
  "reason": null,
  "timestamp": "2024-12-14T..."
}
```

### GET /api/briefing/discovered-events/:snapshotId
Direct access to `discovered_events` table rows.

**Response:**
```json
{
  "ok": true,
  "snapshot_id": "uuid",
  "location": { "city": "Dallas", "state": "TX" },
  "date_range": { "start": "2024-12-14", "end": "2024-12-21" },
  "count": 52,
  "events": [...]
}
```

### PATCH /api/briefing/event/:eventId/deactivate
Mark an event as inactive (hides from Map tab). Used by AI Coach when driver reports event is over/cancelled/incorrect.

**Request Body:**
```json
{
  "reason": "event_ended",  // Required: event_ended | incorrect_time | no_longer_relevant | cancelled | duplicate | other
  "notes": "Ended early",   // Optional: Additional context
  "correctedTime": "8:00 PM",     // Optional: If reason is incorrect_time
  "correctedEndTime": "11:00 PM"  // Optional: If reason is incorrect_time
}
```

**Response:**
```json
{
  "ok": true,
  "event_id": "uuid",
  "title": "Taylor Swift - Eras Tour",
  "reason": "event_ended",
  "deactivated_at": "2024-12-14T20:30:00Z",
  "message": "Event \"Taylor Swift - Eras Tour\" has been marked as inactive..."
}
```

### PATCH /api/briefing/event/:eventId/reactivate
Reactivate a previously deactivated event (shows on Map again).

**Response:**
```json
{
  "ok": true,
  "event_id": "uuid",
  "title": "Taylor Swift - Eras Tour",
  "message": "Event \"Taylor Swift - Eras Tour\" has been reactivated..."
}
```

### AI Coach Integration
The AI Coach can deactivate and reactivate events using special formats in responses:

**Deactivate an event:**
```
[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "event_ended", "notes": "Ended early"}]
```

**Reactivate an event (undo mistaken deactivation):**
```
[REACTIVATE_EVENT: {"event_title": "Event Name", "reason": "wrong date assumed", "notes": "Event is today, not yesterday"}]
```

The chat API parses these formats and calls the corresponding DAL functions automatically.

**Date/Time Awareness:** The Coach receives the user's local date/time prominently in the system prompt (e.g., "Wednesday, January 1, 2026 at 3:45 PM") to prevent date-related mistakes when deactivating events.

## Data Flow

### Normal Snapshot Run
1. Client triggers snapshot creation
2. `fetchEventsForBriefing()` calls `syncEventsForLocation(location, false)`
3. SerpAPI + GPT-5.2 search for events
4. Results stored in `discovered_events` table (with dedup)
5. Events read back and stored in `briefings.events`

### On-Demand Discovery (Discover Button)
1. User clicks "Discover Events" button
2. POST `/api/briefing/discover-events/:snapshotId?daily=true`
3. All 6 models run in parallel
4. Results deduplicated and stored in `discovered_events`
5. UI refreshes to show new events

### Event Display
1. GET `/api/briefing/events/:snapshotId`
2. Reads from `discovered_events` table (not briefings.events)
3. Returns events for city/state, next 7 days
4. UI displays in EventsComponent + MapTab markers

### Venue Cache Integration (Jan 2026)
During event discovery, venues are automatically cached for:
1. **Precise Coordinates**: Full 15+ decimal precision stored in `venue_cache`
2. **Deduplication**: Same venue from different LLMs → single cache entry
3. **Event Linking**: `discovered_events.venue_id` → `venue_cache.id`
4. **SmartBlocks**: "Event tonight" flag via venue join

```
Event Discovery Flow (with Venue Cache):
syncEventsForLocation()
    ↓
1. LLM search (SerpAPI, GPT-5.2, Gemini, Claude, Perplexity)
    ↓
2. geocodeMissingCoordinates() - fill in missing lat/lng
    ↓
3. processEventsWithVenueCache() - NEW
   ├── lookupVenueFuzzy() - find existing venue
   ├── findOrCreateVenue() - create if new
   └── Update event with precise coords + venue_id
    ↓
4. storeEvents() - insert with venue_id FK
```

## Connections

- **Uses:** `../../lib/briefing/briefing-service.js`
- **Uses:** `../../scripts/sync-events.mjs` (event discovery)
- **Schema:** `../../../shared/schema.js` (briefings, discovered_events)
- **Called by:** Client BriefingTab, MapTab, background refresh

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { snapshots, discovered_events } from '../../../shared/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

// Briefing service
import {
  getBriefingBySnapshotId,
  generateAndStoreBriefing,
  fetchWeatherConditions
} from '../../lib/briefing/briefing-service.js';

// Event discovery
import { syncEventsForLocation } from '../../scripts/sync-events.mjs';

// Venue cache (integrated into sync-events.mjs)
import { findOrCreateVenue, lookupVenue, getEventsForVenue } from '../../lib/venue/venue-cache.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
```

## Gemini Configuration Notes

Briefing uses Gemini 3 Pro with Google Search grounding for news, weather, and school closures.

**Critical Settings:**
```javascript
// Model ID must include -preview suffix
model: "gemini-3-pro-preview"  // NOT "gemini-3-pro"!

// Token budget must account for thinking
// With thinkingLevel: HIGH, thinking consumes tokens from maxOutputTokens
maxOutputTokens: 8192  // Minimum for HIGH thinking (2048 causes MAX_TOKENS errors)

// thinkingLevel for Pro: only LOW or HIGH (MEDIUM is Flash-only)
thinkingConfig: { thinkingLevel: "HIGH" }
```

**Error Symptoms:**
| Error | Cause | Fix |
|-------|-------|-----|
| `404 model not found` | Missing `-preview` suffix | Use `gemini-3-pro-preview` |
| `MAX_TOKENS, parts: 0` | Token budget too low | Use `maxOutputTokens: 8192+` |
| `thinking level not supported` | MEDIUM on Pro | Use LOW or HIGH only |

## Related Documentation

- [Event Discovery Architecture](../../../docs/architecture/event-discovery.md)
- [Database Schema](../../../docs/architecture/database-schema.md)
- [AI Models Preflight](../../../docs/preflight/ai-models.md)
