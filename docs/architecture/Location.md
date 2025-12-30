# Location Workflow

This document describes the location resolution and snapshot creation workflow in Vecto Pilot.

## Overview

The location workflow is responsible for:
1. Obtaining user's GPS coordinates
2. Resolving coordinates to city/state/timezone
3. Creating a snapshot in the database
4. Triggering downstream workflows (Strategy, Briefing)

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Client)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. GPS Request                    2. Location Resolution                   │
│   ┌─────────────────┐              ┌─────────────────────────────────┐      │
│   │ navigator.      │              │ GET /api/location/resolve       │      │
│   │ geolocation.    │───coords───→ │   ?lat=33.12&lng=-96.86         │      │
│   │ getCurrentPos() │              │   &device_id=xxx&coord_source=gps│      │
│   └─────────────────┘              └─────────────────────────────────┘      │
│                                                  │                          │
│                                                  ▼                          │
│                              ┌──────────────────────────────┐               │
│                              │ Response:                    │               │
│                              │   city: "Frisco"             │               │
│                              │   state: "TX"                │               │
│                              │   timeZone: "America/Chicago"│               │
│                              │   snapshot_id: "abc123..."   │               │
│                              │   user_id: "def456..."       │               │
│                              └──────────────────────────────┘               │
│                                                  │                          │
│   3. Store State                                 │                          │
│   ┌─────────────────────────────────┐           │                          │
│   │ LocationContext                 │◄──────────┘                          │
│   │   - lastSnapshotId              │                                       │
│   │   - city, state, timeZone       │                                       │
│   │   - weather, airQuality         │                                       │
│   └─────────────────────────────────┘                                       │
│                    │                                                        │
│                    ▼                                                        │
│   4. Dispatch Event                                                         │
│   ┌─────────────────────────────────────────────────┐                      │
│   │ window.dispatchEvent('vecto-snapshot-saved')    │                      │
│   │   detail: { snapshotId, holiday, is_holiday }   │                      │
│   └─────────────────────────────────────────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            SERVER (Node.js)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   /api/location/resolve                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   1. Geocode coordinates (Google Geocoding API)                      │   │
│   │      → city, state, country, formatted_address                       │   │
│   │                                                                      │   │
│   │   2. Lookup/Create User (users table)                                │   │
│   │      → user_id (for auth token)                                      │   │
│   │                                                                      │   │
│   │   3. Create Snapshot (snapshots table)                               │   │
│   │      → snapshot_id, user_id, device_id                               │   │
│   │      → lat, lng, city, state, timezone                               │   │
│   │      → dow, hour, day_part_key                                       │   │
│   │                                                                      │   │
│   │   4. Queue TRIAD Job (triad_jobs table)                              │   │
│   │      → Triggers Strategy + Briefing generation                       │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Client
| File | Purpose |
|------|---------|
| `client/src/contexts/location-context-clean.tsx` | Main location provider, GPS handling, snapshot creation |
| `client/src/utils/co-pilot-helpers.ts` | Auth header helper (`getAuthHeader()`) |
| `client/src/pages/co-pilot/*.tsx` | Pages consume `lastSnapshotId` from LocationContext |

### Server
| File | Purpose |
|------|---------|
| `server/api/location/location.js` | `/api/location/resolve` endpoint |
| `server/middleware/require-snapshot-ownership.js` | Verifies user owns snapshot |
| `server/middleware/auth.js` | JWT token verification |
| `shared/schema.js` | Database schema (users, snapshots tables) |

## Database Tables

### users
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | Primary key, used in JWT tokens |
| device_id | text | Unique device identifier |
| current_snapshot_id | uuid | Links to active snapshot |
| lat, lng | double | Last known coordinates |
| city, state, timezone | text | Last resolved location |

### snapshots
| Column | Type | Description |
|--------|------|-------------|
| snapshot_id | uuid | Primary key |
| user_id | uuid | Links to users table (for ownership verification) |
| device_id | text | Device that created this snapshot |
| lat, lng | double | GPS coordinates at snapshot time |
| city, state, country | text | Resolved location |
| timezone | text | IANA timezone identifier |
| dow, hour, day_part_key | int/text | Time context |
| weather, air | jsonb | Weather and air quality data |

## Authentication Flow

```
1. Client sends request:
   GET /api/briefing/traffic/:snapshotId
   Headers: { Authorization: "Bearer <user_id>.<signature>" }

2. optionalAuth middleware (server/middleware/auth.js):
   - Extracts token from Authorization header
   - Verifies signature using JWT_SECRET
   - Sets req.auth.userId if valid

3. requireSnapshotOwnership middleware:
   - Loads snapshot from database
   - If req.auth.userId exists AND snapshot.user_id exists:
     - Verify they match (404 if not)
   - If req.auth.userId exists but snapshot.user_id is null:
     - Allow access (legacy data)
   - If no auth token:
     - Allow anonymous access (snapshot_id is capability token)
```

## Session Persistence

LocationContext uses sessionStorage to persist snapshot data across app switches (e.g., switching between Uber and Vecto apps):

```javascript
const SNAPSHOT_STORAGE_KEY = 'vecto_snapshot';
const SNAPSHOT_TTL_MS = 2 * 60 * 1000; // 2 minutes

// On mount: restore display data (city, weather) for immediate UX
// But DON'T restore snapshot_id - always create fresh snapshot

// On snapshot creation: persist to sessionStorage
sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify({
  snapshotId, coords, city, state, weather, ...
}));
```

**LESSON LEARNED:** Restoring old `snapshot_id` from sessionStorage caused stale data issues. Now we only restore display data for immediate UX, but always fetch fresh GPS and create new snapshot.

## Related Documents

- [Database Schema](database-schema.md) - Full schema documentation
- [Strategy.md](Strategy.md) - Strategy generation workflow
- [Briefing.md](Briefing.md) - Briefing data workflow
