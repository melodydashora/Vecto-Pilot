# Location API (`server/api/location/`)

## Purpose

GPS processing, geocoding, weather, air quality, and snapshot management.

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
```

### Weather & Air Quality
```
GET  /api/location/weather        - Current weather + 6hr forecast
GET  /api/location/airquality     - AQI data
```

### User Location
```
GET  /api/users/me                - Current user's stored location
POST /api/users/location          - Update user location
```

### Snapshots
```
POST /api/location/snapshot       - Save new snapshot
GET  /api/snapshot/:id            - Get snapshot by ID
GET  /api/snapshot/latest         - Get latest snapshot for user
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
4. Stores complete context in snapshots table

## Caching (Three-Tier)

| Tier | Table | Precision | Use Case |
|------|-------|-----------|----------|
| 1 | `users` | ~100m (haversine) | Same device, hasn't moved much |
| 2 | `coords_cache` | ~11m (4 decimal) | Different device, same location |
| 3 | Google API | Exact | Cache miss, new location |

**Benefits:**
- Users table lookup = fastest (device-specific, no API call)
- Coords cache = fast (shared across devices)
- Google API = slowest (only when needed)

## Connections

- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Uses:** `../../lib/location/geo.js` for geocoding
- **Uses:** Google Maps API (Geocoding, Weather, Air Quality)
- **Called by:** Client LocationContext on GPS update

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { snapshots, users, coords_cache } from '../../../shared/schema.js';

// Location lib
import { geocode, reverseGeocode } from '../../lib/location/geo.js';
import { haversineDistanceMeters } from '../../lib/location/geo.js';  // For 100m threshold check
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';

// Validation
import { snapshotMinimalSchema } from '../../validation/schemas.js';
import { validateBody } from '../../middleware/validate.js';

// Utils
import { validateIncomingSnapshot } from '../../util/validate-snapshot.js';
import { uuidOrNull } from '../../util/uuid.js';
```
