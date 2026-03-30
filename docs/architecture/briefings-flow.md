# Briefings Flow — Exhaustive Architecture Reference

**Created:** 2026-03-18
**Status:** Authoritative
**Audience:** Developers, AI assistants, auditors

---

## 1. Overview

The **briefing** is a real-time intelligence package assembled for each driver snapshot. It aggregates 6 data domains — weather, traffic, events, school closures, airport conditions, and rideshare news — into a single `briefings` row keyed to a `snapshot_id`. Every briefing is generated once per snapshot, stored in the database, and served to the client via FETCH-ONCE API endpoints with SSE push notifications.

### Core Principles

1. **Per-snapshot generation.** One briefing per snapshot. No background workers (Rule 11). Events sync during the briefing pipeline, not on a schedule.
2. **Timezone-first.** All date calculations use the snapshot's IANA timezone. No UTC fallbacks. This was a hard-won lesson after a production bug where `toISOString()` caused 0 events at 8:20 PM CST (because UTC was already the next day).
3. **Graceful degradation.** Each data domain fetches independently via `Promise.all`. A Gemini outage kills airport data but weather (Google API) and traffic (TomTom) still work.
4. **FETCH-ONCE pattern.** Client endpoints read from the DB cache. They do not re-fetch from external APIs. Only `POST /refresh` triggers a full regeneration.
5. **Fire-and-forget trigger.** Briefing generation is kicked off asynchronously (non-blocking) when a snapshot is created. The HTTP response returns the snapshot_id immediately. SSE notifies the client when the briefing is ready.

---

## 2. Architecture Diagram

```
┌─────────────────┐     ┌────────────────────────┐     ┌─────────────────────┐
│  Client (React)  │────▶│  Briefing Routes        │────▶│  Briefing Service    │
│  useBriefing     │◀────│  server/api/briefing/    │◀────│  (2636 lines)        │
│  Queries.ts      │     │  briefing.js             │     │  briefing-service.js │
└─────────────────┘     └────────────────────────┘     └──────────┬──────────┘
       ▲                                                           │
       │ SSE: briefing_ready                       Promise.all (parallel)
       │                               ┌──────────┬──────────┬────┴────┬──────────┐
       │                               ▼          ▼          ▼         ▼          ▼
       │                          ┌─────────┐┌────────┐┌─────────┐┌────────┐┌────────┐
       │                          │ Weather  ││Traffic ││ Events  ││Airport ││  News  │
       │                          │ Google   ││TomTom+ ││ Gemini  ││ Gemini ││ Gemini │
       │                          │ Weather  ││Gemini  ││ 3 Pro   ││ Search ││ Search │
       │                          │ API      ││ AI     ││ Preview ││        ││        │
       │                          └─────────┘└────────┘└─────────┘└────────┘└────────┘
       │                                                    │
       │                                         ┌──────────┴──────────┐
       │                                         │ School Closures     │
       │                                         │ (Gemini, 24h cache) │
       │                                         └─────────────────────┘
       │
  pg_notify('briefing_ready') ──▶ SSE endpoint ──▶ refetchQueries()
```

---

## 3. Database Schema

### 3.1 `briefings` Table (`shared/schema.js:108-128`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID, PK | Auto-generated primary key |
| `snapshot_id` | UUID, FK UNIQUE | 1:1 link to `snapshots` (CASCADE DELETE) |
| `news` | JSONB | `{items: [...], reason?: string}` |
| `weather_current` | JSONB | `{tempF, conditions, humidity, windDirection, isDaytime}` |
| `weather_forecast` | JSONB | Hourly forecast array (next 3-6 hours) |
| `traffic_conditions` | JSONB | `{briefing, keyIssues[], avoidAreas[], incidents[], stats, congestionLevel, driverImpact}` |
| `events` | JSONB | Array of events OR `{items: [], reason: string}` |
| `school_closures` | JSONB | Array of closures OR `{items: [], reason: string}` |
| `airport_conditions` | JSONB | `{airports[], busyPeriods[], recommendations}` |
| `holiday` | TEXT | Holiday name from snapshot |
| `status` | TEXT | `pending` / `complete` / `error` |
| `generated_at` | TIMESTAMP w/tz | When generation started |
| `created_at` | TIMESTAMP w/tz | Row creation |
| `updated_at` | TIMESTAMP w/tz | Last update |

