# Location Module (`server/lib/location/`)

## Purpose

Location services including geocoding utilities, holiday detection, snapshot context, and data validation.

## Structure

```
location/
├── geo.js                      # Geocoding utilities
├── holiday-detector.js         # Holiday detection + overrides
├── validation-gates.js         # Location freshness checks
├── weather-traffic-validator.js # Weather/traffic validation
└── snapshot/
    └── get-snapshot-context.js # Snapshot context builder
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `geo.js` | Geocoding utilities | `geocode()`, `reverseGeocode()` |
| `holiday-detector.js` | Holiday detection | `detectHoliday(city, state, date)` |
| `validation-gates.js` | Freshness checks | `isLocationFresh()`, `isSnapshotValid()` |
| `weather-traffic-validator.js` | Data validation | `validateConditions()` |
| `snapshot/get-snapshot-context.js` | Context builder | `getSnapshotContext(snapshotId)` |

## Usage

### Holiday Detection
```javascript
import { detectHoliday } from './holiday-detector.js';

const holiday = await detectHoliday('Austin', 'TX', new Date());
// Returns: 'Christmas' | 'Happy Holidays' | 'none'
```

### Snapshot Context
```javascript
import { getSnapshotContext } from './snapshot/get-snapshot-context.js';

const ctx = await getSnapshotContext(snapshotId);
// Returns: { city, state, weather, air, timezone, local_iso, ... }
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
import { getSnapshotContext } from '../../lib/location/snapshot/get-snapshot-context.js';
import { geocode, reverseGeocode } from '../../lib/location/geo.js';

// From server/lib/*/
import { detectHoliday } from '../location/holiday-detector.js';
import { getSnapshotContext } from '../location/snapshot/get-snapshot-context.js';
```
