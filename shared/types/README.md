> **Last Verified:** 2026-01-06

# Shared Types (`shared/types/`)

## Purpose

TypeScript type definitions shared between server and client.

## Files

| File | Purpose |
|------|---------|
| `action.ts` | User action tracking types |
| `ids.ts` | ID type aliases |
| `location.ts` | Location/coordinate types |
| `reco.ts` | Recommendation types |
| `snapshot.ts` | Snapshot data types |

## Usage

```typescript
// From server
import type { Snapshot } from '../../shared/types/snapshot';

// From client
import type { Location } from '@/../shared/types/location';
```

## Key Types

### Location (`location.ts`)
```typescript
interface Location {
  latitude: number;
  longitude: number;
}
```

### Snapshot (`snapshot.ts`)
```typescript
interface SnapshotData {
  id: string;
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  timezone: string;
  // ...
}
```

## See Also

- [`../schema.js`](../README.md) - Drizzle ORM schema (source of truth)
- [`../../client/src/types/`](../../client/src/types/README.md) - Client-specific types
- [`../../server/types/`](../../server/types/README.md) - Server-specific types
