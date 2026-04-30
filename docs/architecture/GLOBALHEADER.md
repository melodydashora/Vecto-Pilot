# GLOBALHEADER.md — Global Header and Location Workflow

> **Canonical reference** for the GlobalHeader component, location resolution workflow, GPS → snapshot → downstream pipeline data flow.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/Location.md` — Location workflow doc (absorbed and expanded)

---

## Table of Contents

1. [GlobalHeader Component](#1-globalheader-component)
2. [Location Resolution Workflow](#2-location-resolution-workflow)
3. [Data Flow: GPS → Snapshot → Downstream](#3-data-flow-gps--snapshot--downstream)
4. [Session Persistence and Resume](#4-session-persistence-and-resume)
5. [Authentication Flow in Location Pipeline](#5-authentication-flow-in-location-pipeline)
6. [Current State](#6-current-state)
7. [Known Gaps](#7-known-gaps)
8. [TODO — Hardening Work](#8-todo--hardening-work)

---

## 1. GlobalHeader Component

**File:** `client/src/components/GlobalHeader.tsx`

The GlobalHeader is the persistent top bar visible on all authenticated pages. It displays the driver's real-time context:

### Display Elements

| Element | Source | Updates When |
|---------|--------|-------------|
| City, State | `LocationContext.city`, `.state` | Location resolves |
| Current time | `Intl.DateTimeFormat` with `LocationContext.timeZone` | Every second |
| Day of week | Computed from timezone | Location resolves |
| Weather (temp + conditions) | `LocationContext.weather` | Snapshot enriched |
| AQI badge | `LocationContext.airQuality` | Snapshot enriched |
| GPS refresh button | Triggers `LocationContext.refreshGPS()` | On click |
| Snapshot status | Pipeline phase indicator | SSE phase events |

### Data Binding

GlobalHeader consumes `LocationContext` directly:
```typescript
const { city, state, timeZone, weather, airQuality, isLocationResolved, refreshGPS } = useLocation();
```

It renders immediately with restored cached data (from sessionStorage) while fresh GPS resolves in background.

---

## 2. Location Resolution Workflow

### Client-Side Flow

```
1. GPS Request
   └─ navigator.geolocation.getCurrentPosition()
   └─ Fallback: Google Geolocation API
   └─ Fallback: Home location from driver_profiles

2. Location Resolution (parallel)
   ├─ GET /api/location/resolve?lat=X&lng=Y&device_id=Z&accuracy=N
   │   └─ Returns: city, state, timezone, formatted_address, snapshot_id
   ├─ GET /api/location/weather?lat=X&lng=Y
   │   └─ Returns: temperature, conditions, description
   └─ GET /api/location/airquality?lat=X&lng=Y
       └─ Returns: aqi, category

3. Two-Phase UI Update
   ├─ Phase 1 (~300ms): Weather + AQI appear (faster APIs)
   └─ Phase 2 (~800ms): City/State appear (Geocode + DB write slower)

4. Snapshot Enrichment
   └─ PATCH /api/location/snapshot/:id/enrich { weather, air }

5. Event Dispatch
   └─ window.dispatchEvent('vecto-snapshot-saved', { snapshotId, reason })
```

### Server-Side Flow

```
GET /api/location/resolve
  │
  ├─ Validate coordinates (lat ±90, lng ±180)
  ├─ Check coords_cache (6-decimal precision key)
  │   ├─ HIT → use cached city/state/timezone
  │   └─ MISS → Google Geocode API + Timezone API
  │             └─ Store in coords_cache
  │
  ├─ Check existing snapshot (reuse logic)
  │   ├─ force=true → CREATE NEW
  │   ├─ Same city + age < 60 min → REUSE
  │   └─ Different city OR age ≥ 60 min → CREATE NEW
  │
  ├─ Create/reuse snapshot
  │   ├─ INSERT snapshots (lat, lng, city, state, timezone, dow, hour, day_part_key)
  │   └─ UPDATE users SET current_snapshot_id = new_id
  │
  └─ Return { city, state, timezone, snapshot_id, snapshot_reused }
