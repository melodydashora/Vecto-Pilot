> **Last Verified:** 2026-04-11 (filter-for-planner.js NEAR/FAR event bucketing; 15-mile rule restored as supreme VENUE_SCORER constraint; analyzeTrafficWithGemini additive return shape preserves raw TomTom data for strategist enrichment)

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
| `cleanup-events.js` | Soft-deactivate past events per-snapshot (2026-02-17) | `deactivatePastEvents(timezone)` |
| `filter-for-planner.js` | Filter briefing for venue planner (2026-01-31, updated 2026-04-11 with `todayEvents` param) | `filterBriefingForPlanner(briefing, snapshot, todayEvents?)` |
| `event-schedule-validator.js` | Event verification (DISABLED — dead code) | `validateEventSchedules(events)` |
| `event-matcher.js` | **Lives in `server/lib/venue/`, not here.** Matches SmartBlocks venues ↔ discovered events using place_id + venue_id + name fallback (2026-04-11 rewrite). | `matchVenuesToEvents(venues, todayEvents)` |
| `venue-event-verifier.js` | Verify event-venue matches (hours + proximity) | `verifyEventVenueMatch()` |
| `enhanced-smart-blocks.js` | Generate SmartBlocks with event context | `generateEnhancedSmartBlocks()` |
| `district-detection.js` | Detect entertainment districts | `detectDistrict()` |
| `../../events/phase-emitter.js` | SSE phase progress to client (lives in `server/events/`, not here) | `emitPhase()` |
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
// fetchEventsForBriefing() steps:

// Step 0: Deactivate past events (2026-02-17)
await deactivatePastEvents(timezone); // is_active = false for ended events

// Step 1: Discover events
const discoveryResult = await fetchEventsWithGemini3ProPreview({ snapshot });

// Step 2: Normalize + validate
const normalized = discoveryResult.items.map(e => normalizeEvent(e));
const { valid: validatedEvents } = validateEventsHard(normalized);

// Step 3: Geocode + venue creation (2026-02-17)
const geocodeResult = await geocodeEventAddress(event.venue_name, city, state);
const venue = await findOrCreateVenue({ ... }, 'briefing_discovery');

