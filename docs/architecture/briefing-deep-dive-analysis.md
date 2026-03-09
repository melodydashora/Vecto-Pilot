# Briefing System: Comprehensive Deep-Dive Analysis

**Generated:** 2026-03-09
**Branch:** `claude/analyze-briefings-workflow-Ylu9Q`
**Scope:** Complete analysis of the briefing pipeline — service layer, event pipeline, AI adapters, API endpoints, database schema, client integration, and SSE notifications.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Service: briefing-service.js](#2-core-service-briefing-servicejs)
3. [Event Discovery Pipeline](#3-event-discovery-pipeline)
4. [Traffic Subsystem](#4-traffic-subsystem)
5. [Weather Subsystem](#5-weather-subsystem)
6. [News Subsystem](#6-news-subsystem)
7. [Airport Subsystem](#7-airport-subsystem)
8. [School Closure Subsystem](#8-school-closure-subsystem)
9. [AI Adapter Layer (callModel)](#9-ai-adapter-layer-callmodel)
10. [Model Registry](#10-model-registry)
11. [REST API Endpoints](#11-rest-api-endpoints)
12. [Database Schema & Migrations](#12-database-schema--migrations)
13. [SSE Notifications (briefing_ready)](#13-sse-notifications-briefing_ready)
14. [Client Integration](#14-client-integration)
15. [Caching & Freshness Strategy](#15-caching--freshness-strategy)
16. [Error Handling Patterns](#16-error-handling-patterns)
17. [Filter for Planner](#17-filter-for-planner)
18. [Test Coverage](#18-test-coverage)
19. [File Inventory](#19-file-inventory)

---

## 1. System Overview

The briefing system is a multi-source intelligence pipeline that generates real-time, actionable briefings for rideshare drivers. It pulls data from 6 domains (traffic, weather, events, news, airport conditions, school closures), consolidates them via AI analysis, stores the results, and delivers them to the client via REST + SSE.

### High-Level Data Flow

```
Snapshot Creation (POST /api/snapshot)
         │
         ▼
generateAndStoreBriefing({ snapshotId, snapshot })
         │
    ┌────┴────┐
    │ DEDUP   │  Check inFlightBriefings Map + DB (< 60s)
    └────┬────┘
         │
    ┌────┴────┐
    │PLACEHOLDER│  Create/Update briefings row (NULL fields)
    └────┬────┘
         │
         ▼
generateBriefingInternal({ snapshotId, snapshot })
         │
    ┌────┴──────────────────────────────────────────┐
    │              Promise.all (PARALLEL)            │
    │                                                │
    │  fetchWeatherConditions()   → Google Weather   │
    │  fetchTrafficConditions()   → TomTom + AI      │
    │  fetchEventsForBriefing()   → Gemini Search    │
    │  fetchAirportConditions()   → Gemini Search    │
    │  fetchRideshareNews()       → Gemini Search    │
    │  fetchSchoolClosures()      → Cached or Gemini │
    └────┬──────────────────────────────────────────┘
         │
         ▼
    Store consolidated data → briefings table (UPDATE)
         │
         ▼
    pg_notify('briefing_ready', { snapshot_id, ... })
         │
         ▼
    SSE → Client refetches all briefing queries
```

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Parallel data fetching | Promise.all for all 6 domains — minimizes total latency |
| Per-snapshot event sync | No background workers (Rule 11) — events sync with each briefing |
| Market-based search | Uses metro market, not just driver's city — finds events across DFW, not just Dallas |
| 2-search event model | 2 focused searches vs 5 categories — 60% cost reduction |
| Soft deletes for events | `is_active=false`, never hard delete — preserves audit trail |
| Location handling | Core pipeline requires city/state/timezone, but some API endpoints have fallbacks (`timezone \|\| 'UTC'`, `city \|\| 'Unknown'`) — see Issues M-9 |

---

## 2. Core Service: briefing-service.js

**File:** `server/lib/briefing/briefing-service.js` (~2,637 lines)
**Role:** Main orchestrator for all briefing generation, storage, and retrieval.

### 2.1 Imports & Dependencies

| Import | Source | Purpose |
|--------|--------|---------|
| `db` | `../../db/drizzle.js` | Drizzle ORM database client |
| `briefings, snapshots, discovered_events, market_cities, venue_catalog` | `../../../shared/schema.js` | DB schema tables |
| `eq, and, desc, sql, gte, lte, ilike, isNotNull` | `drizzle-orm` | Query builders |
| `z` | `zod` | Schema validation |
| `briefingLog, OP` | `../../logger/workflow.js` | Structured logging |
| `callModel` | `../ai/adapters/index.js` | Centralized AI model adapter |
| `dumpLastBriefingRow` | `./dump-last-briefing.js` | Debug file dump |
| `validateEventsHard` | `../events/pipeline/validateEvent.js` | Canonical event validation |
| `normalizeEvent` | `../events/pipeline/normalizeEvent.js` | Event field normalization |
| `generateEventHash` | `../events/pipeline/hashEvent.js` | Dedup hash generation |
| `findOrCreateVenue` | `../venue/venue-cache.js` | Venue upsert (geocode+create) |
| `geocodeEventAddress` | `../events/pipeline/geocodeEvent.js` | Google Maps geocoding |
| `deactivatePastEvents` | `./cleanup-events.js` | Soft-deactivate ended events |
| `getTomTomTraffic, fetchRawTraffic` | `../traffic/tomtom.js` | Real-time traffic API |
| `haversineDistanceMiles` | `../location/geo.js` | Distance calculation |
| `sendModelErrorAlert` | `../notifications/email-alerts.js` | Error email alerts (UNUSED) |

**Unused imports:** `needsReadTimeValidation`, `VALIDATION_SCHEMA_VERSION`, `sendModelErrorAlert`

### 2.2 Constants & Configuration

| Constant | Value | Purpose |
|----------|-------|---------|
| `EVENT_SEARCH_TIMEOUT_MS` | `90000` (90s) | Max time per AI event category search |
| `GOOGLE_MAPS_API_KEY` | env var | Google Weather API key |
| `inFlightBriefings` | `new Map()` | In-process concurrency dedup map |
| `EVENTS_CACHE_HOURS` | `4` | Events considered stale after 4h |
| `EVENT_CATEGORIES` | 2-element array | `high_impact` + `local_entertainment` |

### 2.3 Complete Function Inventory (42 functions)

#### Exported Functions (12)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `generateAndStoreBriefing` | `({ snapshotId, snapshot })` → `{ success, briefing, deduplicated? }` | Top-level orchestrator. Dedup check, placeholder row, generate all sections, store to DB, pg_notify. |
| `getOrGenerateBriefing` | `(snapshotId, snapshot, { forceRefresh? })` → `Object\|null` | Smart cache controller: returns existing if fresh, refreshes volatile data, regenerates if stale. |
| `getBriefingBySnapshotId` | `(snapshotId)` → `Object\|null` | Simple DB lookup. |
| `fetchEventsForBriefing` | `({ snapshot })` → `{ items, reason, provider }` | Full events pipeline: deactivate → discover → normalize → validate → geocode → venue → dedup → store → read back. |
| `fetchWeatherConditions` | `({ snapshot })` → `{ current, forecast, fetchedAt }` | Google Weather API (primary). |
| `fetchWeatherForecast` | `({ snapshot })` → `{ current, forecast }` | AI-based weather via BRIEFING_WEATHER (appears unused in pipeline). |
| `fetchTrafficConditions` | `({ snapshot })` → `Object` | TomTom primary + Gemini fallback. |
| `fetchRideshareNews` | `({ snapshot })` → `{ items, reason, provider }` | Gemini news search (2-day window). |
| `fetchSchoolClosures` | `({ snapshot })` → `Array` | Gemini search, 15mi radius, 24h cache. |
| `filterInvalidEvents` | `(events)` → `Array` | Deprecated wrapper → delegates to `validateEventsHard()`. |
| `deduplicateEvents` | `(events)` → `Array` | Key-based dedup: normalized (name + address_base + start_time). |
| `refreshEventsInBriefing` | `(briefing, snapshot)` → `Object` | Refresh just events in an existing briefing. |

#### Internal Functions (30)

| Function | Purpose |
|----------|---------|
| `generateBriefingInternal` | Core generation: cache check → parallel fetch → store → pg_notify |
| `withTimeout` | Race a promise against timeout. Returns `{ timedOut: true }` on timeout. |
| `getMarketForLocation` | DB lookup in `market_cities` to resolve city → metro market name |
| `getSchoolSearchTerms` | Region-specific school terminology (US/UK/Canada/Australia) |
| `fetchEventsWithGemini3ProPreview` | Main Gemini event discovery: 2 parallel category searches, merge, dedup |
| `fetchEventCategory` | Single category search via BRIEFING_EVENTS_DISCOVERY |
| `fetchEventsWithClaudeWebSearch` | Claude fallback for event discovery |
| `fetchNewsWithClaudeWebSearch` | Claude fallback for news |
| `analyzeTrafficWithAI` | Feed TomTom data to BRIEFING_TRAFFIC model for strategic analysis |
| `fetchAirportConditions` | Airport conditions via BRIEFING_AIRPORT (Gemini + Google Search) |
| `safeJsonParse` | Multi-attempt JSON parser (direct → fix issues → extract from text) |
| `cleanMarkdown` | Strip markdown code fences |
| `fixCommonJsonIssues` | Fix single quotes, unquoted keys, trailing commas |
| `mapGeminiEventsToLocalEvents` | Maps raw Gemini response to LocalEventSchema (DEAD CODE) |
| `normalizeEventName` | Strip quotes, prefixes, parenthetical content (nested in deduplicateEvents) |
| `normalizeAddress` | Extract street name for dedup key (nested in deduplicateEvents) |
| `normalizeTime` | Convert "3:30 PM" → "1530" (nested in deduplicateEvents) |
| `getDedupeKey` | Combine normalized name + address + time |
| `filterRecentNews` | Safety filter: removes news older than 2 days |
| `buildNewsPrompt` | Constructs enhanced news search prompt |
| `consolidateNewsItems` | Jaccard dedup for news (DEAD CODE — never called) |
| `usesMetric` | Returns true if country uses metric system |
| `formatTemperature` | Celsius → locale-appropriate format |
| `formatWindSpeed` | m/s → km/h or mph |
| `isDailyBriefingStale` | True if briefing is from different calendar day |
| `isEventsStale` | True if events > 4 hours old |
| `isTrafficStale` | Always returns `true` |
| `areEventsEmpty` | True if events array is empty/null |
| `refreshTrafficInBriefing` | Refresh just traffic in existing briefing |
| `refreshNewsInBriefing` | Refresh just news in existing briefing |
| `_fetchEventsWithGemini3ProPreviewLegacy` | DEAD CODE — legacy single-search, never called |

### 2.4 Deduplication Logic

**Event Deduplication (2 layers):**
1. **During discovery merge:** Simple `Set` of lowercase title strings — fast but crude
2. **Post-DB-read (`deduplicateEvents`):** Normalized key-based dedup using `(name + address_base + start_time)`. Keeps highest impact, then shortest title.

**News Deduplication:**
- `consolidateNewsItems`: Jaccard word similarity (60% threshold on first 50 chars). **DEAD CODE — never called.** Current pipeline uses `filterRecentNews` only.

**Briefing-level Deduplication:**
- In-process `inFlightBriefings` Map (promise-level for concurrent calls)
- DB-level: check if existing briefing has all fields populated AND < 60 seconds old

### 2.5 All AI Model Calls

| Role | Function | Purpose |
|------|----------|---------|
| `BRIEFING_EVENTS_DISCOVERY` | `fetchEventCategory` | Per-category event search |
| `BRIEFING_FALLBACK` | `fetchEventsWithClaudeWebSearch` | Claude event search fallback |
| `BRIEFING_FALLBACK` | `fetchNewsWithClaudeWebSearch` | Claude news fallback |
| `BRIEFING_TRAFFIC` | `analyzeTrafficWithAI` | TomTom data → strategic analysis |
| `BRIEFING_TRAFFIC` | `fetchTrafficConditions` (Gemini path) | Gemini traffic when TomTom fails |
| `BRIEFING_WEATHER` | `fetchWeatherForecast` | AI weather forecast (appears unused) |
| `BRIEFING_NEWS` | `fetchRideshareNews` | Primary news search |
| `BRIEFING_SCHOOLS` | `fetchSchoolClosures` | School closure discovery |
| `BRIEFING_AIRPORT` | `fetchAirportConditions` | Airport conditions |

**Total: 7 distinct roles, 9 active call sites.**

### 2.6 All Database Operations

| Table | Operation | Function |
|-------|-----------|----------|
| `market_cities` | SELECT | `getMarketForLocation` |
| `discovered_events` | UPDATE (batch) | `deactivatePastEvents` |
| `discovered_events` | INSERT ON CONFLICT | `fetchEventsForBriefing` |
| `discovered_events` LEFT JOIN `venue_catalog` | SELECT | `fetchEventsForBriefing` |
| `briefings` | SELECT | `getBriefingBySnapshotId` |
| `briefings` | SELECT (dedup) | `generateAndStoreBriefing` |
| `briefings` | INSERT (placeholder) | `generateAndStoreBriefing` |
| `briefings` | UPDATE (clear fields) | `generateAndStoreBriefing` |
| `briefings` JOIN `snapshots` | SELECT (school cache) | `generateBriefingInternal` |
| `briefings` | UPDATE (store data) | `generateBriefingInternal` |
| `briefings` | UPDATE (events only) | `refreshEventsInBriefing` |
| `briefings` | UPDATE (traffic only) | `refreshTrafficInBriefing` |
| `briefings` | UPDATE (news only) | `refreshNewsInBriefing` |
| `snapshots` | SELECT | `generateBriefingInternal` |
| — | `pg_notify('briefing_ready')` | `generateBriefingInternal` |

---

## 3. Event Discovery Pipeline

### 3.1 Pipeline Flow

```
deactivatePastEvents(timezone)
     │
     ▼
fetchEventsWithGemini3ProPreview({ snapshot })
     │
     ├── fetchEventCategory('high_impact', ...)    ─┐
     │                                               ├── Promise.all (parallel)
     └── fetchEventCategory('local_entertainment')  ─┘
                    │
                    ▼
            Merge + title-based dedup (Set)
                    │
                    ▼
            normalizeEvent(event)  (per-event)
                    │
                    ▼
            validateEventsHard(events)
                    │
                    ▼
            geocodeEventAddress(event)  (per-event, 500ms delay)
                    │
                    ▼
            findOrCreateVenue({ title, address, ... })
                    │
                    ▼
            generateEventHash(event)
                    │
                    ▼
            INSERT INTO discovered_events ON CONFLICT (event_hash) DO UPDATE
                    │
                    ▼
            SELECT FROM discovered_events WHERE city/state + 7-day window
                    │
                    ▼
            deduplicateEvents(rows)
                    │
                    ▼
            Return { items, reason, provider }
```

### 3.2 Event Categories (2-Search Model)

```javascript
const EVENT_CATEGORIES = [
  {
    name: 'high_impact',
    description: 'Major events at large venues (stadiums, arenas, concert halls)',
    searchTerms: (market, state, date) =>
      `concerts sports games festivals ${market} metro ${state} ${date} stadium arena theater NBA NFL NHL MLB MLS college major events`,
    eventTypes: ['concert', 'sports', 'festival', 'game'],
    maxEvents: 8
  },
  {
    name: 'local_entertainment',
    description: 'Local nightlife and community events',
    searchTerms: (market, state, date) =>
      `comedy shows live music bars nightlife community events ${market} ${state} ${date} trivia karaoke DJ local entertainment`,
    eventTypes: ['live_music', 'comedy', 'nightlife', 'community'],
    maxEvents: 8
  }
];
```

### 3.3 Event Normalization (`normalizeEvent.js`)

Normalizes fields to canonical format:
- `event_start_date` → YYYY-MM-DD
- `event_start_time` / `event_end_time` → "7:00 PM" format
- `category` → lowercase, mapped to canonical set
- `expected_attendance` → high/medium/low
- `venue_name`, `address`, `city`, `state` → trimmed

### 3.4 Event Validation (`validateEvent.js`)

`validateEventsHard(events)` → `{ valid: [], invalid: [] }`
- Removes events with TBD/Unknown/null in: title, venue_name, event_start_date, event_start_time, event_end_time
- Validates date format (YYYY-MM-DD)
- Validates time format (H:MM AM/PM)

### 3.5 Event Hashing (`hashEvent.js`)

`generateEventHash(event)` → MD5 string
- Input: `normalized(title) + venue_name + event_start_date + city`
- All inputs lowercased and trimmed before hashing

### 3.6 Geocoding (`geocodeEvent.js`)

`geocodeEventAddress(event)` → `{ lat, lng }` or `null`
- Uses Google Maps Geocoding API
- 500ms delay between calls (rate limiting)
- Returns null on failure (non-fatal)

### 3.7 Venue Matching (`venue-cache.js`)

`findOrCreateVenue({ title, address, city, state, lat, lng })`:
1. Search by normalized address in `venue_catalog`
2. If found → return existing `venue_id`
3. If not found → geocode → create new venue → return `venue_id`
4. Links `discovered_events.venue_id` to `venue_catalog.id`

### 3.8 Event Deactivation (`cleanup-events.js`)

`deactivatePastEvents(timezone)`:
- Throws if timezone missing
- Calculates today/now in driver's timezone
- Sets `is_active = false` where event has ended
- Non-fatal: catches errors, returns 0

### 3.9 Claude Fallback for Events

If Gemini returns 0 events across both categories, falls back to `fetchEventsWithClaudeWebSearch()`:
- Uses `BRIEFING_FALLBACK` role
- Searches same 2 categories sequentially
- Same normalization/validation pipeline

---

## 4. Traffic Subsystem

**File:** `server/lib/traffic/tomtom.js`

### 4.1 Architecture: Dual-Fetch + AI Analysis

```
Step 1: fetchRawTraffic(lat, lng, 10)        → Raw TomTom JSON (flow + incidents)
Step 2: getTomTomTraffic({lat, lng, ...})     → Processed incidents + stats
Step 3: analyzeTrafficWithAI({raw, processed}) → Strategic driver advice (BRIEFING_TRAFFIC)
```

### 4.2 TomTom API Calls

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `fetchRawTraffic` | `GET /traffic/services/4/flowSegmentData/relative0/10/json` | Flow segment data |
| `fetchRawTraffic` | `GET /traffic/services/5/incidentDetails` | Incident details |
| `getTomTomTraffic` | Same incidents endpoint + additional fields | Full incident processing |

**Auth:** `TOMTOM_API_KEY` env var as query parameter.

### 4.3 Processing Pipeline (getTomTomTraffic)

1. Parse raw incidents → structured objects with category/magnitude labels
2. Extract coordinates, calculate distance from driver (Haversine)
3. Calculate priority score (road priority + magnitude + category + delay)
4. Deduplicate reverse-direction incidents (same endpoints, same category)
5. Filter by `maxDistanceMiles` (default 10mi)
6. Sort by priority score descending
7. Categorize (highway, construction, closures, jams, accidents)
8. Calculate congestion level: heavy/moderate/light
9. Return top 15 incidents

### 4.4 AI Analysis Output

```javascript
{
  briefing: "2-3 sentence strategic summary",
  keyIssues: ["I-35 accident 3.2mi north - 15min delays", ...],
  avoidAreas: ["Area/corridor: reason with distance", ...],
  driverImpact: "How this affects operations RIGHT NOW",
  closuresSummary: "X closures within 10mi",
  constructionSummary: "Construction zones summary",
  congestionLevel: "low|medium|high",
  analyzedAt: ISO timestamp,
  provider: "tomtom"
}
```

### 4.5 Fallback Chain

TomTom + AI Analysis → Gemini Search (BRIEFING_TRAFFIC) → Hardcoded fallback object

---

## 5. Weather Subsystem

### 5.1 Primary: Google Weather API (`fetchWeatherConditions`)

**Parallel API calls:**
- Current: `GET https://weather.googleapis.com/v1/currentConditions:lookup`
- Forecast: `GET https://weather.googleapis.com/v1/forecast/hours:lookup` (6 hours)

**Data transformation:**
- Temperature: Celsius → both F and C via `formatTemperature()`
- Wind speed: m/s → mph or km/h via `formatWindSpeed()`
- Display units: Auto-selected by country (US=imperial)

**Output:**
```javascript
{
  current: { temperature, tempF, tempC, tempUnit, feelsLike, conditions,
             conditionType, humidity, windSpeed, windDirection, uvIndex,
             precipitation, visibility, isDaytime, observedAt, country },
  forecast: [{ time, temperature, conditions, precipitationProbability }],
  fetchedAt
}
```

### 5.2 Legacy: AI-Based Weather (`fetchWeatherForecast`)

Uses `BRIEFING_WEATHER` role (Gemini + Google Search). **Appears unused in the generation pipeline** — only `fetchWeatherConditions` is called in `generateBriefingInternal`.

---

## 6. News Subsystem

### 6.1 Primary: Gemini Search (`fetchRideshareNews`)

- **Model:** `BRIEFING_NEWS` (Gemini 3 Pro, temp 0.4, 8192 tokens, thinkingLevel HIGH)
- **Prompt categories:** Airport news, major headlines, traffic/road, Uber/Lyft updates, gig economy, weather impacts, gas/costs
- **Search scope:** Market-wide (not just driver's city)
- **Post-processing:** `filterRecentNews()` (2-day window), sort by impact

### 6.2 Fallback: Claude Web Search (`fetchNewsWithClaudeWebSearch`)

- Uses `BRIEFING_FALLBACK` role
- Triggered when Gemini fails

### 6.3 News Deactivation Flow

Users can hide news items:
1. Client calls `PATCH /api/briefing/event/:eventId/deactivate` (shared endpoint)
2. Hash generated: `MD5(normalizeNewsTitle(title) + source + date)`
3. Stored in `news_deactivations` table (per-user)
4. On retrieval, news matching deactivated hashes is filtered out

---

## 7. Airport Subsystem

### 7.1 Gemini-Only (`fetchAirportConditions`)

- **Model:** `BRIEFING_AIRPORT` (Gemini 3 Pro, temp 0.1, 4096 tokens, google_search)
- **Search radius:** 50 miles from driver (hardcoded in prompt)
- **No real flight data API** — entirely AI-generated via Google Search grounding

**Output:**
```javascript
{
  airports: [{ code, name, delays, status, busyTimes }],
  busyPeriods: ["description"],
  recommendations: "driver tips string",
  fetchedAt, provider: 'gemini'
}
```

---

## 8. School Closure Subsystem

### 8.1 Gemini Search with 24h Cache (`fetchSchoolClosures`)

- **Model:** `BRIEFING_SCHOOLS` (Gemini 3 Pro, temp 0.2, 8192 tokens, thinkingLevel HIGH)
- **Search categories:** K-12 public, universities/colleges, private/religious
- **Post-processing:** Enrich with distance from driver (Haversine), filter to 15mi
- **Cache:** 24h at city level — checks existing briefings with same city/state on same calendar day

### 8.2 Region-Specific Terminology

| Country | Authority Term | School Term |
|---------|---------------|-------------|
| US | ISD / School District | Schools, school districts |
| UK | Local Education Authority | Schools, academies |
| Canada | School Board | Schools |
| Australia | Department of Education | Schools |

---

## 9. AI Adapter Layer (callModel)

**File:** `server/lib/ai/adapters/index.js`

### 9.1 Core Dispatcher Flow

```
callModel(role, params)
  │
  ├── getRoleConfig(role) from model-registry
  ├── Enrich with feature flags (useWebSearch, etc.)
  ├── Determine providers: primary + optional fallback
  ├── Build HedgedRouter request
  └── router.execute() with timeout: 0 (DISABLED)
       │
       └── Returns { success, ok, text, output, provider, latencyMs, citations }
```

### 9.2 HedgedRouter (`hedged-router.js`)

- `Promise.any()` races multiple providers simultaneously
- Circuit breaker per provider (5 failures = open for 60s)
- Concurrency gate for provider-level throttling
- Abort controllers cancel losing providers

### 9.3 Provider Adapters

| Provider | Adapter | Web Search |
|----------|---------|------------|
| `google` | `callGemini` | google_search tool |
| `openai` | `callOpenAI` / `callOpenAIWithWebSearch` | gpt-5-search-api |
| `anthropic` | `callAnthropic` / `callAnthropicWithWebSearch` | web_search_20250305 tool |
| `vertex` | `callVertexAI` | (same as google) |

### 9.4 Gemini Adapter Quirks

- Safety settings: ALL set to `BLOCK_NONE`
- JSON detection: If prompt mentions "json", temperature forced to 0.2
- `GOOGLE_API_KEY` env var temporarily deleted during init (SDK conflict workaround)
- Pro only supports LOW/HIGH thinking; Flash supports LOW/MEDIUM/HIGH

---

## 10. Model Registry

### 10.1 All Briefing Roles

| Role | Model | Temp | Tokens | Thinking | Features | Fallback? |
|------|-------|------|--------|----------|----------|-----------|
| BRIEFING_WEATHER | gemini-3-pro-preview | 0.1 | 4096 | — | google_search | NO |
| BRIEFING_TRAFFIC | gemini-3-pro-preview | 0.2 | 8192 | HIGH | google_search | NO |
| BRIEFING_NEWS | gemini-3-pro-preview | 0.4 | 8192 | HIGH | google_search | YES |
| BRIEFING_EVENTS_DISCOVERY | gemini-3-pro-preview | 0.4 | 8192 | HIGH | google_search | YES |
| BRIEFING_EVENTS_VALIDATOR | gemini-3-pro-preview | 0.3 | 4096 | — | google_search | YES |
| BRIEFING_SCHOOLS | gemini-3-pro-preview | 0.2 | 8192 | HIGH | google_search | NO |
| BRIEFING_AIRPORT | gemini-3-pro-preview | 0.1 | 4096 | — | google_search | NO |
| BRIEFING_HOLIDAY | gemini-3-pro-preview | 0.1 | 1024 | HIGH | google_search | — |
| BRIEFING_FALLBACK | gemini-3-pro-preview | 0.3 | 8192 | HIGH | google_search | — |

### 10.2 Role Resolution Priority

1. Role-specific env var (e.g., `BRIEFING_WEATHER_MODEL`)
2. Service override env var (e.g., `AGENT_OVERRIDE_MODEL`)
3. Registry default

---

## 11. REST API Endpoints

All endpoints mounted at `/api/briefing/` via `server/api/briefing/briefing.js`.
All require `requireAuth` middleware.

### 11.1 Briefing Generation & Retrieval

| Method | Path | Rate Limit | Auth | Purpose |
|--------|------|------------|------|---------|
| GET | `/current` | — | requireAuth | Latest briefing for user's last snapshot |
| POST | `/generate` | 5/min | requireAuth | Read existing briefing (misleading name) |
| POST | `/refresh` | 5/min | requireAuth | Force regeneration |
| GET | `/snapshot/:snapshotId` | — | requireAuth + ownership | Get briefing by snapshot |

### 11.2 Component-Specific Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/traffic/realtime?lat&lng&city&state` | Raw traffic analysis (BUG: missing import) |
| GET | `/traffic/:snapshotId` | Cached traffic from briefing |
| GET | `/weather/realtime?lat&lng` | Current weather (BUG: wrong params) |
| GET | `/weather/:snapshotId` | Cached weather from briefing |
| GET | `/events/:snapshotId` | Events with venue data + market events |
| GET | `/rideshare-news/:snapshotId` | News with deactivation filtering |
| GET | `/school-closures/:snapshotId` | School closures |
| GET | `/airport/:snapshotId` | Airport conditions |
| GET | `/discovered-events/:snapshotId` | Raw discovered events (limit 100) |

### 11.3 Event Management

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/filter-invalid-events` | Validate event array |
| PATCH | `/event/:eventId/deactivate` | Soft-deactivate event |
| PATCH | `/event/:eventId/reactivate` | Re-activate event |

---

## 12. Database Schema & Migrations

### 12.1 `briefings` Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, default random |
| `snapshot_id` | UUID | NOT NULL, UNIQUE, FK→snapshots (CASCADE) |
| `news` | JSONB | nullable |
| `weather_current` | JSONB | nullable |
| `weather_forecast` | JSONB | nullable |
| `traffic_conditions` | JSONB | nullable |
| `events` | JSONB | nullable |
| `school_closures` | JSONB | nullable |
| `airport_conditions` | JSONB | nullable |
| `holiday` | TEXT | nullable |
| `status` | TEXT | nullable (pending/complete/error) |
| `generated_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, defaultNow |
| `updated_at` | TIMESTAMPTZ | NOT NULL, defaultNow |

**Triggers:**
- `trg_briefing_complete` (AFTER UPDATE): Fires `pg_notify('briefing_ready')` when `traffic_conditions` goes from NULL to NOT NULL
- `trg_briefing_complete_insert` (AFTER INSERT): Fires when inserted with `traffic_conditions` NOT NULL

### 12.2 `discovered_events` Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `title` | TEXT | NOT NULL |
| `venue_name` | TEXT | nullable |
| `address` | TEXT | nullable |
| `city` | TEXT | NOT NULL |
| `state` | TEXT | NOT NULL |
| `zip` | TEXT | nullable |
| `lat` | DOUBLE PRECISION | nullable |
| `lng` | DOUBLE PRECISION | nullable |
| `venue_id` | UUID | FK→venue_catalog (SET NULL) |
| `event_start_date` | TEXT | NOT NULL (YYYY-MM-DD) |
| `event_start_time` | TEXT | nullable |
| `event_end_date` | TEXT | nullable |
| `event_end_time` | TEXT | NOT NULL |
| `category` | TEXT | NOT NULL, default 'other' |
| `expected_attendance` | TEXT | default 'medium' |
| `event_hash` | TEXT | NOT NULL, UNIQUE |
| `is_verified` | BOOLEAN | default false |
| `is_active` | BOOLEAN | default true |
| `deactivation_reason` | TEXT | nullable |
| `deactivated_at` | TIMESTAMPTZ | nullable |
| `deactivated_by` | TEXT | nullable |
| `discovered_at` | TIMESTAMPTZ | NOT NULL |
| `updated_at` | TIMESTAMPTZ | NOT NULL |

**Indexes:** city+state, event_start_date, category, event_hash (unique), discovered_at (desc), venue_id (partial), event_end_date, event_end_time

### 12.3 `news_deactivations` Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `user_id` | UUID | NOT NULL, FK→users |
| `news_hash` | TEXT | NOT NULL |
| `news_title` | TEXT | NOT NULL |
| `news_source` | TEXT | nullable |
| `reason` | TEXT | NOT NULL |
| `deactivated_by` | TEXT | default 'user' |
| `scope` | TEXT | default 'user' |
| `created_at` | TIMESTAMPTZ | NOT NULL |

**Indexes:** user_id, news_hash, unique(user_id, news_hash)

### 12.4 Migration History

| Migration | Date | Change |
|-----------|------|--------|
| `20251209_drop_unused_briefing_columns.sql` | 2025-12-09 | Drop 14 legacy columns |
| `20251214_discovered_events.sql` | 2025-12-14 | Create discovered_events table |
| `20251214_add_event_end_time.sql` | 2025-12-14 | Add event_end_time column |
| `20260109_briefing_ready_notify.sql` | 2026-01-09 | pg_notify trigger |
| `20260110_rename_event_columns.sql` | 2026-01-10 | Rename event_date→event_start_date etc. |
| `20260110_drop_discovered_events_unused_cols.sql` | 2026-01-10 | Drop zip, lat, lng, source_url |
| `20260110_cleanup_invalid_events.sql` | 2026-01-10 | Clean invalid events |
| `20260205_add_event_cleanup_indices.sql` | 2026-02-05 | Add end_date/end_time indexes |
| `20260205_enforce_event_end_time.sql` | 2026-02-05 | NOT NULL on event_end_time |

---

## 13. SSE Notifications (briefing_ready)

### 13.1 End-to-End Flow

```
briefing-service.js stores data → briefings table UPDATE
        │
        ▼
PostgreSQL trigger fires → pg_notify('briefing_ready', JSON)
        │
        ├── Also manually sent by briefing-service.js (duplicate)
        ├── Also sent by coach-dal.js (4 places)
        │
        ▼
db-client.js notification handler → subscribeToChannel()
        │
        ▼
strategy-events.js SSE endpoint → /events/briefing
        │
        ▼
Client EventSource (singleton) → subscribeBriefingReady()
        │
        ▼
useBriefingQueries.ts → refetchAllBriefingQueries() → invalidate all 6 query keys
```

### 13.2 Notification Payload

```json
{
  "snapshot_id": "uuid",
  "has_traffic": true,
  "has_events": true,
  "has_weather": true
}
```

### 13.3 Client SSE Management

- Singleton EventSource per endpoint (sseConnections Map)
- Cleanup registers BEFORE subscription (prevents orphaned subscribers)
- Double-cleanup guard (`cleanedUp` flag)
- Connection tracking counters per endpoint type

---

## 14. Client Integration

### 14.1 Component Hierarchy

```
CoPilotContext (single source of truth)
  → useBriefingQueries() hook (6 parallel React Query queries)
    → BriefingPage.tsx (wrapper with memoized props)
      → BriefingTab.tsx (renders cards)
        → WeatherCard, TrafficCard, NewsCard, EventsComponent,
          AirportCard, SchoolClosuresCard, StrategyCard
```

### 14.2 Query Strategy

- **Poll-until-ready:** Traffic, news, airport poll every 2s if still loading (placeholder detection)
- **Max retries:** 40 attempts (80 seconds)
- **SSE integration:** `briefing_ready` triggers immediate refetch of all 6 queries
- **staleTime:** 30 seconds
- **refetchOnMount/Focus/Reconnect:** All disabled

### 14.3 Error Handling

- **401:** Dispatches `vecto-auth-error` for forced logout
- **404 + `snapshot_not_found`:** Dispatches `snapshot-ownership-error` → GPS refresh
- **Cooling off:** 60s cooldown after ownership error
- **Early exit:** New snapshot exits cooling off immediately

---

## 15. Caching & Freshness Strategy

| Data Type | Cache Duration | Refresh Trigger | Strategy |
|-----------|---------------|-----------------|----------|
| Traffic | NEVER cached | Every request | TomTom + AI, always fresh |
| Weather | NEVER cached | Every request | Google Weather API |
| News | NEVER cached | Every request | Gemini search |
| Airport | NEVER cached | Every request | Gemini search |
| Events | 4 hours | Per-snapshot or stale check | Stored in discovered_events table |
| School Closures | 24 hours | Per city, same calendar day | Cross-snapshot cache via DB |
| Full Briefing | 60 seconds | Concurrent request dedup | In-process Map + DB check |

---

## 16. Error Handling Patterns

### Pattern 1: Try/Catch with Graceful Degradation

Most subsystem fetches catch errors and return empty/null data. The briefing generates with whatever succeeded — partial data is better than no data.

| Function | Failure Return |
|----------|---------------|
| `fetchWeatherConditions` | `{ current: null, forecast: [], error }` |
| `fetchTrafficConditions` | Falls through to Gemini, then hardcoded fallback |
| `fetchEventsForBriefing` | `{ items: [], reason: 'error message' }` |
| `fetchRideshareNews` | `{ items: [], reason, provider }` |
| `fetchSchoolClosures` | `[]` |
| `fetchAirportConditions` | `{ airports: [], busyPeriods: [], isFallback: true }` |

### Pattern 2: Fallback Chains

- **Events:** Gemini → Claude → empty
- **Traffic:** TomTom+AI → Gemini Search → hardcoded fallback
- **News:** Gemini → empty (no Claude fallback in main pipeline)

### Pattern 3: Silent Failures

- `analyzeTrafficWithAI` returns `null` on failure; caller uses raw TomTom summary
- `deactivatePastEvents` returns 0 on error
- `dumpLastBriefingRow` failure caught and ignored
- `pg_notify` failure caught and ignored

---

## 17. Filter for Planner

**File:** `server/lib/briefing/filter-for-planner.js` (321 lines)

Reduces briefing data for the Strategy AI / Venue Planner to minimize token usage:

| Data | Filter Logic |
|------|-------------|
| Events | Large events (stadiums/arenas) → keep from entire state; small events → user's city only; today only |
| Traffic | Briefing text + top 3 issues + top 2 avoid areas |
| Weather | Essential fields only |
| School Closures | Today's closures only |
| Airport | Passed through unchanged |

**Large event indicators:** stadium, arena, coliseum, amphitheater, convention center, fairgrounds, speedway, raceway, ballpark, field, dome, pavilion, center, park, gardens

---

## 18. Test Coverage

### What IS Tested

| File | Coverage |
|------|----------|
| `BriefingEventsFetch.test.tsx` | Integration: events fetch + display + missing end times |
| `BriefingPageEvents.test.tsx` | Unit: BriefingPage → BriefingTab props, loading states |
| `snapshot-ownership-event.test.ts` | Code verification: event listeners exist |

### What is NOT Tested

- All 16 API endpoints (server-side)
- Rate limiting behavior
- News deactivation hash filtering
- Market events multi-city expansion
- Event deactivation/reactivation
- SSE notification chain end-to-end
- Timezone-based date calculations
- `parseEventTime` / `isEventActiveNow`
- `normalizeNewsTitle` / `generateNewsHash`
- All error paths (500s, missing timezone, missing data)
- Weather/traffic realtime endpoints
- `deduplicateEvents` algorithm
- `filterBriefingForPlanner` logic

---

## 19. File Inventory

### Core Service Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/lib/briefing/briefing-service.js` | ~2,637 | Main orchestrator |
| `server/lib/briefing/cleanup-events.js` | 58 | Past event deactivation |
| `server/lib/briefing/filter-for-planner.js` | 321 | Token reduction for strategy AI |
| `server/lib/briefing/index.js` | 19 | Barrel exports (HAS BUGS) |
| `server/lib/briefing/dump-last-briefing.js` | ~180 | Debug: dump briefing to file |
| `server/lib/briefing/dump-latest.js` | ~50 | CLI: dump latest briefing |
| `server/lib/briefing/dump-traffic-format.js` | ~50 | CLI: validate traffic format |
| `server/lib/briefing/test-api.js` | ~50 | API test helpers |

### Event Pipeline Files

| File | Purpose |
|------|---------|
| `server/lib/events/pipeline/normalizeEvent.js` | Field normalization |
| `server/lib/events/pipeline/validateEvent.js` | Hard validation (TBD/Unknown filter) |
| `server/lib/events/pipeline/hashEvent.js` | MD5 hash generation |
| `server/lib/events/pipeline/geocodeEvent.js` | Google Maps geocoding |

### Supporting Files

| File | Purpose |
|------|---------|
| `server/lib/traffic/tomtom.js` | TomTom API integration |
| `server/lib/venue/venue-cache.js` | Venue upsert + geocoding |
| `server/lib/ai/adapters/index.js` | callModel dispatcher |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini provider |
| `server/lib/ai/adapters/openai-adapter.js` | OpenAI provider |
| `server/lib/ai/adapters/anthropic-adapter.js` | Anthropic provider |
| `server/lib/ai/model-registry.js` | Role → model configuration |
| `server/lib/ai/hedged-router.js` | Multi-provider racing |

### API & Client Files

| File | Purpose |
|------|---------|
| `server/api/briefing/briefing.js` | All 16 REST endpoints |
| `server/api/strategy/strategy-events.js` | SSE endpoint |
| `server/db/db-client.js` | PostgreSQL notification dispatcher |
| `client/src/hooks/useBriefingQueries.ts` | React Query hook |
| `client/src/components/BriefingTab.tsx` | Main UI component |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Page wrapper |
| `client/src/utils/co-pilot-helpers.ts` | SSE subscription helpers |

### Documentation

| File | Purpose |
|------|---------|
| `server/lib/briefing/README.md` | Module documentation |
| `docs/architecture/briefing-system.md` | Architecture overview |
| `docs/architecture/Briefing.md` | Additional architecture doc |
