# Utils (`client/src/utils/`)

## Purpose

Helper functions specific to application features.

## Files

| File | Purpose |
|------|---------|
| `co-pilot-helpers.ts` | Co-Pilot specific utilities (auth, logging, data transforms) |

## Usage

```typescript
import {
  getAuthHeaders,
  formatVenueDistance,
  logUserAction
} from '@/utils/co-pilot-helpers';

// Get auth headers for API calls
const headers = getAuthHeaders();

// Format distance for display
const display = formatVenueDistance(1.5); // "1.5 mi"
```

## Connections

- **Used by:** `co-pilot.tsx`, `BarsTable.tsx`, `FeedbackModal.tsx`

## Note

General utilities like `cn()` are in `client/src/lib/utils.ts`.
This folder contains feature-specific helpers.
