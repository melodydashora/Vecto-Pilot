# Snapshot Flow — Exhaustive Architecture Reference

**Created:** 2026-03-18
**Status:** Authoritative (supersedes `progress-bar-and-snapshot-flow.md`)
**Audience:** Developers, AI assistants, auditors

---

## 1. Overview

A **snapshot** is the atomic unit of a driver session. It captures the driver's GPS coordinates, resolved location (city/state/timezone), weather, air quality, and holiday context at a specific moment. Every downstream pipeline — briefing, strategy, ranking, content blocks — is keyed to a `snapshot_id`.

### Core Principles

1. **Every sign-in = fresh snapshot.** No pre-strategy caching. When a user logs in, they get a completely new snapshot, briefing, and strategy.
2. **One user = one active snapshot.** `users.current_snapshot_id` points to the single active snapshot. Old snapshots are retained for history but are not reused after logout/refresh.
3. **Snapshot is the waterfall trigger.** Creating a snapshot fires the entire pipeline: briefing generation → strategy generation → ranking → content blocks.
4. **Timezone is non-negotiable.** A snapshot without a timezone is rejected. All time-based calculations (open/closed status, day part, surge windows) depend on it.
5. **Ownership is enforced.** Every snapshot has a `user_id`. Middleware rejects access if the requesting user doesn't own the snapshot.

---

## 2. Data Model

### 2.1 `snapshots` Table (`shared/schema.js:32-73`)

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| `snapshot_id` | UUID | PK | Unique identifier |
| `created_at` | timestamp w/ tz | NOT NULL | Creation timestamp (UTC) |
| `date` | text | NOT NULL | YYYY-MM-DD in driver's local timezone |
| `device_id` | text | NOT NULL | Browser/device identifier |
| `session_id` | UUID | NOT NULL | Links to `users.session_id` |
| `user_id` | UUID | nullable* | Owner (*required by middleware, nullable for legacy) |
| `lat` | double precision | NOT NULL | GPS latitude |
| `lng` | double precision | NOT NULL | GPS longitude |
| `coord_key` | text | nullable | FK to `coords_cache` ("lat6d_lng6d" format) |
| `city` | text | NOT NULL | Resolved city name |
| `state` | text | NOT NULL | Resolved state/province |
| `country` | text | NOT NULL | Resolved country |
| `formatted_address` | text | NOT NULL | Full street address from Google Geocoding |
| `timezone` | text | NOT NULL | IANA timezone (e.g., "America/Chicago") |
| `market` | text | nullable | Market from `driver_profiles` at creation time |
| `local_iso` | timestamp no tz | NOT NULL | Snapshot time in driver's local timezone |
| `dow` | integer | NOT NULL | Day of week (0=Sunday, 6=Saturday) |
| `hour` | integer | NOT NULL | Hour of day (0-23) |
| `day_part_key` | text | NOT NULL | "morning", "afternoon", "evening", "late_evening", "overnight" |
| `h3_r8` | text | nullable | H3 geohash (resolution 8) for density analysis |
| `weather` | JSONB | nullable | Enriched weather data (temp, conditions, icon) |
| `air` | JSONB | nullable | Enriched air quality data (AQI, category) |
| `permissions` | JSONB | nullable | Geolocation permission state |
| `holiday` | text | NOT NULL (default: 'none') | Holiday name or "none" |
| `is_holiday` | boolean | NOT NULL (default: false) | Holiday flag |

### 2.2 `users` Table — Session Binding

| Column | Type | Purpose |
|--------|------|---------|
| `current_snapshot_id` | UUID, nullable | Points to the ONE active snapshot |
| `session_id` | UUID | Current session identifier |
| `session_start_at` | timestamp | When session began |
| `last_active_at` | timestamp | Sliding window for 60-min TTL |

### 2.3 Cascade Relationships

These tables have `snapshot_id` as a FK with `ON DELETE CASCADE`:

| Table | Relationship | Notes |
|-------|-------------|-------|
| `strategies` | 1:1 UNIQUE | One strategy per snapshot |
| `briefings` | 1:1 UNIQUE | One briefing per snapshot |
| `rankings` | 1:1 | One ranking per snapshot |
| `ranking_candidates` | 1:many | Venues/blocks scored for this snapshot |
| `actions` | 1:many | User actions (navigate, call, etc.) |
| `venue_feedback` | 1:many | Venue ratings/feedback |
| `strategy_feedback` | 1:many | Strategy usefulness ratings |
| `coach_conversations` | 1:many | AI Coach chat threads |

**Deleting a snapshot cascades to all dependent data.**

### 2.4 Validation (`server/util/validate-snapshot.js`)

Before INSERT, `validateSnapshotFields()` requires ALL of:
- `lat`, `lng` — coordinates
- `city`, `state`, `country`, `formatted_address` — location identity
- `timezone` — IANA format, NO FALLBACK
- `local_iso`, `dow`, `hour`, `day_part_key` — time context

Throws `SNAPSHOT_INCOMPLETE` if any field is missing.

---

## 3. Snapshot Lifecycle

### 3.1 Complete Flow Diagram

```
USER OPENS APP / LOGS IN
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  AUTH CONTEXT: login()                                │
│  1. POST /api/auth/login → token + user + profile     │
│  2. Clear sessionStorage (SESSION_KEYS.SNAPSHOT)       │
│  3. Clear localStorage (strategy, strategy_snapshot_id)│
│  4. setState({ user, profile, token })                 │
└──────────────────────────────────────────────────────┘
        │
        ▼ (user.userId + token trigger GPS effect)
┌──────────────────────────────────────────────────────┐
│  LOCATION CONTEXT: GPS Effect (50ms delay)            │
│  1. Check for cached resume data (refs)               │
│  2. If resume valid (snapshot + coords + city + tz):   │
│     → setIsLocationResolved(true)                      │
│     → Dispatch 'vecto-snapshot-saved' reason='resume'  │
│     → DONE (no API calls)                              │
│  3. If resume fails OR fresh login:                    │
│     → Clear lastEnrichmentCoordsRef                    │
│     → refreshGPS(true) — FORCE FRESH                   │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  refreshGPS(forceNewSnapshot=true)                    │
│  1. setIsLocationResolved(false)                       │
│  2. POST /api/location/release-snapshot                │
│     → UPDATE users SET current_snapshot_id = null      │
│  3. queryClient.cancelQueries() + clear()              │
│  4. Clear sessionStorage + localStorage strategy       │
│  5. Dispatch 'vecto-strategy-cleared'                  │
│  6. await getGeoPosition()                             │
│     → Browser geolocation API                          │
│     → Fallback: Google Geolocation API                 │
│     → Fallback: profile.homeLat/homeLng                │
│  7. await enrichLocation(lat, lng, accuracy, true)     │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  enrichLocation(lat, lng, accuracy, forceRefresh)     │
│  1. Coord dedup check (skip if forceRefresh=true)      │
│  2. Parallel fetch:                                    │
│     a. GET /api/location/resolve?lat=&lng=&...         │
│     b. GET /api/location/weather?lat=&lng=             │
│     c. GET /api/location/air-quality?lat=&lng=         │
│  3. Server creates snapshot → returns snapshot_id       │
│  4. Set state: city, state, timeZone, weather, air     │
│  5. Gate isLocationResolved on city + address + tz      │
│  6. PATCH /api/location/snapshot/{id}/enrich (weather)  │
│  7. Dispatch 'vecto-snapshot-saved' reason='init'       │
│  8. Persist to sessionStorage for resume                │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  SERVER: /api/location/resolve                        │
│  1. Authenticate (HMAC token verification)             │
│  2. Validate lat/lng                                   │
│  3. Check coords_cache for previous resolve            │
│     → Cache HIT: reuse city/state/tz (skip Google API) │
│     → Cache MISS: call Google Geocode + Timezone API   │
│  4. Check snapshot reuse:                              │
│     → If force=true: always create new                 │
│     → If existing <60min AND same city: REUSE          │
│     → Else: create new                                 │
│  5. INSERT INTO snapshots (full validated record)       │
│  6. UPDATE users SET current_snapshot_id = snapshot_id  │
│  7. Fire-and-forget: generateAndStoreBriefing()        │
│  8. Fire-and-forget: generateStrategyForSnapshot()     │
│  9. Return { snapshot_id, city, state, timezone, ... } │
└──────────────────────────────────────────────────────┘
        │
        ▼ ('vecto-snapshot-saved' event dispatched)
┌──────────────────────────────────────────────────────┐
│  CO-PILOT CONTEXT: handleSnapshotSaved                │
│  1. Set lastSnapshotId state                           │
│  2. If reason='resume' → skip blocks-fast (cached ok)  │
│  3. If reason='init' or 'manual_refresh':              │
│     → Dedup check (waterfallTriggeredRef)              │
│     → POST /api/blocks-fast { snapshotId }             │
│     → WATERFALL STARTS                                 │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  WATERFALL PIPELINE (server-side, async)               │
│                                                        │
│  Phase 1: Briefing Generation                          │
│    → Weather, traffic, news, events, school closures   │
│    → INSERT/UPDATE briefings WHERE snapshot_id = ?     │
│    → SSE: briefing_ready { snapshot_id }               │
│                                                        │
│  Phase 2: Strategy Generation                          │
│    → ensureStrategyRow(snapshotId)                     │
│    → Strategist AI (Claude Opus) generates plan        │
│    → UPDATE strategies WHERE snapshot_id = ?           │
│    → SSE: strategy_ready { snapshot_id }               │
│                                                        │
│  Phase 3: Ranking & Content Blocks                     │
│    → INSERT rankings WHERE snapshot_id = ?             │
│    → Score venues, generate content blocks             │
│    → INSERT ranking_candidates WHERE snapshot_id = ?   │
│    → SSE: blocks_ready { snapshot_id }                 │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  CLIENT: React Query fetches (all keyed to snapshotId)│
│  - QUERY_KEYS.SNAPSHOT(snapshotId)                     │
│  - QUERY_KEYS.BLOCKS_FAST(snapshotId)                  │
│  - QUERY_KEYS.BLOCKS_STRATEGY(snapshotId)              │
│  - QUERY_KEYS.BRIEFING_WEATHER(snapshotId)             │
│  - QUERY_KEYS.BRIEFING_TRAFFIC(snapshotId)             │
│  - QUERY_KEYS.BRIEFING_EVENTS(snapshotId)              │
│  - QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId)      │
│  - QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId)     │
│  - QUERY_KEYS.BRIEFING_AIRPORT(snapshotId)             │
│                                                        │
│  SSE listeners refetch on ready signals                │
│  Polling for briefing data until real data arrives      │
└──────────────────────────────────────────────────────┘
```

