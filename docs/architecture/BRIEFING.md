# BRIEFING.md — Briefing Pipeline Architecture

> **Canonical reference** for the briefing generation pipeline: triggers, SSE subscriptions, retry/backoff, API endpoints, and data sources.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/event-discovery.md` — Event pipeline docs (event sources covered in Section 3c)
- `docs/architecture/briefing-deep-dive-analysis.md` — Briefing analysis (absorbed)
- `docs/architecture/briefing-issues-findings.md` — Briefing issues (absorbed into Known Gaps)
- `docs/architecture/briefings-flow.md` — Briefing flow diagram (absorbed)
- `docs/architecture/briefing-system.md` — Briefing system overview (absorbed)

---

## Table of Contents

1. [What Triggers a Briefing](#1-what-triggers-a-briefing)
2. [Server-Side Generation Pipeline](#2-server-side-generation-pipeline)
3. [Data Sources](#3-data-sources)
4. [API Endpoints](#4-api-endpoints)
5. [Client-Side: SSE Subscription Flow](#5-client-side-sse-subscription-flow)
6. [Client-Side: Polling, Retry, and Backoff](#6-client-side-polling-retry-and-backoff)
7. [The briefing_ready Event](#7-the-briefing_ready-event)
8. [The Wasted API Calls Issue](#8-the-wasted-api-calls-issue)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. What Triggers a Briefing

A briefing is generated as **part of the blocks-fast waterfall** — it is NOT an independent trigger.

```
POST /api/blocks-fast { snapshotId }
  ├─ Phase 1: runBriefing(snapshotId)          ← BRIEFING GENERATED HERE
  ├─ Phase 2: runImmediateStrategy(snapshotId)  ← Strategy uses briefing data
  └─ Phase 3: generateEnhancedSmartBlocks()     ← Blocks use strategy
```

**Trigger chain:**
1. Client creates snapshot (GPS → location resolve → snapshot created)
2. Client dispatches `vecto-snapshot-saved` event
3. CoPilotContext receives event → sends `POST /api/blocks-fast { snapshotId }`
4. Server acquires PostgreSQL advisory lock (`pg_try_advisory_xact_lock`)
5. Server calls `runBriefing()` which delegates to `generateAndStoreBriefing()`
6. All 6+ data sources fetched in parallel
7. Results stored in `briefings` table
8. `pg_notify('briefing_ready', { snapshot_id })` emitted
9. Strategy generation begins (uses briefing data as input)

**File:** `server/api/strategy/blocks-fast.js` (lines 505–800+)

---

## 2. Server-Side Generation Pipeline

**Entry point:** `generateAndStoreBriefing(snapshotId, snapshot)`
**File:** `server/lib/briefing/briefing-service.js` (line 2413)

All data sources run **in parallel** via `Promise.allSettled`:

```
generateAndStoreBriefing(snapshotId)
  │
  ├─ fetchEventsForBriefing()         [Gemini 3.1 Pro + Google Search] (90s timeout × 2 categories)
  ├─ fetchTrafficConditions()          [TomTom API → Gemini fallback]
  ├─ fetchWeatherConditions()          [Google Weather API × 2 calls]
  ├─ fetchRideshareNews()              [Claude web_search → Gemini fallback]
  ├─ fetchSchoolClosures()             [Gemini 3.1 Pro + Google Search]
  ├─ fetchAirportConditions()          [Gemini 3.1 Pro + Google Search]
  └─ fetchWeatherForecast()            [Google Weather API]
  │
  ├─ INSERT/UPDATE briefings table
  └─ pg_notify('briefing_ready', { snapshot_id })
```

### Timing

Typical end-to-end: **60–90 seconds** from trigger to `briefing_ready`
- Events discovery: 20–45s (2 parallel Gemini searches with 90s timeout each)
- Traffic: 5–15s (TomTom API + AI analysis)
- Weather: 2–5s (Google Weather API, fastest)
- News: 10–30s (Claude web_search or Gemini)
- School closures: 10–20s (Gemini search)
- Airport: 10–20s (Gemini search)

Weather and events are typically available first. Traffic, news, and airport lag behind.

---

## 3. Data Sources

### 3a. Weather

**Source:** Google Weather API (NOT an LLM call)
**Endpoints:**
- Current: `https://weather.googleapis.com/v1/currentConditions:lookup`
- Forecast: `https://weather.googleapis.com/v1/forecast/hours:lookup?hours=6`

