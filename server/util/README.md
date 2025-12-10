# Utilities (`server/util/`)

## Purpose

General utility functions for server-side operations.

## Files

| File | Purpose |
|------|---------|
| `circuit.js` | Circuit breaker pattern implementation |
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
