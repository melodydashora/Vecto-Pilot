# Briefing Workflow

This document describes the briefing data workflow in Vecto Pilot.

## Overview

The briefing workflow provides real-time intelligence to rideshare drivers:
- **Weather**: Current conditions and forecast
- **Traffic**: Active incidents, jams, closures
- **Events**: Concerts, sports, festivals
- **News**: Rideshare-relevant headlines
- **Airport**: Delays, busy periods
- **School Closures**: District closures/reopenings

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Client)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. BriefingPage                   2. useBriefingQueries Hook               │
│   ┌─────────────────┐              ┌─────────────────────────────────┐      │
│   │ useLocation()   │              │ React Query with polling        │      │
│   │   .lastSnapshotId├───────────→ │                                 │      │
│   │                 │              │ GET /api/briefing/weather/:id   │      │
│   └─────────────────┘              │ GET /api/briefing/traffic/:id   │      │
│                                    │ GET /api/briefing/events/:id    │      │
│                                    │ GET /api/briefing/rideshare-news│      │
│                                    │ GET /api/briefing/airport/:id   │      │
│                                    │ GET /api/briefing/school-closures│     │
│                                    └─────────────────────────────────┘      │
│                                                  │                          │
│   3. SSE Subscription                            │                          │
│   ┌─────────────────────────────────────┐       │                          │
│   │ subscribeBriefingReady()            │       │                          │
│   │   → /events/briefing SSE            │       │                          │
│   │   → Triggers immediate refetch      │       │                          │
│   └─────────────────────────────────────┘       │                          │
│                                                  │                          │
│   4. BriefingTab Display                        │                          │
│   ┌─────────────────────────────────┐           ▼                          │
│   │ Weather Card    │ Traffic Card  │   ┌─────────────────┐                │
│   │ Events Card     │ News Card     │◄──│ Data from APIs  │                │
│   │ Airport Card    │ School Card   │   └─────────────────┘                │
│   └─────────────────────────────────┘                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            SERVER (Node.js)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Briefing Generation (triggered by TRIAD pipeline)                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   BRIEFER MODEL (Gemini 3.0 Pro + Google Search)                    │   │
│   │   ┌──────────────────────────────────────────────────────────────┐  │   │
│   │   │ Generates:                                                    │  │   │
│   │   │   - Traffic analysis (TomTom API + AI summary)               │  │   │
│   │   │   - Events discovery (SerpAPI + multi-model validation)      │  │   │
│   │   │   - Rideshare news (Perplexity Sonar Pro)                    │  │   │
│   │   │   - School closures (Google Search)                          │  │   │
│   │   │   - Airport conditions (FAA API + AI analysis)               │  │   │
│   │   └──────────────────────────────────────────────────────────────┘  │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Database Storage (briefings table)                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ { snapshot_id, news, weather_current, weather_forecast,             │   │
│   │   traffic_conditions, events, school_closures, airport_conditions } │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Notify: pg_notify('briefing_ready', { snapshot_id })                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Client
| File | Purpose |
|------|---------|
| `client/src/pages/co-pilot/BriefingPage.tsx` | Container component, fetches data |
| `client/src/components/BriefingTab.tsx` | Presentation component, displays cards |
| `client/src/hooks/useBriefingQueries.ts` | React Query hooks with polling |
| `client/src/utils/co-pilot-helpers.ts` | SSE subscription (`subscribeBriefingReady`) |
| `client/src/contexts/location-context-clean.tsx` | Provides `lastSnapshotId` |

### Server
| File | Purpose |
|------|---------|
| `server/api/briefing/briefing.js` | All briefing API endpoints |
| `server/api/strategy/strategy-events.js` | SSE endpoints (`/events/briefing`) |
| `server/lib/briefing/briefing-service.js` | Briefing generation and retrieval |
| `server/middleware/require-snapshot-ownership.js` | Access control |
| `server/middleware/auth.js` | JWT authentication |

## Database Tables

### briefings
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| snapshot_id | uuid | Links to snapshot (unique) |
| news | jsonb | Rideshare news items |
| weather_current | jsonb | Current conditions |
| weather_forecast | jsonb | Hourly forecast |
| traffic_conditions | jsonb | Traffic analysis |
| events | jsonb | Local events |
| school_closures | jsonb | School district closures |
| airport_conditions | jsonb | Airport delays/recommendations |

### discovered_events
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| city, state | text | Event location |
| title | text | Event name |
| event_start_date | text | Event date (YYYY-MM-DD) - **renamed 2026-01-10** |
| event_start_time | text | Start time - **renamed 2026-01-10** |
| event_end_date | text | End date (for multi-day events) |
| event_end_time | text | End time |
| venue_name | text | Venue name |
| venue_id | uuid | FK to venue_catalog (coordinates now there) |
| is_active | boolean | Whether event is active |

## Data Structures

### airport_conditions JSON

The `airport_conditions` field contains AI-generated airport intelligence:

```json
{
  "airports": [
    {
      "code": "<IATA_CODE>",
      "name": "<Full Airport Name>",
      "status": "delays",  // 'normal' | 'delays' | 'severe_delays'
      "delays": "<AI-generated delay description>",
      "busyTimes": ["<time range>", "<time range>"]
    }
  ],
  "recommendations": "<AI-generated driver recommendations>",
  "fetchedAt": "<ISO timestamp>"
}
```