### 3.2 Manual Refresh (User Clicks GPS Button)

```
USER CLICKS REFRESH
        │
        ▼
refreshGPS(true)
  1. POST /api/location/release-snapshot  → null current_snapshot_id
  2. queryClient.cancelQueries() + clear()
  3. clearSnapshotStorage()
  4. Clear localStorage strategy
  5. Dispatch 'vecto-strategy-cleared'
        │
        ▼
co-pilot-context: handleStrategyClear
  1. manualRefreshInProgressRef = true
  2. Clear lastSnapshotId, strategy state
  3. Clear waterfallTriggeredRef (allow re-trigger)
  4. Reset prevSnapshotIdRef
        │
        ▼
getGeoPosition() → enrichLocation() → NEW snapshot → NEW waterfall
(Same flow as sign-in from step 6 onward)
```

### 3.3 Logout

```
USER LOGS OUT
        │
        ▼
auth-context: logout()
  1. queryClient.cancelQueries() + clear()
  2. POST /api/auth/logout
     → Server: UPDATE users SET session_id=null, current_snapshot_id=null
  3. localStorage.removeItem(AUTH_TOKEN)
  4. localStorage.removeItem(PERSISTENT_STRATEGY)
  5. localStorage.removeItem(STRATEGY_SNAPSHOT_ID)
  6. sessionStorage.removeItem(SESSION_KEYS.SNAPSHOT)
  7. setState({ user: null, token: null, ... })
        │
        ▼
location-context: GPS effect detects !user
  → Stops all location operations
  → All snapshot data cleared from client
```