### 3.2 `discovered_events` Table (`shared/schema.js:577-610`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID, PK | Auto-generated |
| `title` | TEXT, NOT NULL | Event name |
| `venue_name` | TEXT | Venue name |
| `address` | TEXT | Street address |
| `city` | TEXT, NOT NULL | City |
| `state` | TEXT, NOT NULL | State |
| `lat`, `lng` | DOUBLE PRECISION | Coordinates |
| `venue_id` | UUID, FK→venue_catalog | Linked venue |
| `event_start_date` | TEXT | YYYY-MM-DD |
| `event_start_time` | TEXT | e.g., "7:00 PM" |
| `event_end_date` | TEXT | YYYY-MM-DD |
| `event_end_time` | TEXT | e.g., "10:00 PM" |
| `category` | TEXT | concert, sports, theater, festival, nightlife, etc. |
| `expected_attendance` | TEXT | high, medium, low |
| `event_hash` | TEXT, UNIQUE | Deduplication key |
| `is_active` | BOOLEAN (default: true) | Soft-delete flag |
| `deactivated_at` | TIMESTAMP | When deactivated |
| `deactivation_reason` | TEXT | Why deactivated |
| `deactivated_by` | TEXT | user_id or 'ai_coach' |

### 3.3 `news_deactivations` Table (`shared/schema.js:1895-1920`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID, PK | Auto-generated |
| `user_id` | UUID, FK→users, NOT NULL | Who hid this news |
| `news_hash` | TEXT | MD5(normalized(title + source + date)) |
| `news_title` | TEXT | For display |
| `reason` | TEXT | Free-form |
| `scope` | TEXT | 'user' or 'snapshot' |

Unique constraint: `(user_id, news_hash)`

---

## 4. Briefing Generation Pipeline

### 4.1 Entry Point

`generateAndStoreBriefing({ snapshotId, snapshot })` — `briefing-service.js:2269`

Called fire-and-forget when a snapshot is created (from `location.js` resolve endpoint or `snapshot.js` create endpoint).

### 4.2 Deduplication (Before Generation)

```
1. In-flight Map check (inFlightBriefings)
   └─ If same snapshotId already generating → wait for existing Promise

2. DB freshness check
   └─ If ALL fields populated AND < 60 seconds old → skip (return cached)

3. Insert placeholder row (NULL fields) → signals "generation in progress"
```

### 4.3 Core Pipeline (`generateBriefingInternal` — line 2345)

```
STEP 0: VALIDATE
  └─ Require snapshot.city, snapshot.state, snapshot.timezone
     └─ NO FALLBACKS — fail explicitly if missing

STEP 1: SCHOOL CLOSURES CACHE CHECK
  └─ SELECT briefings JOIN snapshots
     WHERE city = snapshot.city AND state = snapshot.state
     AND school_closures IS NOT NULL
     AND same calendar day (in snapshot.timezone)
  └─ Cache HIT → reuse closures, skip fetch
  └─ Cache MISS → will fetch in Step 4

STEP 2: PARALLEL DATA FETCH (Promise.all)
  ├─ fetchWeatherConditions({ snapshot })      → Google Weather API
  ├─ fetchTrafficConditions({ snapshot })      → TomTom + Gemini AI
  ├─ fetchEventsForBriefing({ snapshot })      → Gemini discovery + DB
  ├─ fetchAirportConditions({ snapshot })      → Gemini web search
  └─ fetchRideshareNews({ snapshot })          → Gemini web search

STEP 3: SCHOOL CLOSURES (if cache miss)
  └─ fetchSchoolClosures({ snapshot })         → Gemini web search

STEP 4: ASSEMBLY + STORAGE
  ├─ Build briefingData object with all components
  ├─ INSERT or UPDATE briefings WHERE snapshot_id
  ├─ pg_notify('briefing_ready', { snapshot_id })  → SSE push
  └─ dumpLastBriefingRow() for debugging
```

