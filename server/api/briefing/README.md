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

### Event Discovery
```
POST /api/briefing/discover-events/:snapshotId  - Trigger event discovery
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

## Event Discovery System

### POST /api/briefing/discover-events/:snapshotId
Triggers on-demand event discovery using AI models.

**Query Parameters:**
- `daily=true` (default) - Use all 6 models (comprehensive)
- `daily=false` - Use only SerpAPI + GPT-5.2 (fast)

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
The AI Coach can deactivate events using a special format in responses:
```
[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "event_ended", "notes": "Ended early"}]
```

The client-side CoachChat component parses this format and calls the deactivation API automatically.

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

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
```

## Related Documentation

- [Event Discovery Architecture](../../../docs/architecture/event-discovery.md)
- [Database Schema](../../../docs/architecture/database-schema.md)