**Auth:** `GOOGLE_MAPS_API_KEY`
**File:** `briefing-service.js` (line 1537)

**Output includes:** temperature, feelsLike, conditions, humidity, windSpeed, uvIndex, isDaytime, 6-hour forecast.
**Driver impact:** Deterministic string from `generateWeatherDriverImpact()` (no LLM).

### 3b. Traffic

**Primary:** TomTom Traffic API
**Endpoints:**
- Incidents: `https://api.tomtom.com/traffic/services/5`
- Flow: `https://api.tomtom.com/traffic/services/4/flowSegmentData`

**Auth:** `TOMTOM_API_KEY` (2,500 req/day free tier)
**File:** `server/lib/traffic/tomtom.js`

**LLM Analysis:** Raw TomTom JSON → `callModel('BRIEFING_TRAFFIC', ...)` → Gemini 3.1 Pro with thinkingLevel=HIGH → driver-friendly summary.
**Fallback:** If TomTom fails → Gemini with Google Search analyzes traffic directly.

### 3c. Events

**Source:** Gemini 3.1 Pro Preview with Google Search grounding
**File:** `briefing-service.js` (line 1009)

**Strategy:** 2 parallel category searches:
- HIGH_IMPACT: concerts, sports, conventions
- LOCAL_ENTERTAINMENT: community, festivals, nightlife

**Per search:** 90s timeout, requires Google Places `place_id` for venue linking.
**Deduplication:** `deduplicateEvents()` groups by normalized name + base address + start time.
**Venue linking:** `findOrCreateVenue()` creates entries in `venue_catalog` for new locations.

### 3d. News

**Primary:** Claude with `web_search` tool (`BRIEFING_FALLBACK` role)
**Fallback:** Gemini via `BRIEFING_NEWS` role
**File:** `briefing-service.js` (line 542, 2219)

**Filters:**
- TODAY ONLY — rejects articles older than 2 days
- Driver-relevant: traffic, events, regulations, earnings, gas prices, tolls
- Deduplication via MD5 hashes of normalized title + source + date in `news_deactivations` table

### 3e. School Closures

**Source:** Gemini 3.1 Pro Preview with Google Search grounding
**File:** `briefing-service.js` (line 1706)

**Scope:** 15-mile radius, K-12 public + universities + private. Region-aware naming (ISD/LEA/School Board).
**Output:** School name, type, closure dates, reopening date, reason, impact level, distance.

### 3f. Airport Conditions

**Source:** Gemini 3.1 Pro Preview with Google Search grounding
**File:** `briefing-service.js` (line 2073)

**Scope:** Airports within 50 miles. Delays, current conditions, busy times, driver recommendations.

---

## 4. API Endpoints

All briefing endpoints are in `server/api/briefing/briefing.js` (1,241 lines).

### Per-Snapshot Data Endpoints

All require `requireAuth` + `requireSnapshotOwnership`.

| Endpoint | Method | Returns | Polling? |
|----------|--------|---------|----------|
| `/api/briefing/weather/:snapshotId` | GET | Weather data | No — usually available immediately |
| `/api/briefing/traffic/:snapshotId` | GET | Traffic data | Yes — exponential backoff |
| `/api/briefing/rideshare-news/:snapshotId` | GET | News articles | Yes — exponential backoff |
| `/api/briefing/events/:snapshotId` | GET | Events list | Yes — exponential backoff |
| `/api/briefing/school-closures/:snapshotId` | GET | School closures | No — one-shot |
| `/api/briefing/airport/:snapshotId` | GET | Airport conditions | Yes — exponential backoff |