---

## 5. Data Domain Deep Dives

### 5.1 Events — Per-Snapshot Sync (Rule 11)

`fetchEventsForBriefing({ snapshot })` — line 1156

**No background workers.** Events sync within the briefing pipeline to ensure timezone consistency with the driver's current context.

```
1. DEACTIVATE past events
   └─ deactivatePastEvents(timezone) — cleanup-events.js
   └─ UPDATE discovered_events SET is_active=false
      WHERE event_end < now (in driver's timezone)

2. DISCOVER new events
   └─ fetchEventsWithGemini3ProPreview({ snapshot })
   └─ 2 parallel category searches (90s timeout each):
       ├─ high_impact: stadiums, arenas, convention centers
       └─ local_entertainment: bars, comedy clubs, nightlife
   └─ Consolidated from 5→2 categories (60% cost reduction)

3. ETL PIPELINE (per event):
   ├─ normalizeEvent(event)        — field standardization
   ├─ validateEventsHard(events)   — remove TBD/Unknown (hard filter)
   └─ generateEventHash(event)     — for dedup on insert

4. GEOCODE + VENUE LINK (per event):
   ├─ geocodeEventAddress()        — Google Maps geocoding
   └─ findOrCreateVenue()          — link to venue_catalog

5. STORE in discovered_events
   └─ INSERT ... ON CONFLICT(event_hash) DO UPDATE
      (currently only updates venue_id + updated_at)

6. QUERY for response
   └─ SELECT discovered_events LEFT JOIN venue_catalog
      WHERE city, state, date range, is_active=true
```

### 5.2 Traffic — TomTom + Gemini AI Analysis

`fetchTrafficConditions({ snapshot })` — line 1711

```
PRIMARY PATH (TomTom available):
  1. fetchRawTraffic(lat, lng, 10 miles)    — raw flow telemetry
  2. getTomTomTraffic(lat, lon, ...)         — aggregated incidents
  3. analyzeTrafficWithAI({                  — AI analysis
       tomtomData, rawTraffic, city, state,
       formattedAddress, driverLat, driverLon
     })
     └─ callModel('BRIEFING_TRAFFIC')
     └─ Returns: { briefing, keyIssues[], avoidAreas[],
                   driverImpact, closuresSummary, constructionSummary }

FALLBACK PATH (no TomTom key):
  └─ callModel('BRIEFING_TRAFFIC') with google_search
```

### 5.3 Weather — Google Weather API

`fetchWeatherConditions({ snapshot })` — line 1456

```
Google Weather API (2 calls):
  1. weather.googleapis.com/v1/currentConditions:lookup
  2. weather.googleapis.com/v1/forecast/hours:lookup

Post-processing:
  └─ generateWeatherDriverImpact(current, forecast)
     └─ Deterministic 1-2 sentence summary
     └─ Detects: severe weather, snow, rain, fog, extreme temp
```

### 5.4 School Closures — 24-Hour Cached

`fetchSchoolClosures({ snapshot })` — line 1613

```
callModel('BRIEFING_SCHOOLS') with google_search
  └─ Returns: [{schoolName, type, closureStart, reopeningDate,
                reason, impact, lat, lng}]
  └─ Post-filter: haversineDistanceMiles ≤ 15 miles

CACHING: 24-hour, city-level cross-snapshot
  └─ Same city + same calendar day = cache hit
```

### 5.5 Airport Conditions

`fetchAirportConditions({ snapshot })` — line 1925

```
callModel('BRIEFING_AIRPORT') with google_search
  └─ Returns: { airports[], busyPeriods[], recommendations }
  └─ Per airport: code, name, status, delays, busy times, tips
```

### 5.6 Rideshare News

`fetchRideshareNews({ snapshot })` — line 2075

