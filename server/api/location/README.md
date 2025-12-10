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

## Data Flow

1. Client sends GPS coords
2. Server geocodes via Google Geocoding API
3. Fetches weather from Google Weather API
4. Creates snapshot linking all data
5. Returns enriched location data

## Caching

- `coords_cache` table - 4-decimal precision (~11m)
- Weather cached per request cycle
- Prevents duplicate API calls

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
import { getSnapshotContext } from '../../lib/location/snapshot/get-snapshot-context.js';

// Validation
import { snapshotMinimalSchema } from '../../validation/schemas.js';
import { validateBody } from '../../middleware/validate.js';

// Utils
import { validateIncomingSnapshot } from '../../util/validate-snapshot.js';
import { uuidOrNull } from '../../util/uuid.js';
```