### 3.4 TTL-Triggered Logout (401 Error)

```
API RETURNS 401 (expired token / TTL)
        │
        ▼
auth-context: handleAuthError
  1. POST /api/auth/logout (release snapshot on server)
  2. queryClient.cancelQueries()
  3. Clear all storage (same as explicit logout)
  4. Redirect to /auth/sign-in?expired=true
```

### 3.5 Snapshot Ownership Error (404 on Briefing Query)

```
useBriefingQueries: receives 404 (snapshot_not_found)
        │
        ▼
dispatchSnapshotOwnershipError()
  1. Enter cooling-off state (60s debounce)
  2. Dispatch 'snapshot-ownership-error' event
        │
        ▼
location-context: handleOwnershipError
  1. setLastSnapshotId(null)
  2. clearSnapshotStorage()
  3. lastEnrichmentCoordsRef.current = null
  4. refreshGPSRef.current?.(true)  → fresh snapshot
        │
        ▼
Full waterfall restarts (same as sign-in)
```

---

## 4. Server-Side Snapshot Operations

### 4.1 Creation Routes

| Route | File | Line | Purpose |
|-------|------|------|---------|
| `GET /api/location/resolve` | `server/api/location/location.js` | 419 | Primary: resolves GPS → creates snapshot |
| `POST /api/location/snapshot` | `server/api/location/snapshot.js` | 35 | Fallback: client-side creation (legacy) |

Both routes require authentication (`requireAuth`).

### 4.2 Snapshot Reuse Logic (`location.js:1017-1047`)

```
IF forceRefresh=true → CREATE new snapshot (always)
ELSE IF user has current_snapshot_id:
  → Fetch existing snapshot from DB
  → IF age < 60 min AND same city → REUSE (no new snapshot)
  → IF age >= 60 min → CREATE new
  → IF different city → CREATE new
  → IF snapshot not in DB → CREATE new
ELSE → CREATE new
```

**60-minute TTL** is defined at `location.js:1015`:
```javascript
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
```

### 4.3 Release Route

| Route | File | Line | Operation |
|-------|------|------|-----------|
| `POST /api/location/release-snapshot` | `location.js` | 167 | `UPDATE users SET current_snapshot_id = null` |

Called before every manual refresh and during logout.

### 4.4 Read Route

| Route | File | Line | Security |
|-------|------|------|----------|
| `GET /api/snapshot/:snapshotId` | `snapshot.js` | 236 | `requireAuth` + `requireSnapshotOwnership` |

Returns: coordinates, city, state, timezone, weather, air, holiday, created_at.

### 4.5 Enrichment Route

| Route | File | Line | Purpose |
|-------|------|------|---------|
| `PATCH /api/location/snapshot/:id/enrich` | `snapshot.js` | ~290 | Add weather/air data after creation |

### 4.6 Ownership Middleware (`server/middleware/require-snapshot-ownership.js`)

1. `SELECT FROM snapshots WHERE snapshot_id = ?`
2. Reject if `snapshot.user_id` is NULL (orphan data)
3. Reject with **404** (not 403) if `snapshot.user_id !== req.auth.userId` (prevents enumeration)
4. Attach `req.snapshot = snapshot` for downstream handlers

---

## 5. Client-Side Storage

### 5.1 Session Storage (survives page reload within tab)

| Key | Constant | Contents | TTL |
|-----|----------|----------|-----|
| `vecto_snapshot` | `SESSION_KEYS.SNAPSHOT` | Full snapshot data (see below) | 15 min |
| `vecto_resume_reason` | `SESSION_KEYS.RESUME_REASON` | "init" / "manual_refresh" / "resume" | Session |

