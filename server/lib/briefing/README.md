> **Last Verified:** 2026-02-01

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
| `filter-for-planner.js` | Filter briefing for venue planner (2026-01-31) | `filterBriefingForPlanner(briefing, snapshot)` |
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
| `BRIEFING_EVENTS_DISCOVERY` | Gemini 3 Pro | Event discovery | `[{ title, venue, address, event_start_date, event_start_time, event_end_time, event_end_date }]` |
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

### Hybrid Search Architecture (2026-02-01)

Event discovery uses **2 focused parallel searches** instead of 5 separate category searches:

| Search | Focus | Event Types |
|--------|-------|-------------|
| `high_impact` | Major venues (stadiums, arenas, theaters) | concerts, sports, festivals |
| `local_entertainment` | Smaller venues (bars, clubs, community) | live_music, comedy, nightlife, community |

**Why 2 searches instead of 5:**
- **60% cost reduction** - 2 API calls vs 5
- **Same quality** - each search is comprehensive for its focus area
- **Better resilience** - focused prompts get better grounding results
- **90s timeout per search** - Gemini with HIGH thinking needs time

**Why not 1 single search:**
- Single prompt would be too broad → misses niche events
- One failure kills all events
- Better LLM focus with split high-impact vs local

### Market-Based Event Discovery (2026-02-01)

Event and news searches use the **market** (e.g., "Dallas-Fort Worth") instead of just the driver's city (e.g., "Frisco"). This ensures we find events at AT&T Stadium (Arlington), AAC (Dallas), and other major venues across the metro area.

**Market Source Priority:**
1. `snapshot.market` - From `driver_profiles.market` (set at user signup)
2. `getMarketForLocation()` fallback - Looks up `us_market_cities` table for older snapshots

```javascript
// In fetchEventsWithGemini3ProPreview and fetchRideshareNews:
const market = snapshot.market || await getMarketForLocation(city, state);
```

**Why from driver_profiles:**
- Market is known at signup (user selects it)
- No need for DB lookup on every briefing request
- Faster and more reliable

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
  // 2026-02-01: event_end_date added (defaults to event_start_date for single-day events)
  events: [{ title, venue, event_start_date, event_start_time, event_end_time, event_end_date, category }],

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

## Briefing Filter for Venue Planner (2026-01-31)

The `filter-for-planner.js` module filters full briefing data for efficient venue planner consumption:

```javascript
import { filterBriefingForPlanner, formatBriefingForPrompt } from './filter-for-planner.js';

// Filter briefing to reduce token usage
const filteredBriefing = filterBriefingForPlanner(briefingRow, snapshot);

// Format for LLM prompt inclusion
const promptSection = formatBriefingForPrompt(filteredBriefing);
```

### Filtering Rules

| Data Type | Filter Logic |
|-----------|--------------|
| Events | Today only. Large events (stadiums, arenas) kept from entire market. Small events (bars) filtered to user's city. |
| Traffic | Summary only: briefing text + top 3 keyIssues + top 2 avoidAreas |
| Weather | Essential fields: condition, temperature, driver impact |
| School Closures | Today only (start_date <= today <= end_date) |
| Airport | Pass-through (already summarized) |

### Why This Matters

- **Token Reduction**: Full briefing can be 5K+ tokens. Filtered version is ~500 tokens.
- **Relevance**: Venue planner only needs today's actionable data.
- **Market-Wide Events**: Large events (Cowboys game in Arlington) affect traffic across the entire DFW market, so they're kept even if user is in Frisco.
- **Local Events**: Bar trivia in Dallas isn't relevant to a driver in Frisco, so it's filtered out.

## Recommended Driver Resources (Curated)

The AI news search (`BRIEFING_NEWS`) discovers relevant news dynamically, but these authoritative resources provide valuable, regularly-updated information for rideshare drivers:

| Resource | URL | Content | Update Frequency |
|----------|-----|---------|------------------|
| **Lyft Driver Hub** | `https://www.lyft.com/driver/hub` | Official Lyft driver news, policy changes, earnings updates, promotions | Real-time |
| **AAA Gas Prices** | `https://gasprices.aaa.com/?state={STATE}` | State-by-state fuel prices, trends | Daily |
| **Uber Driver Blog** | `https://www.uber.com/blog/driver/` | Official Uber driver updates, features | Weekly |

### Dynamic URL Parameters

For global app support, these URLs use dynamic state/region parameters:

```javascript
// AAA Gas Prices - uses user's state/province from snapshot
const gasUrl = `https://gasprices.aaa.com/?state=${snapshot.state}`;

// Example: Texas driver sees https://gasprices.aaa.com/?state=TX
// Example: California driver sees https://gasprices.aaa.com/?state=CA
```

### Why These Resources Matter

1. **Lyft Driver Hub**: Primary source for Lyft-specific policy changes, bonus structures, and market-specific promotions. Drivers should check before each shift.

2. **AAA Gas Prices**: Authoritative fuel cost data helps drivers calculate true earnings per mile and identify optimal fueling locations.

3. **Driver Platform Blogs**: Official channels for platform updates that may not appear in general news searches.

> **Note:** The `BRIEFING_NEWS` AI search covers general rideshare news from multiple sources. These curated resources complement AI-discovered news with authoritative, platform-specific information.
