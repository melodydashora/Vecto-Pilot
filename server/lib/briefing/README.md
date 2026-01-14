> **Last Verified:** 2026-01-14

# Briefing Module (`server/lib/briefing/`)

## Purpose

Real-time briefing service for events, traffic, weather, news, airport conditions, and school closures. Provides the data shown in the Briefing tab and consumed by the Strategist AI.

## Architecture: The Briefer Model (2026-01-14)

**Single Model Architecture:** All briefing data is discovered using **Gemini 3 Pro with Google Search tools** (no SerpAPI, no GPT-5.2 in the briefing path).

```
┌─────────────────────────────────────────────────────────────────┐
│                    generateBriefingInternal()                    │
├─────────────────────────────────────────────────────────────────┤
│  Promise.all([                                                   │
│    fetchWeatherConditions()  → Google Weather API                │
│    fetchTrafficConditions()  → TomTom → callModel('BRIEFING_TRAFFIC') │
│    fetchEventsForBriefing()  → callModel('BRIEFING_EVENTS_DISCOVERY') │
│    fetchAirportConditions()  → callModel('BRIEFING_AIRPORT')     │
│    fetchRideshareNews()      → callModel('BRIEFING_NEWS')        │
│  ])                                                              │
│                                                                  │
│  + fetchSchoolClosures() if cache miss                           │
├─────────────────────────────────────────────────────────────────┤
│  All data stored in `briefings` table (JSONB columns)            │
│  Snapshot + Briefing row passed to Strategist AI                 │
└─────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `briefing-service.js` | Main briefing orchestrator | `getOrGenerateBriefing(snapshotId)` |
| `event-schedule-validator.js` | Event verification (DISABLED) | `validateEventSchedules(events)` |
| `index.js` | Module barrel exports | All briefing exports |
| `dump-last-briefing.js` | Debug utility: dump last briefing | CLI script |
| `dump-latest.js` | Debug utility: dump latest briefing | CLI script |
| `dump-traffic-format.js` | Debug utility: traffic format check | CLI script |
| `test-api.js` | API testing utility | Test helpers |

## Briefer Model Roles

All discovery uses the centralized `callModel()` adapter with these roles:

| Role | Model | Purpose | JSON Schema |
|------|-------|---------|-------------|
| `BRIEFING_TRAFFIC` | Gemini 3 Pro | Traffic analysis | `{ summary, congestionLevel, incidents[], highDemandZones[], repositioning }` |
| `BRIEFING_EVENTS_DISCOVERY` | Gemini 3 Pro | Event discovery | `[{ title, venue, address, event_start_date, event_start_time, event_end_time }]` |
| `BRIEFING_NEWS` | Gemini 3 Pro | Rideshare news | `[{ title, summary, impact, published_date }]` |
| `BRIEFING_AIRPORT` | Gemini 3 Pro | Airport conditions | `{ airports[], busyPeriods[], recommendations }` |
| `BRIEFING_SCHOOL_CLOSURES` | Gemini 3 Pro | School closures | `[{ district, type, reason, closed_date, reopen_date, impact }]` |

## Event Discovery Flow

Events are discovered by Gemini and stored in `discovered_events` table:

```javascript
// fetchEventsForBriefing() calls:
const discoveryResult = await fetchEventsWithGemini3ProPreview({ snapshot });

// Events are normalized, validated, and stored
const normalized = discoveryResult.items.map(e => normalizeEvent(e));
const { valid: validatedEvents } = validateEventsHard(normalized);

// Stored in discovered_events with canonical field names
await db.insert(discovered_events).values({
  title: event.title,
  venue_name: event.venue_name,
  event_start_date: event.event_start_date,  // YYYY-MM-DD
  event_start_time: event.event_start_time,  // "7:00 PM"
  event_end_time: event.event_end_time,
  event_hash: hash
}).onConflictDoUpdate({ target: discovered_events.event_hash, ... });
```

## Usage

```javascript
import { getOrGenerateBriefing, generateAndStoreBriefing } from './briefing-service.js';

// Get or generate full briefing (with caching)
const briefing = await getOrGenerateBriefing(snapshotId, snapshot);

// Generate fresh briefing (pass full snapshot row)
const result = await generateAndStoreBriefing({ snapshotId, snapshot });
```

## CRITICAL: Pass Full Snapshot Row

**Always pass the full snapshot object** to avoid redundant DB fetches:

```javascript
// CORRECT - Pass full snapshot row
await generateAndStoreBriefing({ snapshotId, snapshot: fullSnapshotRow });

// WRONG - Forces DB fetch
await generateAndStoreBriefing({ snapshotId });
```

The snapshot MUST have `formatted_address` - LLMs cannot reverse geocode.

## Briefing Structure (Stored in `briefings` table)

```javascript
{
  snapshot_id: "uuid",

  // Weather (Google Weather API)
  weather_current: { tempF, conditions, humidity, ... },
  weather_forecast: [{ hour, tempF, conditions }],

  // Traffic (TomTom → Gemini analysis)
  traffic_conditions: {
    summary: "Light traffic on I-35",
    congestionLevel: "low",
    incidents: [],
    highDemandZones: [],
    repositioning: "...",
    provider: "tomtom" | "gemini"
  },

  // Events (Gemini discovery → discovered_events table)
  events: [{ title, venue, event_start_time, event_end_time, category }],

  // News (Gemini with Google Search)
  news: { items: [{ title, summary, impact }] },

  // School Closures (Gemini, cached 24h by city)
  school_closures: [{ district, type, reason, closed_date, reopen_date, impact }],

  // Airport (Gemini with Google Search)
  airport_conditions: {
    airports: [{ code, name, delays, ... }],
    busyPeriods: [],
    recommendations: "..."
  }
}
```

## Cache Strategy (Updated 2026-01-14)

| Data Type | Cache Duration | Refresh Trigger |
|-----------|----------------|-----------------|
| Weather | **No cache** | Fresh on EVERY call (forecast changes) |
| Traffic | **No cache** | Fresh on EVERY call (TomTom real-time) |
| Events | **From DB table** | Read from `discovered_events` (Gemini discovery) |
| Airport | **No cache** | Fresh on EVERY call (delays change rapidly) |
| News | **No cache** | Fresh on EVERY call (Gemini fast enough) |
| School Closures | 24 hours by city | Same city within calendar day |

## Connections

- **Imports from:** `../ai/adapters/` (callModel), `../../db/`
- **Exported to:** `../../api/briefing/briefing.js`, `../../api/strategy/blocks-fast.js`
- **Consumed by:** Strategist AI receives snapshot + briefing data for strategy generation

## Import Paths

```javascript
// From server/api/*/
import { getOrGenerateBriefing } from '../../lib/briefing/briefing-service.js';

// From server/lib/*/
import { getOrGenerateBriefing } from '../briefing/briefing-service.js';
```
