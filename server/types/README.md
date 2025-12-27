# Types (`server/types/`)

## Purpose

TypeScript type definitions for server-side code.

## Files

| File | Purpose |
|------|---------|
| `driving-plan.ts` | Driving plan and route types |

## Usage

```typescript
import type { DrivingPlan } from './types/driving-plan';

const plan: DrivingPlan = {
  // ...
};
```

## Note

Most types are defined in `shared/types/` for cross-platform use.

## Connections

- **Used by:** Server modules requiring driving plan types
- **Related:** `../shared/types/`
