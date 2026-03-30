> **Last Verified:** 2026-01-06

# Library (`client/src/lib/`)

## Purpose

Core utility functions and shared libraries for the frontend.

## Files

| File | Purpose |
|------|---------|
| `daypart.ts` | Time-of-day classification (morning, afternoon, evening, night) |
| `queryClient.ts` | React Query client configuration + `apiRequest` helper |
| `utils.ts` | Utility functions including `cn()` for className merging |

## Usage

### Day Part Classification
```typescript
import { getDayPart } from '@/lib/daypart';

const part = getDayPart(); // "morning" | "afternoon" | "evening" | "night"
```

### API Requests
```typescript
import { apiRequest } from '@/lib/queryClient';

const data = await apiRequest('/api/strategy/123');
```

### Class Name Merging
```typescript
import { cn } from '@/lib/utils';

<div className={cn("base-class", isActive && "active-class")} />
```

## Connections

- **Used by:** All components that make API calls or need utilities
- **queryClient.ts** configures React Query for the entire app
