# Location Module (`server/lib/location/`)

## Purpose

Location services including geocoding utilities, holiday detection, snapshot context, and data validation.

## Structure

```
location/
├── geo.js                      # Geocoding utilities (Haversine distance)
├── geocode.js                  # Google Geocoding API wrapper
├── get-snapshot-context.js     # Snapshot context builder (minimal + full)
├── holiday-detector.js         # Holiday detection + overrides
├── index.js                    # Module barrel exports
├── validation-gates.js         # Location freshness checks
└── weather-traffic-validator.js # Weather/traffic validation
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `geo.js` | Distance calculation | `haversineKm()`, `haversineDistanceMeters()`, `haversineDistanceMiles()` |
| `geocode.js` | Google Geocoding API | `geocodeAddress()`, `reverseGeocode()` |
| `get-snapshot-context.js` | Context builder | `getSnapshotContext()`, `getFullSnapshot()` |
| `holiday-detector.js` | Holiday detection | `detectHoliday(city, state, date)` |
| `index.js` | Module barrel exports | All location exports |
| `validation-gates.js` | Freshness checks | `isLocationFresh()`, `isSnapshotValid()` |
| `weather-traffic-validator.js` | Data validation | `validateConditions()` |

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
import { detectHoliday } from '../../lib/location/holiday-detector.js';
import { getSnapshotContext, getFullSnapshot } from '../../lib/location/get-snapshot-context.js';
import { haversineKm } from '../../lib/location/geo.js';

// From server/lib/*/
import { detectHoliday } from '../location/holiday-detector.js';
import { getSnapshotContext } from '../location/get-snapshot-context.js';
```