### Other Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/briefing/current` | GET | requireAuth | Get latest user briefing |
| `/api/briefing/generate` | POST | requireAuth + expensive limiter | Trigger briefing generation |
| `/api/briefing/snapshot/:snapshotId` | GET | requireAuth + ownership | Full briefing by snapshot |
| `/api/briefing/refresh` | POST | requireAuth + expensive limiter | Regenerate stale briefing |
| `/api/briefing/traffic/realtime` | GET | requireAuth | Real-time traffic (not snapshot-based) |
| `/api/briefing/weather/realtime` | GET | requireAuth | Real-time weather (not snapshot-based) |
| `/api/briefing/discovered-events/:snapshotId` | GET | requireAuth + ownership | Raw discovered events |
| `/api/briefing/filter-invalid-events` | POST | requireAuth | Validate/filter events |
| `/api/briefing/events/:snapshotId?filter=active` | GET | requireAuth + ownership | Currently-active events only |

### "Still Generating" Responses

When data isn't ready yet, endpoints return success (200) with placeholder content:
- Traffic: `{ traffic: { summary: "Loading traffic..." } }`
- News: `{ news: { items: [], reason: null } }` (empty items, no reason)
- Airport: `{ airport_conditions: { isFallback: true } }`
- Events: `{ events: [], reason: null }` (empty events, no reason)