**Persisted snapshot data structure:**
```typescript
{
  snapshotId: string,
  coords: { latitude: number, longitude: number },
  city: string,
  state: string,
  timeZone: string,
  locationString: string,
  weather: object | null,
  airQuality: object | null,
  isLocationResolved: boolean,
  lastUpdated: string,
  timestamp: number  // Date.now() — used for 15-min TTL check
}
```

### 5.2 Local Storage (survives browser close)

| Key | Constant | Contents |
|-----|----------|----------|
| `vecto_strategy_snapshot_id` | `STORAGE_KEYS.STRATEGY_SNAPSHOT_ID` | Snapshot ID linked to cached strategy |
| `vecto_persistent_strategy` | `STORAGE_KEYS.PERSISTENT_STRATEGY` | Cached strategy JSON |
| `vectopilot_auth_token` | `STORAGE_KEYS.AUTH_TOKEN` | Auth token (userId.hmacSignature) |

### 5.3 Clearing Rules

| Event | sessionStorage | localStorage (strategy) | Server |
|-------|---------------|------------------------|--------|
| Login | Cleared by `auth-context` | Cleared by `auth-context` | `current_snapshot_id` set on new snapshot |
| Manual refresh | Cleared by `refreshGPS` | Cleared by `refreshGPS` | `current_snapshot_id` nulled then reset |
| Logout | Cleared by `auth-context` | Cleared by `auth-context` | `current_snapshot_id` + `session_id` nulled |
| 401 error | Cleared by `handleAuthError` | Cleared by `handleAuthError` | Logout called server-side |
| Ownership error | Cleared by `handleOwnershipError` | Cleared by snapshot change effect | New snapshot created |

---

## 6. Custom Events

| Event Name | Dispatched By | Listened By | Payload |
|------------|--------------|-------------|---------|
| `vecto-snapshot-saved` | `location-context` (enrichLocation) | `co-pilot-context`, `useBriefingQueries` | `{ snapshotId, holiday, is_holiday, reason }` |
| `snapshot-ownership-error` | `useBriefingQueries` | `location-context` | (none) |
| `vecto-strategy-cleared` | `location-context` (refreshGPS) | `co-pilot-context` | (none) |
| `vecto-auth-error` | `useBriefingQueries` (on 401) | `auth-context` | `{ error: string }` |

### Event Flow Chain

```
enrichLocation completes
  → dispatches 'vecto-snapshot-saved'
    → co-pilot-context: sets lastSnapshotId, triggers blocks-fast
      → React Query: all snapshot-keyed queries re-fetch
        → SSE: briefing_ready / strategy_ready / blocks_ready
          → React Query: refetch on SSE signal
```

---

## 7. API Routes Reference

### 7.1 Snapshot Lifecycle Endpoints

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| GET | `/api/location/resolve?lat=&lng=&...` | Create snapshot from GPS | Token |
| POST | `/api/location/snapshot` | Create snapshot (fallback) | Token |
| GET | `/api/snapshot/:snapshotId` | Fetch snapshot data | Token + Ownership |
| PATCH | `/api/location/snapshot/:id/enrich` | Add weather/air to snapshot | Token |
| POST | `/api/location/release-snapshot` | Null `current_snapshot_id` | Token |

### 7.2 Snapshot-Dependent Pipeline Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/blocks-fast` | Trigger waterfall (body: `{ snapshotId }`) |
| GET | `/api/blocks-fast?snapshotId=` | Fetch blocks for snapshot |
| GET | `/api/blocks/strategy/:snapshotId` | Fetch strategy for snapshot |
| GET | `/api/strategy/:snapshotId` | Fetch strategy with briefing context |
| GET | `/api/briefing/weather/:snapshotId` | Weather briefing |
| GET | `/api/briefing/traffic/:snapshotId` | Traffic briefing |
| GET | `/api/briefing/rideshare-news/:snapshotId` | News briefing |
| GET | `/api/briefing/events/:snapshotId` | Events briefing |
| GET | `/api/briefing/school-closures/:snapshotId` | School closures |
| GET | `/api/briefing/airport/:snapshotId` | Airport conditions |

### 7.3 React Query Keys (`client/src/constants/apiRoutes.ts`)