**Note:** Airport data is dynamically fetched based on user's location. No airports are hardcoded.

**Important:** The component (`BriefingTab.tsx`) handles two field name variants:
- `status` (current format from AI)
- `overallStatus` (legacy FAA API format)

Both are normalized in the display logic.

## API Endpoints

All endpoints use the pattern `/api/briefing/:type/:snapshotId`:

| Endpoint | Data Source | Polling |
|----------|-------------|---------|
| `/weather/:id` | Google Weather API (live) | No |
| `/traffic/:id` | Cached from briefings table | Yes (2s) |
| `/events/:id` | discovered_events table | No |
| `/rideshare-news/:id` | Cached from briefings table | Yes (2s) |
| `/airport/:id` | Cached from briefings table | Yes (2s) |
| `/school-closures/:id` | Cached from briefings table | No |

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ GET /api/briefing/traffic/:snapshotId                                        │
│ Authorization: Bearer <user_id>.<signature>                                  │
│                                                                              │
│                    ┌──────────────────────────┐                              │
│                    │     optionalAuth          │                              │
│                    │  (server/middleware/auth) │                              │
│                    └──────────────────────────┘                              │
│                              │                                               │
│           ┌──────────────────┼──────────────────┐                            │
│           ▼                  ▼                  ▼                            │
│   Token Present &     Token Present &     No Token                           │
│   Valid               Invalid             (Anonymous)                        │
│           │                  │                  │                            │
│           ▼                  ▼                  ▼                            │
│   req.auth.userId     Return 401         Continue without                    │
│   set                                    req.auth                            │
│           │                                     │                            │
│           └──────────────────┬──────────────────┘                            │
│                              ▼                                               │
│                    ┌──────────────────────────────┐                          │
│                    │ requireSnapshotOwnership      │                          │
│                    │ (server/middleware/...)       │                          │
│                    └──────────────────────────────┘                          │
│                              │                                               │
│           ┌──────────────────┼──────────────────┐                            │
│           ▼                  ▼                  ▼                            │
│   snapshot.user_id   snapshot.user_id     No auth                           │
│   matches auth       null (legacy)        (Anonymous)                        │
│           │                  │                  │                            │
│           ▼                  ▼                  ▼                            │
│   ✅ Proceed         ✅ Proceed           ✅ Proceed                         │
│   (ownership OK)     (allow legacy)       (UUID is capability)               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Polling & Caching Strategy

The `useBriefingQueries` hook uses smart polling:

```typescript
// Configuration
const MAX_RETRY_ATTEMPTS = 40;  // 40 × 2s = 80 seconds max
const RETRY_INTERVAL_MS = 2000; // Poll every 2 seconds

// Polling continues while data is "loading" (placeholder)
refetchInterval: (query) => {
  const stillLoading = isTrafficLoading(query.state.data);
  const hasRetriesLeft = retryCountsRef.current.traffic < MAX_RETRY_ATTEMPTS;
  if (stillLoading && hasRetriesLeft) {
    return RETRY_INTERVAL_MS;
  }
  return false; // Stop polling when data arrives
};
```

**LESSON LEARNED:** Briefing generation takes 40-60 seconds. Initial 30-second timeout was too short, causing polling to stop before data was ready.

## SSE Integration

SSE provides instant notification when briefing is ready:

```javascript
// Client: Subscribe to briefing_ready events
const unsubscribe = subscribeBriefingReady((readySnapshotId) => {
  if (readySnapshotId === mySnapshotId) {
    // Immediately refetch all briefing data
    queryClient.refetchQueries({ queryKey: ['/api/briefing/traffic', snapshotId] });
    queryClient.refetchQueries({ queryKey: ['/api/briefing/events', snapshotId] });
    // ... etc
  }
});

// Server: Notify when briefing is complete
await db.query(`SELECT pg_notify('briefing_ready', '${JSON.stringify({ snapshot_id })}')`);
```

## Loading States

Components should show loading spinners when data is undefined:

```typescript
// useBriefingQueries returns undefined when still loading
if (!response.ok) {
  // Return undefined to indicate "still loading" - UI shows spinner
  // DON'T return { events: [] } - that means "fetched but no events found"
  return undefined;
}
```

**LESSON LEARNED:** Returning empty arrays for errors caused UI to show "No events found" messages before data was even fetched. Return `undefined` to show loading spinners.

## Data Sources

| Data Type | Primary Source | AI Enhancement |
|-----------|----------------|----------------|
| Weather | Google Weather API | None (live data) |
| Traffic | TomTom Traffic API | Gemini summarization |
| Events | SerpAPI + Google Search | Multi-model validation |
| News | Perplexity Sonar Pro | Direct AI output |
| Airport | FAA ATCSCC API | Claude analysis |
| School Closures | Google Search | Gemini extraction |

## Related Documents

- [Location.md](Location.md) - Location workflow (creates snapshot)
- [Strategy.md](Strategy.md) - Strategy workflow (parallel to briefing)
- [AI Pipeline](ai-pipeline.md) - Detailed AI architecture
