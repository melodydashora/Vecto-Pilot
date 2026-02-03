> **Last Verified:** 2026-02-01

# Location API (`server/api/location/`)

## Purpose

GPS processing, geocoding, weather, air quality, and snapshot management.

## ⚠️ CRITICAL RULE: session_id

**DO NOT update `users.session_id` from this API!**

`session_id` is the auth session identifier managed by:
- Login endpoint (sets new UUID)
- Logout endpoint (sets null)
- Auth middleware TTL checks (sets null on expiry)

**Bug History (2026-01-07):** Location API was setting `session_id = req.query.session_id || null`, which overwrote the auth session with null immediately after login, causing instant logouts. See `LESSONS_LEARNED.md` → "Auth Loop on Login".

## Files

| File | Route | Purpose |
|------|-------|---------|
| `location.js` | `/api/location/*` | GPS, geocoding, weather, AQ (largest route file) |
| `snapshot.js` | `/api/snapshot/*` | Location snapshot CRUD |

## Endpoints

### Location Resolution
```
GET  /api/location/resolve        - Geocode coords to city/state/timezone
POST /api/location/reverse        - Reverse geocode address to coords
GET  /api/location/ip             - IP-based location (debug/fallback only)
```

### Weather & Air Quality
```
GET  /api/location/weather        - Current weather + 6hr forecast
GET  /api/location/airquality     - AQI data
GET  /api/location/pollen         - Pollen count and allergen data
```

### User Session (No Location Data)
```
GET  /api/users/me                - Current user's session info (device, snapshot ref)
```
Note: Users table has NO location fields (2026-01-05). Location data lives in snapshots table.

### Snapshots
```
POST  /api/location/snapshot              - Save new snapshot
GET   /api/location/snapshots/:snapshotId - Get snapshot by ID
GET   /api/snapshot/:id                   - Get snapshot by ID (alias)
GET   /api/snapshot/latest                - Get latest snapshot for user
PATCH /api/location/snapshot/:snapshotId/enrich - Enrich existing snapshot with additional data
```

### Briefing Generation
```
POST /api/location/news-briefing  - Generate news briefing for location
```

## Data Flow (Updated Dec 2025)

```
GPS coords → /api/location/resolve
                    ↓
        ┌───────────────────────────────────┐
        │ 1. Check users table (device_id)  │
        │    ├─ MATCH + <100m? → REUSE      │
        │    └─ NO MATCH → check cache/API  │
        │                                   │
        │ 2. Check coords_cache (~11m)      │
        │    ├─ HIT → use cached address    │
        │    └─ MISS → call Google APIs     │
        │                                   │
        │ 3. Update users table             │
        └───────────────────────────────────┘
                    ↓
        Return: city, state, formattedAddress, timeZone, user_id
```

**Snapshot Creation:**
1. Client calls `/api/location/snapshot` with resolved data
2. Server can also pull from users table if client data missing (fallback)
3. Enriches with airport proximity, holiday detection
4. **2026-02-01:** Copies `market` from `driver_profiles.market` (for market-wide event discovery)
5. Stores complete context in snapshots table

**Market Field (2026-02-01):**
- Snapshots now include a `market` column (e.g., "Dallas-Fort Worth")
- Copied from `driver_profiles.market` at snapshot creation time
- Used by briefing service for market-wide event/news discovery
- Avoids repeated `us_market_cities` lookups during briefing generation

## Caching (Four-Tier)

| Tier | Table/Source | Precision | Use Case |
|------|--------------|-----------|----------|
| 1 | `users` | ~100m (haversine) | Same device, hasn't moved much |
| 2 | `coords_cache` | ~11cm (6 decimal) | Different device, same location |
| 3 | `markets` | City/suburb | Known market → pre-stored timezone |
| 4 | Google API | Exact | Cache miss, new location |

**Market Timezone Fast-Path (New Jan 2026):**
- 102 global markets with pre-stored timezones
- 3,333 city aliases for suburb/neighborhood matching
- Skips Google Timezone API for known markets (~200-300ms savings)
- Progressive matching: city+state → city-only → alias

**Benefits:**
- Users table lookup = fastest (device-specific, no API call)
- Coords cache = fast (shared across devices)
- Market lookup = fast (timezone only, no Google API)
- Google API = slowest (only when needed)

## Snapshot Reuse Logic (Updated 2026-01-31)

Snapshots have a 60-minute TTL for reuse, BUT city changes force a fresh snapshot:

```
User Request → Check existing snapshot
                     ↓
            ┌───────────────────────────────────┐
            │ 1. City changed?                  │
            │    YES → Create new snapshot      │
            │                                   │
            │ 2. Age < 60 min?                  │
            │    YES → Reuse snapshot           │
            │    NO  → Create new snapshot      │
            │                                   │
            │ 3. force=true?                    │
            │    YES → Create new snapshot      │
            └───────────────────────────────────┘
```

**Why This Matters:**
- Driver in Frisco sees Frisco events/traffic
- Driver moves to Dallas (within 60 min)
- OLD: Reused snapshot → stale Frisco data
- NEW: City change detected → fresh Dallas data

**Implementation (location.js lines 937-964):**
```javascript
const cityChanged = existingSnapshot.city?.toLowerCase() !== city?.toLowerCase() ||
                    existingSnapshot.state?.toLowerCase() !== state?.toLowerCase();

if (cityChanged) {
  // Create fresh snapshot for new city
}
```

## Connections

- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Uses:** `../../lib/location/geo.js` for distance calculations
- **Uses:** `../../lib/location/geocode.js` for forward geocoding
- **Uses:** Google Maps API (Geocoding, Weather, Air Quality)
- **Called by:** Client LocationContext on GPS update

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { snapshots, users, coords_cache, markets } from '../../../shared/schema.js';

// Location lib
import { haversineDistanceMeters } from '../../lib/location/geo.js';  // For 100m threshold check
import { geocodeAddress, getTimezoneForCoords } from '../../lib/location/geocode.js';
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';
// Note: reverseGeocode is in server/lib/venue/venue-address-resolver.js (venue-specific)

// Validation
import { snapshotMinimalSchema } from '../../validation/schemas.js';
import { validateBody } from '../../middleware/validate.js';

// Utils
import { validateIncomingSnapshot } from '../../util/validate-snapshot.js';
import { uuidOrNull } from '../../util/uuid.js';
```