```typescript
QUERY_KEYS.SNAPSHOT(snapshotId)              // ['/api/snapshot', id]
QUERY_KEYS.BLOCKS_FAST(snapshotId)           // ['/api/blocks-fast', id]
QUERY_KEYS.BLOCKS_STRATEGY(snapshotId)       // ['/api/blocks/strategy', id]
QUERY_KEYS.BRIEFING_WEATHER(snapshotId)      // ['/api/briefing/weather', id]
QUERY_KEYS.BRIEFING_TRAFFIC(snapshotId)      // ['/api/briefing/traffic', id]
QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId)
QUERY_KEYS.BRIEFING_EVENTS(snapshotId)
QUERY_KEYS.BRIEFING_EVENTS_ACTIVE(snapshotId)
QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId)
QUERY_KEYS.BRIEFING_AIRPORT(snapshotId)
```

---

## 8. Security Model

1. **All snapshot routes require `requireAuth`** — no anonymous access
2. **Ownership enforcement via `requireSnapshotOwnership`** — `snapshot.user_id === req.auth.userId`
3. **NULL user_id = rejected** — orphan snapshots are not served (auth-only product)
4. **404 on mismatch** (not 403) — prevents snapshot ID enumeration
5. **Server-side release on logout** — `current_snapshot_id` and `session_id` nulled in same UPDATE
6. **Client clears all storage on logout** — sessionStorage, localStorage, React Query cache

---

## 9. Timezone Resolution Chain

Timezone is **required** for snapshot creation. The resolution order:

1. **`coords_cache.timezone`** — Fastest. Hit if these exact coordinates were resolved before.
2. **`markets.timezone`** — Fast. If resolved city matches a known market (140 markets with pre-stored timezones).
3. **Google Timezone API** — Slow, costs money. Called only for cache misses outside known markets.
4. **`driver_profiles.home_timezone`** — Set at signup. Used for market backfill, not for snapshot timezone (driver may have driven to a different timezone).

**Key rule:** The snapshot timezone comes from the GPS coordinates, NOT the driver's home timezone. A Dallas driver in Austin gets `America/Chicago` (same zone), but a Dallas driver in Phoenix gets `America/Phoenix`.

---

## 10. File Reference Map

### Client

| File | Role |
|------|------|
| `client/src/contexts/location-context-clean.tsx` | **Primary owner.** Creates, persists, restores, releases snapshots. Dispatches events. |
| `client/src/contexts/co-pilot-context.tsx` | **Orchestrator.** Listens for snapshot events, triggers blocks-fast waterfall, manages strategy lifecycle. |
| `client/src/contexts/auth-context.tsx` | **Cleanup.** Clears snapshot data on login, logout, and auth errors. |
| `client/src/hooks/useBriefingQueries.ts` | **Consumer.** All briefing queries keyed to snapshotId. Detects ownership errors. |
| `client/src/hooks/useEnrichmentProgress.ts` | **Consumer.** Tracks pipeline progress, matches strategy to snapshot. |
| `client/src/constants/storageKeys.ts` | Storage key constants (SESSION_KEYS.SNAPSHOT, STORAGE_KEYS.STRATEGY_SNAPSHOT_ID). |
| `client/src/constants/apiRoutes.ts` | API route constants and QUERY_KEYS factories. |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Passes `lastSnapshotId` to BriefingTab. |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Uses `lastSnapshotId` for strategy/feedback display. |
| `client/src/pages/co-pilot/MapPage.tsx` | Uses `lastSnapshotId` for active events query. |
| `client/src/components/FeedbackModal.tsx` | Includes `snapshot_id` in feedback submissions. |
| `client/src/components/GlobalHeader.tsx` | Displays location, manages GPS refresh button. |

### Server