// Step 4: Store with canonical field names
await db.insert(discovered_events).values({
  title: event.title,
  venue_name: event.venue_name,
  venue_id: venue?.venue_id,            // linked to venue_catalog
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
2. `getMarketForLocation()` fallback - Looks up `market_cities` table for older snapshots
3. If both miss, market is `null` — callers use `'[unknown-market]'` placeholder (2026-04-16)

```javascript
// In fetchEventsWithGemini3ProPreview and fetchRideshareNews:
const market = snapshot.market || await getMarketForLocation(city, state);
// market may be null — callers handle with '[unknown-market]' placeholder
```

**Why from driver_profiles:**
- Market is known at signup (user selects it)
- No need for DB lookup on every briefing request
- Faster and more reliable
- City-as-market substitution is NOT allowed (see BRIEFING-DATA-MODEL.md §9)

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

## Weather Driver Impact (2026-02-26)

The `generateWeatherDriverImpact(current, forecast)` function in `briefing-service.js` produces a 1-2 sentence driver-relevant summary at store time. This replaces sending the full weather JSON blob to the strategist.

**How it works:**
- Deterministic (no LLM call) -- pattern-matches weather conditions to driver-relevant impacts
- Stored on `weather_current.driverImpact` in the briefing row
- The consolidator reads `driverImpact` directly instead of parsing raw weather JSON

**Examples:**
| Condition | Output |
|-----------|--------|
| Rain | "Rain -- expect surge, riders avoid walking." |
| Freezing temps | "Freezing 28 F -- surge likely, riders avoid cold waits." |
| Severe/tornado | "Severe weather (Tornado Warning) -- dangerous driving, expect surge from riders avoiding transit." |
| Clear, 75 F | "Clear, 75 F -- good driving conditions." |
| Clear now, rain in 2h | "Clear, 75 F -- good driving conditions. Rain expected in ~2 hours -- surge incoming." |

**Forecast lookahead:** Checks the next 3 hours for incoming rain/storms. If rain is approaching but not here yet, appends a "surge incoming" warning.

## Briefing Structure (Stored in `briefings` table)

```javascript
{
  snapshot_id: "uuid",

  // Weather (Google Weather API)
  weather_current: { tempF, conditions, humidity, ..., driverImpact: "Rain — expect surge..." },
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

## JSON Parsing Resilience (2026-02-26)

`safeJsonParse()` in `briefing-service.js` uses a 5-attempt strategy to extract JSON from LLM responses:

| Attempt | Strategy |
|---------|----------|
| 1 | Direct `JSON.parse` after stripping code fences |
| 2 | Apply `fixCommonJsonIssues()` (trailing commas, unquoted props, embedded newlines) |
| 3 | Strip markdown prose/citations via `stripMarkdownProse()`, then extract with regex |
| 4 | Apply fixes to regex-extracted JSON |
| 5 | **Balanced-brace extraction** — find individual `{...}` objects and wrap in array |

**Citation suppression**: The Gemini adapter now injects a "no citations" directive at the prompt level for all `google_search` calls. `stripMarkdownProse()` in the parser acts as a safety net, removing any residual markdown links (`[text](url)`) and header lines before regex extraction.

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

## Briefing Filter for Venue Planner (2026-01-31, updated 2026-04-11)

The `filter-for-planner.js` module filters full briefing data for efficient venue planner consumption and formats events into a prompt-ready form that works with the 15-mile rule.

```javascript
import { filterBriefingForPlanner, formatBriefingForPrompt } from './filter-for-planner.js';

// 2026-04-11: Preferred — pass pre-fetched state-scoped events as 3rd arg.
// The caller (enhanced-smart-blocks.js) pre-fetches events with driver
// coordinates so distance annotation is available for downstream NEAR/FAR
// bucketing in formatBriefingForPrompt.
const filteredBriefing = filterBriefingForPlanner(briefingRow, snapshot, todayEvents);

// Legacy — city-scoped filter path, kept for back-compat (no active callers)
const filteredBriefing = filterBriefingForPlanner(briefingRow, snapshot);

// Format for LLM prompt inclusion. Events are split into NEAR (≤ 15 mi,
// candidate venues) and FAR (> 15 mi, surge flow intelligence) buckets
// based on the `_distanceMiles` annotation attached by the caller's fetch.
const promptSection = formatBriefingForPrompt(filteredBriefing);
```

### Filtering Rules

| Data Type | Filter Logic |
|-----------|--------------|
| Events (2026-04-11) | **Preferred path:** pre-fetched by caller via state-scoped `discovered_events ⋈ venue_catalog` query, distance-annotated with `_distanceMiles` — passed as `todayEvents` arg. `filterBriefingForPlanner` uses them directly without further filtering. **Legacy path:** `briefing.events` with the deprecated 2026-01-31 city/state split, kept only for any unmigrated callers. The city-match branch has a stale-data bug post-2026-04-11 address correctness work; no active callers remain. |
| Traffic | Summary only: briefing text + top 3 keyIssues + top 2 avoidAreas |
| Weather | Essential fields: condition, temperature, driver impact |
| School Closures | Today only (start_date <= today <= end_date) |
| Airport | Pass-through (already summarized) |

### Event Bucketing in `formatBriefingForPrompt` (2026-04-11)

When events carry a `_distanceMiles` annotation (attached by the caller's pre-fetch with driver coordinates), `formatBriefingForPrompt` splits them into two bucketed blocks before emitting the prompt section. The split is governed by the `NEAR_EVENT_RADIUS_MILES = 15` constant inside the formatter — the same 15-mile rule `VENUE_SCORER` enforces as its supreme venue-eligibility constraint.

**NEAR EVENTS block** (within 15 mi of driver — candidate venues):
- Header labels the events as CANDIDATE VENUES.
- Body instructs `VENUE_SCORER` to recommend the event venue directly with event-specific `pro_tips` (pickup surge timing, post-show staging, pre-show drop-off) when the event is high-impact and starting/ending within the next 2 hours.
- Slice cap: 6 events. Bounded to keep prompt size reasonable; the closest-first sort from the caller ensures the 6 shown are the most driver-relevant.

**FAR EVENTS block** (beyond 15 mi of driver — surge flow intelligence):
- Header labels the events as SURGE FLOW INTELLIGENCE and explicitly tells the model `DO NOT recommend these venues` — they violate the 15-mile rule.
- Body instructs `VENUE_SCORER` to reason about **demand origination**: attendees travel FROM hotels, residential areas, and dining clusters NEAR the driver TO these far venues. That outflow creates pickup demand within the driver's 15-mile radius at the departure end (not at the event). The prompt tells the model to recommend the closest high-impact venues in the driver's radius that benefit from the outflow (hotels near freeway on-ramps, dining hubs, residential/entertainment centers where attendees pre-load).
- Slice cap: 8 events.

**Unbucketed fallback**: If events lack `_distanceMiles` (the caller did not pass driver coordinates), the formatter renders them under a neutral "distance not annotated" header noting that the 15-mile rule still applies. No bucketing attempted. This path is reachable only from legacy callers; the primary Smart Blocks pipeline always passes driver coordinates.

**Per-event rendering (both buckets):** venue name, exact coordinates, full address, start/end time, category, expected attendance, and distance from driver. The formatter prefers `venue_catalog` joined fields (`vc_venue_name`, `vc_formatted_address`, `vc_lat`, `vc_lng`) when available, falling back to `discovered_events` fields for orphan events with a null `venue_id`.

### Why This Matters

- **Token reduction.** Full briefing can be 5K+ tokens. Filtered version is ~500 tokens pre-bucketing, ~700–900 tokens with NEAR/FAR blocks rendered (depending on how many events fall in each bucket and the caps above).
- **Relevance.** Venue planner only needs today's actionable data and today's surge-flow intelligence. Historical events, stale traffic, and weather forecasts outside the next hour are dropped upstream.
- **Metro-wide event visibility.** State-scoped event fetching at the caller layer surfaces every event in the driver's metro, not just those whose venue happens to be in the driver's literal city. Cross-city metro events (typical in any large market where the driver's metro spans multiple municipalities) reach the prompt so the planner can reason about metro-wide demand flow.
- **Closest-first invariant preserved.** By splitting events into NEAR (candidate venues) and FAR (intelligence), the planner prompt lets `VENUE_SCORER` use far-event data for origination reasoning without weakening the 15-mile rule. Far events enrich close-venue selection without polluting the candidate pool. A driver in any metro keeps seeing the closest high-impact venues first, whether or not distant events are happening tonight.

### See also

- `../venue/README.md` § "Smart Blocks ↔ Event Venue Coordination (2026-04-11)" — venue module perspective on how the NEAR/FAR prompt output is consumed
- `../venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` — full history of the alignment work: initial fix (sections 1–11), first followup (section 12), second revert (section 13)
- `../../../docs/EVENTS.md` § 10 "Smart Blocks ↔ Event Venue Coordination" — canonical reference

## Traffic Intelligence Persistence (2026-04-11)

`analyzeTrafficWithGemini` (in `briefing-service.js`) now preserves raw TomTom data alongside Gemini's analyzed strings. This is an **additive** change — existing callers that read only `briefing`, `headline`, `keyIssues`, `avoidAreas`, `driverImpact`, `closuresSummary`, `constructionSummary` see no behavior change. New callers (specifically the strategist) can now read structured incident/closure/zone data.

### What's in the return object

| Field | Type | Purpose |
|-------|------|---------|
| `briefing` | string | Gemini's 2–3 sentence strategic summary (existing) |
| `headline` | string | First sentence of the briefing (existing) |
| `keyIssues` | string[] | Gemini's 3 top issue strings with road + distance + impact (existing) |
| `avoidAreas` | string[] | Gemini's areas-to-avoid corridor strings (existing) |
| `driverImpact` | string | 1-sentence strategic summary (existing) |
| `closuresSummary` | string | Gemini's closures description (existing) |
| `constructionSummary` | string | Gemini's construction description (existing) |
| `analyzedAt` | ISO timestamp | Analysis time (existing) |
| `provider` | string | `'BRIEFING_TRAFFIC'` (existing) |
| **`incidents`** | Array<object> | **NEW** — top 20 raw TomTom incidents with `road`, `category`, `distanceFromDriver`, `isHighway`, `magnitude`, `delayMinutes`, `from`, `to`, `location` |
| **`closures`** | Array<object> | **NEW** — incidents filtered to `category === 'Road Closed'` or `'Lane Closed'`, top 10 |
| **`highwayIncidents`** | Array<object> | **NEW** — incidents filtered to `isHighway === true`, top 10 |
| **`congestionLevel`** | string | **NEW** — TomTom's congestion level (`low` / `medium` / `high` / `unknown`) |
| **`highDemandZones`** | Array | **NEW** — TomTom's high-demand zone list (often empty, reserved for future traffic intelligence) |

### Why this change exists

The strategist in `server/lib/ai/providers/consolidator.js` previously received only Gemini's 1-line `driverImpact` summary as its entire traffic block. After the 2026-04-11 strategist enrichment (`STRATEGIST_ENRICHMENT_PLAN.md`), the strategist now needs structured data to render the compact TRAFFIC block with:

- `TRAFFIC: {driverImpact} | Congestion: {congestionLevel}`
- `AVOID: {avoidArea1} | {avoidArea2} | ...`
- `CLOSURES: {road1} ({dist1}mi) | {road2} ({dist2}mi) | ...`
- `TOP INCIDENTS: {road1} ({dist1}mi, {severity1}) | ...`
- `HIGH-DEMAND ZONES: {zone1} | ...`

Without the additive return-shape change, the strategist would have to reverse-engineer road names and distances from Gemini's free-text `keyIssues` strings. With the additive change, the strategist reads structured fields directly.

### Graceful degradation — legacy briefings

Any briefing written **before** this change lacks the five new fields. The strategist's `formatTrafficIntelForStrategist` helper (in `consolidator.js`) falls back to the pre-existing fields — `avoidAreas[]`, `keyIssues[]`, `driverImpact`. Older rows produce a less-structured but still-useful TRAFFIC block. **No breakage, no migration needed.**

### JSONB storage impact

The raw TomTom data adds ~5–10 KB per briefing row to the `briefings.traffic_conditions` column. `briefings` is a PostgreSQL table with JSONB columns and no documented size constraint, so the addition is well within limits for typical row sizes.

### See also

- `../ai/providers/STRATEGIST_ENRICHMENT_PLAN.md` § 6 — the design rationale and graceful-degradation ladder
- `../ai/providers/README.md` § "Strategist Data Enrichment (2026-04-11)" — the consumer side (how the strategist reads these fields)

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
