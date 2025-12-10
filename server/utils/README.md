# Utils (`server/utils/`)

## Purpose

Additional utility functions (separate from `util/`).

## Files

| File | Purpose |
|------|---------|
| `eta.js` | Estimated time of arrival calculations |

## Usage

```javascript
import { calculateETA } from './utils/eta.js';

const eta = calculateETA({
  distance: 5.2,
  trafficMultiplier: 1.3
});
```

## Note

This folder is separate from `server/util/`. Consider consolidating.

## Connections

- **Used by:** Route handlers for ETA display