```
callModel('BRIEFING_NEWS') with google_search
  └─ Market-wide search (not just city)
  └─ Returns: { items[], reason? }
  └─ Each item: { title, summary, published_date, impact, category }

Post-processing:
  └─ consolidateNewsItems(items, todayDate)
      ├─ Deduplicate (60% title similarity threshold)
      ├─ Filter recent (last 2 days)
      ├─ Sort by impact (high > medium > low)
      └─ Limit to 8 items
```

---

## 6. AI Model Configuration

All AI calls go through the unified `callModel()` adapter (Rule 10).

| Role | Model | Tools | Purpose |
|------|-------|-------|---------|
| `BRIEFING_EVENTS_DISCOVERY` | Gemini 3 Pro Preview | google_search | Event discovery |
| `BRIEFING_TRAFFIC` | Gemini Pro (HIGH thinking) | — | Traffic analysis (TomTom data) |
| `BRIEFING_WEATHER` | Gemini Pro | google_search | Weather generation |
| `BRIEFING_SCHOOLS` | Gemini Pro | google_search | School closure search |
| `BRIEFING_AIRPORT` | Gemini Pro | google_search | Airport condition search |
| `BRIEFING_NEWS` | Gemini Pro | google_search | Rideshare news search |
| `BRIEFING_FALLBACK` | Claude | web_search | Fallback when Gemini fails |

---

## 7. Caching Strategy

| Data Domain | Cache Strategy | TTL | Refresh Trigger |
|-------------|---------------|-----|-----------------|
| School Closures | DB cross-snapshot (same city) | 24 hours (calendar day) | New calendar day |
| Events | `discovered_events` table | 4 hours (`isEventsStale()`) | Stale check on read |
| Weather | No cache | 0 | Every snapshot |
| Traffic | No cache | 0 | Every snapshot |
| News | No cache | 0 | Every snapshot |
| Airport | No cache | 0 | Every snapshot |
| In-flight dedup | `inFlightBriefings` Map | 60 seconds | Concurrent request |

---

## 8. API Endpoints (16 total)

### 8.1 Snapshot-Keyed Endpoints (FETCH-ONCE Pattern)