The client detects these placeholders and retries (see [Section 6](#6-client-side-polling-retry-and-backoff)).

---

## 5. Client-Side: SSE Subscription Flow

### Where SSE Is Used for Briefing

**Hook:** `useBriefingQueries.ts` (lines 195–215)
**SSE Endpoint:** `GET /events/briefing` (singleton via SSE Manager)
**Event name:** `briefing_ready`

**Subscription lifecycle:**
1. Hook mounts with `snapshotId`
2. Calls `subscribeBriefingReady(callback)` → creates/shares singleton EventSource
3. Server emits `pg_notify('briefing_ready', { snapshot_id })` when generation completes
4. SSE Manager receives event, parses JSON, broadcasts to all subscribers
5. Callback checks `readySnapshotId === snapshotId` → refetches ALL 6 briefing queries
6. On unmount or snapshotId change → unsubscribe (closes connection if last subscriber)

### The Dual Strategy: SSE + Polling

The client uses **both** SSE events and polling (refetchInterval) because:
- SSE can miss events (connection drops on mobile sleep, network switch)
- Polling provides guaranteed eventual consistency
- SSE provides fast notification when it works (eliminates most polling)

When `briefing_ready` fires, the client calls `queryClient.refetchQueries()` for all 6 queries simultaneously. This replaces whatever the next polling interval would have been.

---

## 6. Client-Side: Polling, Retry, and Backoff

**File:** `client/src/hooks/useBriefingQueries.ts`

### Backoff Configuration

```
MAX_RETRY_ATTEMPTS = 12
INITIAL_RETRY_MS = 2000
MAX_RETRY_MS = 30000

Progression: 2s → 4s → 8s → 16s → 30s → 30s → 30s → ...
Total coverage: ~3 minutes (enough for typical briefing generation)
```

### Which Queries Poll

| Query | Polls? | Detection Function | Stop Conditions |
|-------|--------|--------------------|-----------------|
| Weather | No | N/A | One-shot, usually available immediately |
| Traffic | Yes | `isTrafficLoading()` — checks `summary === "Loading traffic..."` | `_exhausted`, `_ownershipError`, `_generationFailed` |
| News | Yes | `isNewsLoading()` — empty items + no reason | Same |
| Events | Yes | `isEventsLoading()` — empty events + no reason | Same |
| School Closures | No | N/A | One-shot |
| Airport | Yes | `isAirportLoading()` — `isFallback === true` | Same |

### Retry Flow for a Single Query

```
1. Initial fetch fires immediately when snapshotId is set
2. Response arrives — check if data is "loading/placeholder"
   ├─ Real data → cache forever (staleTime: 30s, no more polling)
   └─ Placeholder → increment retry count, schedule refetch:
        └─ refetchInterval: getBackoffInterval(retryCount)
        └─ Next check: is retryCount < 12?
             ├─ Yes → poll again at next backoff interval
             └─ No → set _exhausted flag, stop polling
3. On 401 → dispatchAuthError → forced logout
4. On 404 with snapshot_not_found → dispatchSnapshotOwnershipError → cooling off
```

### Cooling Off Mechanism

When a snapshot ownership error occurs (404 with `snapshot_not_found`):
1. ALL queries disabled for 60 seconds
2. `snapshot-ownership-error` event dispatched → LocationContext triggers fresh GPS
3. When new snapshot arrives → exit cooling off early if different snapshot ID
4. Module-level state reset on `vecto-auth-error` event (logout)

### Auth Guard in QueryFn

Each queryFn starts with a **synchronous** localStorage check:
```javascript
if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { data: null };
```
This catches stale `refetchInterval` closures that fire after logout but before React state propagates.

---

## 7. The briefing_ready Event

### Server Side

**Emitted from:** `briefing-service.js` (line 2794)
```javascript
await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
```

**When:** After `generateAndStoreBriefing()` completes ALL parallel data fetches and stores results in DB.
**Payload:** `{ snapshot_id: "uuid" }`

### Server SSE Relay

**File:** `server/api/strategy/strategy-events.js`
**Route:** `GET /events/briefing`

1. PostgreSQL LISTEN on `briefing_ready` channel
2. Shared dispatcher in `server/db/db-client.js` (line 265) routes to SSE subscribers
3. SSE sends: `event: briefing_ready\ndata: {"snapshot_id":"..."}\n\n`
4. 30-second heartbeat detects dead connections

### Client Side

**SSE Manager** receives the event, parses JSON, broadcasts to all subscribers.
**useBriefingQueries** callback: refetches all 6 queries via `queryClient.refetchQueries()`.

### Complete Event Timeline (From Logs)

```
22:40:28.875  [BriefingQuery] Fetching weather/traffic/news/events/closures/airport  ← Initial fetch
22:40:28.980  [BriefingQuery] ✅ Weather received                                    ← Weather ready immediately
22:40:29.048  [BriefingQuery] ✅ Events received: 9                                  ← Events ready quickly
22:40:32.949  [BriefingQuery] Fetching traffic/news/airport                          ← 4s backoff retry
22:40:40.995  [BriefingQuery] Fetching traffic/news/airport                          ← 8s backoff retry
22:40:57.042  [BriefingQuery] Fetching traffic/news/airport                          ← 16s backoff retry
22:41:27.089  [BriefingQuery] Fetching traffic/news/airport                          ← 30s backoff retry
22:41:54.873  [SSE] briefing_ready received                                          ← SERVER SAYS READY
22:41:54.874  [BriefingQuery] Refetching all 6 queries                               ← SSE-triggered refetch
22:41:55.001  [BriefingQuery] ✅ Weather received                                    ← All data now available
22:41:55.085  [BriefingQuery] ✅ Traffic received
22:41:55.156  [BriefingQuery] ✅ News received
22:41:55.217  [BriefingQuery] ✅ Events received: 9
22:41:55.268  [BriefingQuery] ✅ School closures received
22:41:55.321  [BriefingQuery] ✅ Airport received
```

**Total time:** ~87 seconds from snapshot creation to all briefing data available.
**Wasted polling calls:** 4 rounds × 3 queries = 12 unnecessary API calls before SSE arrived.

---

## 8. The Wasted API Calls Issue

### Problem

Between snapshot creation and `briefing_ready`, the client polls traffic, news, and airport endpoints with exponential backoff. Each poll hits the server, which queries the DB, finds placeholder data, and returns it.

**From the logs above:** 12 wasted round-trips (4 rounds × 3 endpoints) over 58 seconds.

### Why It Exists

The dual strategy (SSE + polling) is defensive:
- SSE can be unreliable on mobile (browser suspends tabs, network switches)
- Without polling, if SSE fails, the user would see "loading" forever
- The backoff limits the damage: 2s → 4s → 8s → 16s → 30s (not hammering)

### Impact

- Low: These are cheap DB reads, not LLM calls
- The 12 extra requests over 58 seconds is acceptable for reliability
- Max 12 attempts over ~3 minutes if SSE fails completely

### Possible Optimization

Delay first poll until a minimum generation time has passed (e.g., don't poll traffic for the first 30 seconds since it's never ready before then). But this adds complexity for marginal gain.

---

## 9. Current State

| Area | Status |
|------|--------|
| Briefing generation (parallel 6-source) | Working — 60-90s typical |
| Weather data | Working — fastest source, available in <5s |
| Traffic data (TomTom + AI) | Working — 15-30s typical |
| Events (Gemini + Google Search) | Working — 20-45s, 2 parallel categories |
| News (Claude web_search) | Working — 10-30s, today-only filter |
| School closures | Working — 10-20s, 15-mile radius |
| Airport conditions | Working — 10-20s, 50-mile radius |
| SSE briefing_ready notification | Working — single pg_notify, relayed to clients |
| Client polling with backoff | Working — 2s→4s→8s→16s→30s, max 12 attempts |
| Auth guards on polling | Working — localStorage check in queryFn, `isAuthenticated` gate |
| Ownership error handling | Working — cooling off + GPS refresh cycle |
| Exhaust detection (isUnavailable) | Working — UI can show "data unavailable" |

---

## 10. Known Gaps

1. **No partial briefing_ready** — The server emits ONE event after ALL sources complete. If weather is ready in 3 seconds but events take 45, the client doesn't know weather is ready until the whole briefing finishes. The client pre-fetches weather independently, but traffic/news/airport wait.

2. **News source reliability** — Claude with `web_search` can return stale or no results. Fallback to Gemini adds latency. No third-party news API as primary source.

3. **Event deduplication is approximate** — Normalized name + address + time. Events with slightly different names at the same venue can duplicate.

4. **TomTom free tier limit** — 2,500 requests/day. A busy day with many users could exhaust this. No monitoring or alerting on quota.

5. **School closures have no cache** — Every briefing queries schools fresh. No memoization across nearby snapshots.

6. **Airport data quality varies** — Gemini search grounding quality depends on airport. Major hubs (DFW) get good data; regional airports may get nothing useful.

7. **No briefing invalidation on data change** — If traffic conditions change dramatically 10 minutes after briefing, the stale briefing persists until next snapshot.

8. **Briefing zombie recovery is heuristic** — Detects stale briefing rows (NULL fields + age > 2 min) and triggers regeneration. Could be more robust.

---

## 11. TODO — Hardening Work

- [ ] **Add per-source SSE events** — `weather_ready`, `traffic_ready`, etc. Clients can show data as it arrives instead of waiting for everything
- [ ] **Add TomTom quota monitoring** — Alert when approaching daily limit, fallback to Gemini-only at threshold
- [ ] **Cache school closures** — Schools within 15 miles of a coord_key don't change hour-to-hour; cache for 24 hours
- [ ] **Add dedicated news API** — NewsAPI.org or similar as primary source, LLM for analysis only (not discovery)
- [ ] **Improve event deduplication** — Use venue `place_id` as primary dedup key instead of string matching
- [ ] **Add briefing freshness indicator** — Show age of briefing data in UI, allow manual refresh of specific sections
- [ ] **SSE reconnection with exponential backoff** — Client SSE Manager has no auto-reconnect; if connection drops, it stays dead until component remounts
- [ ] **Add per-endpoint retry budgets** — Don't retry 404s on traffic if the snapshot doesn't exist; retry only "still generating" placeholders
- [ ] **Monitor briefing generation latency** — Track P50/P95 for each data source; alert on degradation
- [ ] **Implement stale-while-revalidate** — Show previous briefing data while new briefing generates (currently shows loading)

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/briefing/briefing-service.js` | Main briefing generation (3,103 lines) |
| `server/api/briefing/briefing.js` | Briefing API endpoints (1,241 lines) |
| `server/api/strategy/blocks-fast.js` | Waterfall trigger that calls `runBriefing()` |
| `server/lib/traffic/tomtom.js` | TomTom traffic API client |
| `server/api/strategy/strategy-events.js` | SSE event endpoints (strategy, blocks, briefing, phase) |
| `server/db/db-client.js` | PostgreSQL LISTEN/NOTIFY dispatcher |
| `client/src/hooks/useBriefingQueries.ts` | Client briefing queries with polling/backoff |
| `client/src/utils/co-pilot-helpers.ts` | SSE Manager, `subscribeBriefingReady()` |
| `client/src/contexts/co-pilot-context.tsx` | Snapshot lifecycle that triggers waterfall |