| File | Role |
|------|------|
| `server/api/location/location.js` | **Primary creator.** `/resolve` endpoint creates snapshots, manages reuse/release. |
| `server/api/location/snapshot.js` | **CRUD routes.** POST (create), GET (read), PATCH (enrich). |
| `server/middleware/require-snapshot-ownership.js` | **Security.** Ownership verification middleware. |
| `server/util/validate-snapshot.js` | **Validation.** Required field checks before INSERT. |
| `server/api/auth/auth.js` | **Session management.** Sets `current_snapshot_id=null` on login/logout. |
| `server/api/strategy/blocks-fast.js` | **Pipeline.** POST triggers ranking + strategy from snapshot context. |
| `server/api/strategy/strategy.js` | **Strategy routes.** GET/POST keyed to snapshot_id. |
| `server/api/strategy/content-blocks.js` | **Blocks.** Reads snapshot + strategy + briefing + ranking. |
| `server/api/briefing/briefing.js` | **Briefing routes.** All keyed to snapshot_id. |
| `server/lib/briefing/briefing-service.js` | **Briefing generator.** INSERT/UPDATE briefings for snapshot. |
| `server/lib/strategy/strategy-generator.js` | **Strategy generator.** Reads snapshot, generates via AI. |
| `server/lib/strategy/strategy-utils.js` | **Strategy helpers.** ensureStrategyRow, isStrategyReady. |
| `server/lib/location/get-snapshot-context.js` | **Context helpers.** getSnapshotLocationContext, getFullSnapshot. |
| `server/lib/location/getSnapshotTimeContext.js` | **Time context.** Validates timezone, builds time metadata. |
| `server/lib/ai/coach-dal.js` | **Coach data access.** Reads snapshot for AI Coach context. |
| `server/api/chat/chat-context.js` | **Chat context.** Builds context from snapshot + strategy + ranking. |
| `server/api/feedback/feedback.js` | **Feedback.** Accepts snapshot_id in venue/strategy feedback. |
| `server/api/feedback/actions.js` | **Actions.** Logs user actions with snapshot_id. |
| `server/events/phase-emitter.js` | **SSE.** Emits phase changes with snapshot_id. |
| `server/api/health/diagnostics.js` | **Diagnostics.** Counts snapshots, lists recent, checks health. |
| `shared/schema.js` | **Schema.** Table definitions, relations, cascade rules. |

### Scripts & Debugging

| File | Role |
|------|------|
| `scripts/test-snapshot-workflow.js` | **Observer.** Polls `users.current_snapshot_id` changes, logs timing. |
| `gateway-server.js` | **Bootstrap.** Starts snapshot observer in non-autoscale mode. |

---

## 11. Known Constraints & Lessons Learned

1. **Session restore must NOT set `isLocationResolved`** — Doing so before auth loads causes 401 → logout loop. The GPS effect handles this after auth is confirmed. (`location-context-clean.tsx:270-282`)

2. **`refreshGPS` deps must NOT include location data** — `lastSnapshotId`, `currentCoords`, `city` are SET by refreshGPS. Including them in the useEffect deps causes 4x GPS fetches in 200ms. Use refs instead. (`location-context-clean.tsx:729-736`)

3. **React Query `refetch()` bypasses `enabled`** — Even with `enabled: false`, calling `refetch()` fires the queryFn. All queryFn implementations must be defensive (check for required params and return null if missing). (`useBarsQuery.ts:83-94`, `BarsMainTab.tsx:140-151`)

4. **Coord dedup key must be cleared on resume failure** — Session restore sets `lastEnrichmentCoordsRef` from cached coords. If resume fails and `refreshGPS` runs with the same coords, enrichment is skipped (dedup hit). The fix: clear the ref when resume fails. (`location-context-clean.tsx:796`)

5. **Snapshot reuse vs. fresh sign-in** — Server allows reuse of <60min snapshots. Client calls `refreshGPS(true)` on fresh sign-in to force new. Only the resume path (page reload with valid cache) skips the fresh cycle.

6. **`calculateOpenStatus()` needs timezone** — Without timezone, all venue hours return null. This is why timezone is a hard requirement for snapshot creation and for the `isLocationResolved` gate.

7. **Fire-and-forget pipelines** — Briefing and strategy generation are non-blocking (queueMicrotask). The HTTP response returns the snapshot_id immediately. SSE events notify the client when each pipeline phase completes.
