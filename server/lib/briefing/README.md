# Briefing Module (`server/lib/briefing/`)

## Purpose

Real-time briefing service for events, traffic, weather, and news. Provides the data shown in the Briefing tab.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `briefing-service.js` | Main briefing orchestrator | `getOrGenerateBriefing(snapshotId)` |
| `event-schedule-validator.js` | Event verification | `validateEventSchedules(events)` |

## Usage

```javascript
import { getOrGenerateBriefing, refreshEventsInBriefing } from './briefing-service.js';

// Get or generate full briefing
const briefing = await getOrGenerateBriefing(snapshotId);

// Refresh only events (4-hour cache)
await refreshEventsInBriefing(snapshotId);
```

## Briefing Structure

```javascript
{
  events: [
    { name: "Concert at Arena", time: "7:00 PM", venue: "..." }
  ],
  traffic: {
    summary: "Light traffic on I-35",
    congestionLevel: "low",
    incidents: []
  },
  weather: {
    tempF: 72,
    conditions: "Clear",
    forecast: [...]
  },
  news: [
    { headline: "Airport expansion...", source: "..." }
  ],
  school_closures: [...]
}
```

## Cache Durations

| Data Type | Cache Duration | Reason |
|-----------|----------------|--------|
| Events | 4 hours | Events can change |
| News | 24 hours | Until midnight rollover |
| School Closures | 24 hours | Daily updates |
| Traffic | Real-time | Always fresh |
| Weather | From snapshot | Captured at request time |

## Event Validation

Uses Claude Opus with web search to verify event schedules:

```javascript
import { validateEventSchedules } from './event-schedule-validator.js';

const verified = await validateEventSchedules(events, city, state);
// Returns events with { verified: true/false, verification_note: "..." }
```

## Connections

- **Imports from:** `../ai/adapters/` (callModel), `../../db/`
- **Exported to:** `../../routes/briefing.js`, `../../routes/blocks-fast.js`

## Traffic Fallback

When Gemini returns empty traffic data, uses fallback:

```javascript
{
  summary: "Traffic conditions unavailable - using default",
  congestionLevel: "medium",
  isFallback: true,
  incidents: [],
  majorRoutes: []
}
```

## Import Paths

```javascript
// From server/api/*/
import { getOrGenerateBriefing } from '../../lib/briefing/briefing-service.js';
import { validateEventSchedules } from '../../lib/briefing/event-schedule-validator.js';

// From server/lib/*/
import { getOrGenerateBriefing } from '../briefing/briefing-service.js';
```
