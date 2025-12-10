# Utilities (`server/util/`)

## Purpose

General utility functions for server-side operations.

## Files

| File | Purpose |
|------|---------|
| `circuit.js` | Circuit breaker pattern implementation |
| `eta.js` | Traffic-aware ETA and Haversine distance calculations |
| `uuid.js` | UUID generation utilities |
| `validate-snapshot.js` | Snapshot validation helpers |

## Usage

### Circuit Breaker
```javascript
import { CircuitBreaker } from './util/circuit.js';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000
});

const result = await breaker.call(() => apiCall());
```

### UUID
```javascript
import { generateUUID } from './util/uuid.js';
const id = generateUUID();
```

### ETA / Distance
```javascript
import { haversineMeters, etaMinutes, estimateNow } from './util/eta.js';

// Straight-line distance in meters
const distance = haversineMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.8044, lng: -122.2712 });

// Traffic-aware ETA
const eta = estimateNow(origin, destination, isRaining);
console.log(`${eta.minutes.toFixed(1)} min, ${(eta.roadMeters / 1000).toFixed(1)} km`);
```

**Haversine Functions:**

`eta.js` provides the base `haversineMeters()` function. For convenience wrappers, use `server/lib/location/geo.js`:

```javascript
// Preferred imports for most use cases
import { haversineDistanceMeters } from '../lib/location/geo.js';
import { haversineDistanceMiles } from '../lib/location/geo.js';
import { haversineKm } from '../lib/location/geo.js';
```

**Used for:**
- Location resolution: 100m threshold for users table reuse (`server/api/location/location.js`)
- Strategy triggers: Distance-based strategy regeneration
- Airport proximity: Distance to nearest airport
- Event proximity: Boost scores for nearby events

## Import Paths

```javascript
// From server/api/*/
import { uuidOrNull } from '../../util/uuid.js';
import { makeCircuit } from '../../util/circuit.js';
import { validateIncomingSnapshot, validateSnapshotV1 } from '../../util/validate-snapshot.js';

// From server/lib/*/
import { uuidOrNull } from '../util/uuid.js';
```

## Connections

- **Used by:** `server/api/location/`, `server/api/strategy/`, various lib modules
