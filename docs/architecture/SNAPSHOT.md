# SNAPSHOT.md — Snapshot Lifecycle Architecture

> **Canonical reference** for what a snapshot is, how it flows through the system, how it persists, and the zombie snapshot problem.
> Last updated: 2026-04-10

---

## Table of Contents

1. [What Is a Snapshot?](#1-what-is-a-snapshot)
2. [Server-Side Creation](#2-server-side-creation)
3. [Client-Side Persistence](#3-client-side-persistence)
4. [Restore-on-Return Flow](#4-restore-on-return-flow)
5. [Snapshot ID Propagation Through Context Providers](#5-snapshot-id-propagation-through-context-providers)
6. [The Zombie Snapshot Problem and Fix](#6-the-zombie-snapshot-problem-and-fix)
7. [Snapshot Reuse and TTL](#7-snapshot-reuse-and-ttl)
8. [Current State](#8-current-state)
9. [Known Gaps](#9-known-gaps)
10. [TODO — Hardening Work](#10-todo--hardening-work)

---

## 1. What Is a Snapshot?

A snapshot is a **point-in-time capture of the driver's context** — location, weather, time, and market conditions. It is the foundational data unit that feeds every downstream system: strategy generation, venue ranking, briefing, and Rideshare Coach conversations.

**Design principle:** The snapshot is the single source of truth for "where is the driver and what's happening around them." Every AI call references a snapshot ID, ensuring all systems reason about the same data.

### Schema (`snapshots` table)

**File:** `shared/schema.js` (lines 32–73)

| Column | Type | Purpose |
|--------|------|---------|
| `snapshot_id` | UUID (PK) | Unique identifier |
| `user_id` | UUID (FK → users) | Owner |
| `session_id` | UUID | Session that created it |
| `device_id` | text | Device identifier |
| `created_at` | timestamp w/ tz | Creation time |
| `date` | text | YYYY-MM-DD in driver's timezone |
| `lat`, `lng` | double precision | GPS coordinates |
| `coord_key` | text | `lat6d_lng6d` format for dedup |
| `city`, `state`, `country` | text | Resolved location |
| `formatted_address` | text | **CRITICAL** — full address for LLM calls (LLMs cannot reverse geocode) |
| `timezone` | text | IANA timezone (e.g., `America/Chicago`) |
| `market` | text (nullable) | Market name for event discovery |
| `local_iso` | timestamp w/o tz | Driver's wall-clock time |
| `dow` | integer | Day of week (0=Sunday) |
| `hour` | integer | Hour in driver's timezone |
| `day_part_key` | text | `morning` / `afternoon` / `evening` |
| `h3_r8` | text (nullable) | H3 geohash at resolution 8 |
| `weather` | jsonb | Enriched weather data |
| `air` | jsonb | Air quality data |
| `holiday` | text (default `'none'`) | Holiday name or `'none'` |
| `is_holiday` | boolean (default false) | Holiday flag |
| `permissions` | jsonb | GPS permission state |

Actual (

### Linked Tables

- `users.current_snapshot_id` → Points to the ONE active snapshot per user
- `strategies` → `snapshot_id` FK (unique constraint — one strategy per snapshot)
- `briefings` → `snapshot_id` FK (one briefing per snapshot)
- `smart_blocks` / `rankings` → Linked via snapshot_id

---

## 2. Server-Side Creation

### Primary Path: Location Resolve

**Route:** `GET /api/location/resolve?lat=X&lng=Y&device_id=Z&accuracy=N`
**File:** `server/api/location/location.js` (lines 391–1195)
**Auth:** `requireAuth` (inline token verification, not middleware — see lines 425–499)

**Flow:**

```
GPS coords arrive
  │
  ├─ 1. Validate coords (lat ±90, lng ±180)
  │
  ├─ 2. Check coords_cache (6-decimal precision key)
  │     ├─ Cache HIT → use cached city/state/timezone
  │     └─ Cache MISS → call Google APIs:
  │           ├─ Google Geocode API → city, state, country, formatted_address
  │           ├─ Google Timezone API (or market table fast-path) → timezone
  │           └─ Store in coords_cache
  │
  ├─ 3. Check existing snapshot (reuse logic)
  │     ├─ force=true → always create new
  │     ├─ Same city + age < 60 min → REUSE existing snapshot
  │     └─ Different city OR age >= 60 min → create new
  │
  ├─ 4. Create snapshot (if needed)
  │     ├─ INSERT into snapshots table
  │     ├─ Calculate: local_iso, dow, hour, day_part_key, market
  │     └─ UPDATE users SET current_snapshot_id = new_id (parallel)
  │
  └─ 5. Return { city, state, timezone, snapshot_id, snapshot_reused }
```

### Secondary Path: Client-Side Fallback

**File:** `client/src/contexts/location-context-clean.tsx` (lines 567–627)

If the server does not return a `snapshot_id` (legacy path), the client creates one locally:
1. Generates UUID via `crypto.randomUUID()`
2. Builds snapshot object with coords, resolved location, time context, weather, air
3. POSTs to `/api/location/snapshot`
4. Dispatches `vecto-snapshot-saved` event

### Enrichment (Weather/Air)

**Route:** `PATCH /api/location/snapshot/:snapshotId/enrich`
**File:** `server/api/location/location.js` (lines 2345–2390)

Called by client after weather/air quality APIs return (phase 1, before location resolves). Updates the snapshot's `weather` and `air` JSONB columns.

### Release

**Route:** `POST /api/location/release-snapshot`
**File:** `server/api/location/location.js` (lines 166–179)

Sets `users.current_snapshot_id = null`. Called before manual GPS refresh and during logout.

---

## 3. Client-Side Persistence

### sessionStorage Structure

**Key:** `vecto_snapshot` (SESSION_KEYS.SNAPSHOT)
**TTL:** 15 minutes (client-enforced)

```json
{
  "snapshotId": "034292d5-...",
  "coords": { "latitude": 33.128, "longitude": -96.875 },
  "city": "Frisco",
  "state": "TX",
  "timeZone": "America/Chicago",
  "locationString": "Frisco, TX",
  "weather": { "temp": 72, "conditions": "Partly Cloudy" },
  "airQuality": { "aqi": 45, "category": "Good" },
  "isLocationResolved": true,
  "lastUpdated": "2026-04-10T22:40:28.000Z",
  "timestamp": 1744328428861
}
```

### When It's Written

**File:** `location-context-clean.tsx` (lines 298–317)

A `useEffect` watches `[lastSnapshotId, currentCoords, city, state, timeZone, weather, airQuality, ...]` and persists to sessionStorage whenever any value changes. This is how snapshot data survives app switches (driver goes to Uber app and back).

### When It's Cleared

| Trigger | Mechanism |
|---------|-----------|
| Logout | `sessionStorage.removeItem(SNAPSHOT)` in auth-context + LocationContext auth-drop effect |
| Manual refresh | `clearSnapshotStorage()` in LocationContext |
| Login | `sessionStorage.removeItem(SNAPSHOT)` in auth-context login() |
| TTL expired | Checked during restore — if `Date.now() - timestamp > 15 min`, discarded |
| Auth drop (2026-04-10 fix) | LocationContext auth-drop effect clears it |

---

## 4. Restore-on-Return Flow

**File:** `location-context-clean.tsx` (lines 236–294)

When the app mounts (user returns from another app or refreshes):

```
Mount
  │
  ├─ 1. Check sessionStorage for stored snapshot
  │     ├─ Not found → skip restore, wait for auth
  │     └─ Found → check TTL
  │           ├─ Expired (>15 min) → discard, start fresh
  │           └─ Valid → proceed to restore
  │
  ├─ 2. Restore display data (immediate — UI shows city, weather)
  │     └─ setCity(), setState(), setWeather(), setAirQuality(), etc.
  │
  ├─ 3. Restore snapshotId
  │     └─ setLastSnapshotId(data.snapshotId)
  │     └─ Set RESUME_REASON = 'resume' in sessionStorage
  │
  ├─ 4. Set enrichment dedup key (prevents duplicate enrichment)
  │
  ├─ 5. DO NOT set isLocationResolved = true
  │     └─ (Lesson learned: setting it here caused auth loop bug)
  │
  └─ 6. Wait for auth to load → GPS effect runs:
        ├─ Sees cached data + valid snapshot
        ├─ Sets isLocationResolved = true
        ├─ Dispatches vecto-snapshot-saved with reason='resume'
        └─ CoPilotContext receives event, marks in dedup set, skips waterfall
```

**Key design decision:** Display data restores immediately (user sees city, weather) but API queries wait until auth + snapshot validation complete. This prevents 401 loops.

---

## 5. Snapshot ID Propagation Through Context Providers

### Provider Hierarchy

```
AuthProvider          ← token, isAuthenticated
  └─ LocationProvider ← coords, city, weather, lastSnapshotId, isLocationResolved
       └─ CoPilotProvider ← lastSnapshotId (synced), strategy, blocks, briefing
            └─ Components ← consume via useCoPilot()
```

### Propagation Flow (Normal Login)

```
1. AuthProvider: isAuthenticated = true
     │
2. LocationProvider: GPS → enrichLocation() → server creates snapshot
     │  Sets: lastSnapshotId, city, state, weather, isLocationResolved
     │  Dispatches: window event 'vecto-snapshot-saved' { snapshotId, reason: 'init' }
     │
3. CoPilotProvider receives snapshot via TWO paths:
     │
     ├─ Path A (Event): 'vecto-snapshot-saved' listener
     │    └─ Sets lastSnapshotId
     │    └─ Triggers POST /api/blocks-fast waterfall
     │    └─ Adds to waterfallTriggeredRef dedup set
     │
     └─ Path B (Sync effect): useEffect watches locationContext.lastSnapshotId
          └─ If CoPilot has no snapshot but Location does → sync it
          └─ Does NOT trigger waterfall (event handler is the single trigger)
          └─ 2026-04-10: Guarded with isAuthenticated check
     │
4. CoPilot snapshot ID flows to:
     ├─ Strategy query (GET /api/blocks/strategy/:snapshotId)
     ├─ Blocks query (GET /api/blocks-fast?snapshotId=X)
     ├─ Snapshot query (GET /api/snapshot/:snapshotId)
     ├─ Briefing queries (useBriefingQueries)
     ├─ SSE subscriptions (strategy_ready, blocks_ready, phase, briefing_ready)
     └─ Enrichment progress tracking
```

### Deduplication

**Problem:** Both the event listener and sync effect can fire for the same snapshot.
**Solution:** `waterfallTriggeredRef` (a `Set<string>`) tracks which snapshot IDs have already triggered the waterfall. The event listener adds IDs before triggering POST, and the sync effect checks the set.

---

## 6. The Zombie Snapshot Problem and Fix

### The Bug (Pre-2026-04-10)

When the user logged out:

1. `closeAllSSE()` killed all 4 SSE connections (`:19.273`)
2. CoPilotContext detected auth drop, set `lastSnapshotId = null` (`:19.575`)
3. **LocationContext did NOT clear its `lastSnapshotId`** — still held `034292d5`
4. CoPilotContext's sync effect saw: Location has snapshot, CoPilot doesn't → **restored the zombie** (`:19.576`)
5. SSE subscription effects saw lastSnapshotId restored → **reopened all 4 connections** (`:19.578`)
6. App continued receiving events and processing data for a dead snapshot after logout

### Secondary Bug

`gpsEffectRanRef` was not reset on logout. On next login, the GPS effect saw `gpsEffectRanRef = true` and skipped fresh GPS fetch entirely.

### The Fix (Two Changes)

**Fix 1 — LocationContext auth-drop effect** (`location-context-clean.tsx`):
```javascript
useEffect(() => {
  if (prevTokenRef.current && !token) {
    // Clear ALL React state: snapshot, coords, city, weather, etc.
    // Clear ALL refs: snapshotRef, coordsRef, cityRef, timezoneRef
    // Reset gpsEffectRanRef = false (next login triggers fresh GPS)
    // Reset sessionRestoreAttemptedRef = false
    // Abort in-flight requests
    // Clear sessionStorage
  }
  prevTokenRef.current = token;
}, [token]);
```

**Fix 2 — CoPilotContext sync effect guard** (`co-pilot-context.tsx`):
```javascript
useEffect(() => {
  if (!isAuthenticated) return;  // ← NEW: blocks zombie during logout
  if (contextSnapshotId && !lastSnapshotId) {
    setLastSnapshotId(contextSnapshotId);
  }
}, [locationContext?.lastSnapshotId, lastSnapshotId, isAuthenticated]);
```

### Why Both Fixes Are Needed

React batches state updates. When auth drops:
- Fix 1 calls `setLastSnapshotId(null)` — but this is **queued**, not instant
- In the same render cycle, CoPilot's sync effect still sees Location's old value
- Fix 2 catches this because `isAuthenticated` is already false (from AuthContext's render)

After the next render cycle, Fix 1's state update applies and both snapshot IDs are null.

---

## 7. Snapshot Reuse and TTL

### Server-Side (60-Minute TTL)

**File:** `server/api/location/location.js` (lines 1015–1055)

```
const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 60 minutes
```

**Decision tree on `GET /api/location/resolve`:**

```
force=true?  ──yes──→  CREATE NEW
     │no
     ▼
Has existing snapshot?  ──no──→  CREATE NEW
     │yes
     ▼
Fetch snapshot from DB
     │
City changed? (case-insensitive)  ──yes──→  CREATE NEW
     │no
     ▼
Age < 60 min?  ──yes──→  REUSE (return existing snapshot_id)
     │no
     ▼
CREATE NEW
```

### Client-Side (15-Minute TTL)

**File:** `location-context-clean.tsx` (line 42)

```
const SNAPSHOT_TTL_MS = 15 * 60 * 1000; // 15 minutes
```

Checked during sessionStorage restore. If the stored snapshot is older than 15 minutes, it's discarded and a fresh GPS fetch is triggered.

**Why shorter?** The client TTL is for "driver switched to Uber and came back." 15 minutes is reasonable for an app switch during active driving. The server's 60-minute TTL is for "same GPS coordinates, don't burn another Geocode API call."

---

## 8. Current State

| Area | Status |
|------|--------|
| Server snapshot creation | Working — coordinates → geocode → timezone → DB insert |
| Client sessionStorage persistence | Working — survives app switches within 15-min TTL |
| Restore-on-return (resume flow) | Working — display data restores immediately, queries wait for auth |
| Snapshot reuse (server 60-min TTL) | Working — same city + <60 min = reuse |
| Weather/air enrichment | Working — PATCH endpoint enriches snapshot JSONB |
| Snapshot release (logout/refresh) | Working — nulls `users.current_snapshot_id` |
| Zombie snapshot prevention | **Fixed 2026-04-10** — dual guard (LocationContext cleanup + CoPilot auth check) |
| Waterfall deduplication | Working — `waterfallTriggeredRef` Set prevents duplicate POST |
| Manual refresh | Working — releases snapshot, clears storage, fresh GPS |

---

## 9. Known Gaps

1. **No server-side snapshot expiry cleanup** — Old snapshots stay in DB forever. Good for analytics/history, but the table grows unbounded.

2. **`formatted_address` is critical but not validated** — If Google Geocode returns an incomplete address, the LLM receives bad location context. No fallback or validation.

3. **Snapshot ownership is only checked on briefing endpoints** — The `requireSnapshotOwnership` middleware exists but isn't applied to all snapshot-consuming routes consistently.

4. **No snapshot versioning** — If weather or air data changes, the snapshot is updated in-place. No history of enrichment changes.

5. **Client-side fallback snapshot creation (legacy path)** — Still exists in code. If server doesn't return `snapshot_id`, client creates one. This path should be dead but hasn't been removed.

6. **`coord_key` dedup is coordinate-only** — Two snapshots at the same coords but different times are deduplicated. The time context (different daypart) is not considered in the dedup key.

7. **H3 geohash (`h3_r8`) is optional** — Some snapshots have it, some don't. Inconsistent for spatial queries.

---

## 10. TODO — Hardening Work

- [ ] **Add snapshot retention policy** — Archive or delete snapshots older than 90 days
- [ ] **Validate `formatted_address` on creation** — If empty/null, fail hard (don't create snapshot)
- [ ] **Apply `requireSnapshotOwnership` consistently** — Audit all routes that accept `snapshotId`
- [ ] **Remove client-side fallback snapshot creation** — This legacy path should be dead; confirm and remove
- [ ] **Add snapshot immutability** — Once enriched, mark snapshot as finalized. Prevent re-enrichment.
- [ ] **Track enrichment history** — Log when weather/air is added or updated on a snapshot
- [ ] **Ensure H3 is always populated** — If H3 library is available, always compute and store
- [ ] **Add snapshot health endpoint** — `GET /api/snapshot/:id/health` — validates all required fields present
- [ ] **Audit snapshot→strategy→briefing FK integrity** — Ensure orphaned strategies/briefings are cleaned up

---

## Key Files

| File | Purpose |
|------|---------|
| `shared/schema.js` (lines 32–73) | Snapshots table schema |
| `server/api/location/location.js` | Location resolve + snapshot creation |
| `server/api/location/snapshot.js` | Snapshot CRUD routes |
| `client/src/contexts/location-context-clean.tsx` | Client snapshot state, persistence, restore |
| `client/src/contexts/co-pilot-context.tsx` | Snapshot sync, waterfall trigger, dedup |
| `client/src/contexts/auth-context.tsx` | Snapshot cleanup on logout |
| `client/src/constants/storageKeys.ts` | `SESSION_KEYS.SNAPSHOT` |