```

---

## 3. Data Flow: GPS → Snapshot → Downstream

```
Browser GPS
  └─ LocationContext (location-context-clean.tsx)
      ├─ Sets: currentCoords, city, state, timeZone, weather, airQuality
      ├─ Sets: lastSnapshotId, isLocationResolved
      ├─ Persists to sessionStorage (15-min TTL)
      │
      └─ Dispatches 'vecto-snapshot-saved' event
           │
           └─ CoPilotContext receives event
                ├─ Sets lastSnapshotId
                ├─ POST /api/blocks-fast { snapshotId } → waterfall:
                │   ├─ Briefing (7 parallel Gemini calls)
                │   ├─ Strategy (Claude Opus)
                │   └─ Venues/SmartBlocks (GPT-5.4)
                │
                ├─ Subscribe SSE: /events/strategy, /events/blocks, /events/phase, /events/briefing
                │
                └─ useBriefingQueries fires:
                    └─ GET /api/briefing/weather, traffic, news, events, closures, airport
```

### What the GlobalHeader Shows at Each Stage

| Stage | Time | GlobalHeader Shows |
|-------|------|-------------------|
| App mount | 0s | "Getting location..." (or cached city from sessionStorage) |
| GPS success | ~4s | Cached weather if available |
| Weather API | ~4.3s | Temperature + conditions |
| AQI API | ~4.3s | AQI badge |
| Location resolve | ~4.8s | "Frisco, TX" + timezone-aware clock |
| Snapshot created | ~5s | Pipeline phase indicator starts |

---

## 4. Session Persistence and Resume

### sessionStorage Structure

**Key:** `vecto_snapshot` | **TTL:** 15 minutes

```json
{
  "snapshotId": "034292d5-...",
  "coords": { "latitude": 33.128, "longitude": -96.875 },
  "city": "Frisco", "state": "TX",
  "timeZone": "America/Chicago",
  "weather": { "temp": 72, "conditions": "Partly Cloudy" },
  "airQuality": { "aqi": 45, "category": "Good" },
  "timestamp": 1744328428861
}
```

### Resume Flow

1. App mounts → check sessionStorage for stored snapshot
2. If found + within TTL → restore display data immediately (GlobalHeader shows cached city/weather)
3. **Do NOT set isLocationResolved** (prevents queries firing before auth)
4. Wait for auth → GPS effect runs → sees cached data + valid snapshot → sets isLocationResolved
5. Dispatch `vecto-snapshot-saved` with `reason: 'resume'` → CoPilot skips waterfall regeneration

### Zombie Snapshot Prevention (2026-04-10 Fix)

On logout, LocationContext clears ALL state including sessionStorage. CoPilot's sync effect is guarded with `isAuthenticated` check. See SNAPSHOT.md §6 for full details.

---

## 5. Authentication Flow in Location Pipeline

```
1. Client sends: GET /api/location/resolve
   Headers: { Authorization: "Bearer <userId>.<signature>" }

2. Server validates token (inline, not middleware — location.js lines 425-499)
   - Verifies HMAC-SHA256 signature
   - Checks session in users table
   - Validates session TTL

3. On 401: Client clears token, redirects to /auth/sign-in

4. Snapshot ownership: requireSnapshotOwnership middleware on briefing endpoints
   - Verifies req.auth.userId matches snapshot.user_id
   - Returns 404 if mismatch (prevents cross-user data access)
```

---

## 6. Current State

| Area | Status |
|------|--------|
| GPS acquisition (browser + Google fallback) | Working |
| Two-phase UI update (weather first, city second) | Working |
| Snapshot creation/reuse (60-min TTL) | Working |
| sessionStorage resume (15-min TTL) | Working |
| GlobalHeader display (city, weather, AQI, clock) | Working |
| Zombie snapshot prevention | Working (2026-04-10 fix) |
| Snapshot enrichment (weather/air PATCH) | Working |

---

## 7. Known Gaps

1. **No continuous GPS tracking** — Location captured once per session, not updated while driving.
2. **GlobalHeader clock doesn't show snapshot staleness** — No indicator of how old the current data is.
3. **Two-phase update can flash** — Brief moment where weather shows but city doesn't (unavoidable but noticeable).
4. **No location error recovery UI** — If GPS fails and no home location, user sees "Location unavailable" with no guidance.

---

## 8. TODO — Hardening Work

- [ ] **Add snapshot age indicator** — Show "Data from 15 min ago" in GlobalHeader when stale
- [ ] **Periodic GPS refresh** — Re-fetch location every 5 minutes while app is active
- [ ] **Location error guidance** — If GPS fails, show steps to enable permissions
- [ ] **Preload weather from last session** — Use localStorage (not sessionStorage) for weather fallback

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/components/GlobalHeader.tsx` | Header UI component |
| `client/src/contexts/location-context-clean.tsx` | GPS + location state + snapshot management |
| `server/api/location/location.js` | Location resolve endpoint |
| `server/middleware/require-snapshot-ownership.js` | Snapshot access control |