These read from the `briefings` table. They do NOT re-fetch from external APIs.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/briefing/weather/:snapshotId` | Auth + Ownership | Weather (cached, or fresh if missing) |
| GET | `/api/briefing/traffic/:snapshotId` | Auth + Ownership | Traffic from cache (202 if not ready) |
| GET | `/api/briefing/rideshare-news/:snapshotId` | Auth + Ownership | News with user deactivation filtering |
| GET | `/api/briefing/events/:snapshotId` | Auth + Ownership | Events from `discovered_events` + market events |
| GET | `/api/briefing/school-closures/:snapshotId` | Auth + Ownership | School closures from cache |
| GET | `/api/briefing/airport/:snapshotId` | Auth + Ownership | Airport conditions from cache |
| GET | `/api/briefing/discovered-events/:snapshotId` | Auth + Ownership | Raw discovered events |

### 8.2 Other Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/briefing/current` | Auth | Latest briefing for auth'd user |
| POST | `/api/briefing/generate` | Auth + Rate Limit | Retrieve briefing (misleading name — reads, doesn't generate) |
| GET | `/api/briefing/snapshot/:snapshotId` | Auth + Ownership | Full briefing by snapshot |
| POST | `/api/briefing/refresh` | Auth + Rate Limit | Force full regeneration |
| GET | `/api/briefing/traffic/realtime` | Auth | Live traffic by lat/lng (no snapshot) |
| GET | `/api/briefing/weather/realtime` | Auth | Live weather by lat/lng (no snapshot) |
| POST | `/api/briefing/filter-invalid-events` | Auth | Remove TBD/Unknown events (utility) |
| PATCH | `/api/briefing/event/:eventId/deactivate` | Auth | Hide event (AI Coach) |
| PATCH | `/api/briefing/event/:eventId/reactivate` | Auth | Restore hidden event |

### 8.3 Client Polling Behavior

| Query | Polling | Max Attempts | Stop Condition |
|-------|---------|-------------|----------------|
| Weather | None | 1 | Data available |
| Traffic | 2s interval | 40 (80s) | `summary !== "Loading traffic..."` |
| News | 2s interval | 40 (80s) | `items.length > 0 OR reason present` |
| Events | None | 1 | Data available |
| School Closures | None | 1 | Data available |
| Airport | 2s interval | 40 (80s) | `isFallback !== true` |

---

## 9. SSE Notification Flow

```
briefing-service.js: generateBriefingInternal()
  │
  ├─ After all data stored:
  │   pg_notify('briefing_ready', JSON.stringify({ snapshot_id }))
  │
  ▼
PostgreSQL LISTEN 'briefing_ready'
  │ (via db-client.js subscribeToChannel)
  │
  ▼
strategy-events.js: GET /api/events/briefing (SSE endpoint)
  │ 30-second heartbeat keepalive
  │
  ▼
co-pilot-helpers.ts: subscribeBriefingReady(callback)
  │ Singleton EventSource connection
  │
  ▼
useBriefingQueries.ts: SSE listener
  │ if (readySnapshotId === snapshotId)
  │   → refetchQueries for all 6 briefing query keys
  │
  ▼
UI updates immediately (no polling delay)
```

---

## 10. Client Integration

### 10.1 Data Flow

```
CoPilotProvider (co-pilot-context.tsx)
  │ Single useBriefingQueries() call at context level
  │ Pre-loads all briefing data when snapshot available
  │
  ├─▶ briefingData exposed via context
  │     { weather, traffic, news, events, schoolClosures, airport, isLoading }
  │
  ▼
BriefingPage (wrapper)
  │ Gets briefingData from useCoPilot()
  │ Checks areCriticalBriefingsLoading (traffic + news + airport)
  │
  ▼
BriefingTab (main renderer)
  │ Renders 6+ card components:
  │
  ├─ StrategyCard    — gated on areCriticalBriefingsLoading
  ├─ WeatherCard     — 6-hour forecast
  ├─ TrafficCard     — congestion, incidents, driver impact
  ├─ AirportCard     — delays, busy times, recommendations
  ├─ NewsCard        — rideshare news with impact badges
  ├─ EventsComponent — today/upcoming, grouped by category
  └─ SchoolClosuresCard
```

### 10.2 React Query Configuration

- **Hook:** `useBriefingQueries({ snapshotId, pipelinePhase })`
- **Enable:** `!!snapshotId && !shouldDisableQueries()` (disabled during cooling-off)
- **Base staleTime:** 30 seconds
- **No refetch on mount/focus/reconnect**
- **6 parallel queries** (weather, traffic, news, events, school closures, airport)
- **SSE subscription** for immediate cache invalidation on `briefing_ready`

### 10.3 Snapshot Ownership Error Recovery

```
Briefing query returns 404 (snapshot_not_found)
  ↓
dispatchSnapshotOwnershipError()
  ├─ Enter cooling-off state (disables ALL queries for 60s)
  └─ Dispatch 'snapshot-ownership-error' event
  ↓
LocationContext: handleOwnershipError
  ├─ Clear lastSnapshotId
  └─ refreshGPS(true) → create new snapshot
  ↓
New snapshot created → 'vecto-snapshot-saved' dispatched
  ↓
exitCoolingOffForNewSnapshot(newSnapshotId)
  └─ Immediately resume all queries with new snapshotId
```

### 10.4 Additional Consumer: Active Events Query

- `useActiveEventsQuery(snapshotId)` — `useBriefingQueries.ts`
- Endpoint: `GET /api/briefing/events/:snapshotId?filter=active`
- Polls every 60 seconds for real-time accuracy
- Used by MapPage to display currently-happening events on the map

---

## 11. Filter-for-Planner Token Optimization

`filterBriefingForPlanner(briefing, snapshot)` — `filter-for-planner.js:181`

Called before the tactical planner AI to reduce token usage:

| Data | Filter Logic | Token Savings |
|------|-------------|---------------|
| Events | Today only + market-wide large events (stadiums/arenas) | ~60% reduction |
| Traffic | Summary + top 3 keyIssues + top 2 avoidAreas (not full incidents) | ~70% reduction |
| Weather | Current conditions only (no full forecast) | ~50% reduction |
| School Closures | Active-today only | Variable |

`formatBriefingForPrompt(filteredBriefing)` converts to a concise multiline string for LLM prompt inclusion.

---

## 12. Error Handling — Five-Level Strategy

| Level | Pattern | Example |
|-------|---------|---------|
| 1. Graceful degradation | Individual domain failures don't kill the briefing | Airport fetch fails → weather/traffic still work |
| 2. Timeout wrapping | `withTimeout()` at 90s for event searches | Prevents zombie operations |
| 3. JSON parse resilience | `safeJsonParse()` — 5-stage fallback | Direct → fix common issues → extract substring → balanced brace |
| 4. Fallback chain | Gemini fails → Claude web_search → empty with reason | `BRIEFING_FALLBACK` role |
| 5. Fail-fast | Missing snapshot data (city/state/timezone) | Throws immediately |

---

## 13. Supporting Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/lib/briefing/briefing-service.js` | 2636 | Core: all fetch, process, store logic (32 functions) |
| `server/api/briefing/briefing.js` | 1090 | Express routes: 16 API endpoints |
| `server/lib/briefing/cleanup-events.js` | ~60 | `deactivatePastEvents()` — soft-deactivate ended events |
| `server/lib/briefing/filter-for-planner.js` | ~311 | Token optimization for strategy planner |
| `server/lib/briefing/dump-last-briefing.js` | ~187 | Debug: dump latest briefing to `sent-to-strategist.txt` |
| `server/lib/briefing/index.js` | ~12 | Barrel exports (HAS ISSUES — see Section 14) |
| `client/src/hooks/useBriefingQueries.ts` | ~636 | 6 React Query hooks + SSE + error handling |
| `client/src/components/BriefingTab.tsx` | — | Main renderer with 6+ card components |
| `client/src/pages/co-pilot/BriefingPage.tsx` | — | Wrapper page |

---

## 14. Verified Open Issues (from Prior Session Audit)

These issues were identified in a prior Claude Code session and independently verified on 2026-03-18. **All remain unfixed.**

### CRITICAL (5)

| ID | Issue | File | Line | Impact |
|----|-------|------|------|--------|
| C-1 | **Barrel exports mismatch.** `index.js` exports `fetchTrafficBriefing`, `fetchEventsBriefing`, `fetchNewsBriefing` — these functions don't exist. Actual names: `fetchTrafficConditions`, `fetchEventsForBriefing`, `fetchRideshareNews`. | `server/lib/briefing/index.js` | 8-10 | Any code importing from barrel gets `undefined` |
| C-2 | **Missing import in /traffic/realtime.** Route calls `fetchTrafficConditions()` but the import statement doesn't include it. | `server/api/briefing/briefing.js` | 3 (import), 407 (use) | `ReferenceError` at runtime |
| C-3 | **Wrong parameter shape in /weather/realtime.** Calls `fetchWeatherConditions({ lat, lng })` but function expects `{ snapshot }` with `snapshot.lat`, `snapshot.lng`, `snapshot.country`. | `server/api/briefing/briefing.js` | 429-431 | Accesses undefined properties |
| C-4 | **normalizeEvent() called without city/state context.** Called as `normalizeEvent(e)` but should be `normalizeEvent(e, { city, state })`. Events get empty city/state if AI response omits them. | `server/lib/briefing/briefing-service.js` | 1194 | Events stored without city/state |
| C-5 | **Event date range uses UTC instead of user timezone.** `new Date().toISOString().split('T')[0]` calculates "today" in UTC. Should use `toLocaleDateString('en-CA', { timeZone: snapshot.timezone })`. | `server/lib/briefing/briefing-service.js` | 1175-1179 | 7-day event window off by 1 day for non-UTC users |

### HIGH (4)

| ID | Issue | File | Line | Impact |
|----|-------|------|------|--------|
| H-1 | **No ownership check on event deactivation/reactivation.** Only `requireAuth` — any authenticated user can deactivate ANY event in the system. | `server/api/briefing/briefing.js` | 933, 1001 | Cross-user event manipulation |
| H-2 | **AI timeout disabled globally.** `timeout: 0` in hedged router adapter. Only event searches have separate 90s `withTimeout`. Weather, traffic, news, airport, school closures have NO timeout. | `server/lib/ai/adapters/index.js` | 155 | AI calls can hang indefinitely, blocking pipeline |
| H-3 | **No fallback for 4 briefing AI roles.** `FALLBACK_ENABLED_ROLES` in model-registry.js does NOT include `BRIEFING_WEATHER`, `BRIEFING_TRAFFIC`, `BRIEFING_SCHOOLS`, `BRIEFING_AIRPORT`. If Gemini is down, these fail silently. | `server/lib/ai/model-registry.js` | 366-375 | 4 data domains go empty on Gemini outage |
| H-6 | **ON CONFLICT only updates venue_id + updated_at.** When a re-discovered event matches an existing `event_hash`, corrected data (times, title, address, attendance) is silently dropped. | `server/lib/briefing/briefing-service.js` | 1268-1275 | Stale event data persists even when AI returns corrections |

### MEDIUM (3)

| ID | Issue | File | Line | Impact |
|----|-------|------|------|--------|
| M-8 | **Stale docstring references GPT-5.2.** Comment says "News uses dual-model fetch (Gemini + GPT-5.2)" but code was consolidated to Gemini-only on 2026-01-10. | `server/lib/briefing/briefing-service.js` | 2699 | Developer confusion |
| M-9a | **Timezone fallback violation (news).** `req.snapshot.timezone \|\| 'UTC'` in the news endpoint — should require timezone, not fall back. | `server/api/briefing/briefing.js` | 576 | News filtered against wrong timezone |
| M-9b | **Location fallback violation (traffic realtime).** `city \|\| 'Unknown'`, `state \|\| ''` — passes fake city to traffic analysis. | `server/api/briefing/briefing.js` | 410-411 | Traffic tagged to fake city |
| M-9c | **Timezone fallback in filter-for-planner.** Falls back to UTC if no timezone instead of erroring. | `server/lib/briefing/filter-for-planner.js` | 49-50 | Inconsistent with no-fallback rule |

### Recommended Fix Priority

1. **Immediate (correctness):** C-1 through C-5 — these cause runtime errors or wrong data
2. **Short-term (security):** H-1 — event deactivation without ownership check
3. **Short-term (reliability):** H-2, H-3 — AI timeout + fallback coverage
4. **Medium-term (data quality):** H-6 — ON CONFLICT should update event fields
5. **Cleanup:** M-8, M-9a/b/c — docstring + fallback violations

---

## 15. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Per-snapshot event sync (no background workers) | Rule 11: Data consistency with user's timezone context |
| Timezone everywhere, NO FALLBACKS | UTC-based dates caused wrong events at night (8:20 PM CST = Jan 15 UTC) |
| Hard event filtering (not repair) | TBD/Unknown values indicate unreliable data; better to remove than guess |
| Soft deactivation (never delete) | Past events marked `is_active=false`, preserving history |
| Market-wide high-value events | Drivers in Frisco see Dallas stadium events (same metro) |
| 2-category event discovery (was 5) | 60% cost reduction with minimal quality loss |
| Venue linking via geocode | Events on map need coordinates; geocode→findOrCreateVenue pipeline |
| FETCH-ONCE API pattern | Client endpoints read cached data; only POST /refresh re-generates |
| In-flight deduplication (Map) | Prevents thundering herd when multiple components request same briefing |
| Filter-for-planner | Reduces briefing token usage ~60% before passing to strategy AI |
