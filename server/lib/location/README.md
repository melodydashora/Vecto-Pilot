> **Last Verified:** 2026-01-10

# Location Module (`server/lib/location/`)

## Purpose

Location services including geocoding utilities, holiday detection, snapshot context, coordinate key generation, and data validation.

## Structure

```
location/
├── address-validation.js       # Address validation utilities
├── coords-key.js               # Canonical coordinate key generator (NEW 2026-01-10)
├── geo.js                      # Geocoding utilities (Haversine distance)
├── geocode.js                  # Google Geocoding API wrapper
├── get-snapshot-context.js     # Snapshot context builder (minimal + full)
├── getSnapshotTimeContext.js   # Time context extraction from snapshots
├── holiday-detector.js         # Holiday detection + overrides
├── index.js                    # Module barrel exports
├── validation-gates.js         # Location freshness checks
└── weather-traffic-validator.js # Weather/traffic validation
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `address-validation.js` | Address validation | `validateAddress()`, `normalizeAddress()` |
| `coords-key.js` | Coordinate key generator | `coordsKey()`, `parseCoordKey()`, `isValidCoordKey()` |
| `geo.js` | Distance calculation | `haversineKm()`, `haversineDistanceMeters()`, `haversineDistanceMiles()` |
| `geocode.js` | Google Geocoding API | `geocodeAddress()`, `reverseGeocode()` |
| `get-snapshot-context.js` | Context builder | `getSnapshotContext()`, `getFullSnapshot()` |
| `getSnapshotTimeContext.js` | Time context extraction | `getSnapshotTimeContext()` |
| `holiday-detector.js` | Holiday detection | `detectHoliday(city, state, date)` |
| `index.js` | Module barrel exports | All location exports |
| `validation-gates.js` | Freshness checks | `isLocationFresh()`, `isSnapshotValid()` |
| `weather-traffic-validator.js` | Data validation | `validateConditions()` |

## coords-key.js - Coordinate Key Generator (NEW 2026-01-10)

**Canonical module** consolidating 4 duplicate implementations:
- `server/api/location/location.js:13` - makeCoordsKey()
- `server/api/location/snapshot.js:23` - makeCoordsKey()
- `server/lib/venue/venue-enrichment.js:433` - getCoordsKey()
- `server/lib/venue/venue-utils.js:83` - generateCoordKey()

### GPS Precision

| Decimals | Accuracy | Use Case |
|----------|----------|----------|
| 4 | ~11 meters | **Too imprecise** - causes cache collisions |
| 6 | ~11 centimeters | **Required** - exact venue matching |
| 8 | ~1.1 millimeters | Overkill - wastes storage |

**Always use 6 decimals** for cache keys and venue deduplication.

### Usage

```javascript
import { coordsKey, parseCoordKey, isValidCoordKey } from '../location/coords-key.js';

// Generate coordinate key
const key = coordsKey(33.0812345, -96.8123456); // "33.081235_-96.812346"

// Parse key back to coordinates
const { lat, lng } = parseCoordKey("33.081235_-96.812346");

// Validate key format
if (isValidCoordKey(key)) {
  // Valid format and within valid lat/lng ranges
}
```

### Legacy Aliases

For backward compatibility, these aliases are exported but deprecated:
- `makeCoordsKey` - alias for `coordsKey`
- `getCoordsKey` - alias for `coordsKey`
- `generateCoordKey` - alias for `coordsKey`

**Used By:**
- `server/api/location/location.js` - coords_cache lookups
- `server/api/location/snapshot.js` - snapshot coordinate caching
- `server/lib/venue/venue-enrichment.js` - places_cache.coords_key
- `server/lib/venue/venue-utils.js` - venue deduplication

## geo.js - Distance Functions

The haversine functions calculate great-circle distance between coordinates:

```javascript
import { haversineDistanceMeters } from './geo.js';

// Check if user moved less than 100m (reuse threshold)
const distance = haversineDistanceMeters(newLat, newLng, oldLat, oldLng);
if (distance < 100) {
  // Reuse cached resolved address
}
```

**Available Functions:**
- `haversineDistanceMeters(lat1, lon1, lat2, lon2)` → meters
- `haversineDistanceKm(lat1, lon1, lat2, lon2)` → kilometers
- `haversineDistanceMiles(lat1, lon1, lat2, lon2)` → miles
- `haversineKm({lat, lng}, {lat, lng})` → kilometers (object form)

**Used By:**
- `server/api/location/location.js` - 100m threshold for users table reuse
- `server/lib/strategy/strategy-triggers.js` - Distance-based strategy triggers
- `server/lib/venue/event-proximity-boost.js` - Event proximity scoring
- `server/lib/external/faa-asws.js` - Airport distance calculation

## Usage

### Holiday Detection
```javascript
import { detectHoliday } from './holiday-detector.js';

const holiday = await detectHoliday('Austin', 'TX', new Date());
// Returns: 'Christmas' | 'Happy Holidays' | 'none'
```

### Snapshot Context
```javascript
import { getSnapshotContext, getFullSnapshot } from './get-snapshot-context.js';

// Minimal context (time/location for strategy)
const ctx = await getSnapshotContext(snapshotId);

// Full context (includes weather, air quality, coordinates)
const full = await getFullSnapshot(snapshotId);
```

## Holiday Override System

Manual holiday overrides via `server/config/holiday-override.json`:

```javascript
// Priority: Actual holiday > Override > Default greeting
// If superseded_by_actual: true, real holidays take precedence
// CLI: node server/scripts/holiday-override.js [list|add|remove|test]
```

## Connections

- **Imports from:** `../../db/`, `../../config/holiday-override.json`
- **Exported to:** `../ai/providers/`, `../strategy/`, `../../routes/location.js`

## External APIs

| API | Purpose | File |
|-----|---------|------|
| Gemini + Google Search | Holiday detection | `holiday-detector.js` |
| Google Geocoding | Address resolution | `geo.js` |
| Google Timezone | Timezone lookup | Used by routes/location.js |

## Validation Flow

```
Location data → validation-gates.js
    ├── isLocationFresh() - Check coordinates age
    ├── isSnapshotValid() - Check snapshot completeness
    └── weather-traffic-validator.js
        └── validateConditions() - Ensure weather/traffic data present
```

## Import Paths

```javascript
// From server/api/*/
import { coordsKey, parseCoordKey } from '../../lib/location/coords-key.js';
import { detectHoliday } from '../../lib/location/holiday-detector.js';
import { getSnapshotContext, getFullSnapshot } from '../../lib/location/get-snapshot-context.js';
import { haversineKm } from '../../lib/location/geo.js';

// From server/lib/*/
import { coordsKey } from '../location/coords-key.js';
import { detectHoliday } from '../location/holiday-detector.js';
import { getSnapshotContext } from '../location/get-snapshot-context.js';
```
