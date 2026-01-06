> **Last Verified:** 2026-01-06

# Eidolon Memory (`server/eidolon/memory/`)

## Purpose

PostgreSQL-backed memory persistence for Eidolon SDK state management.

## Files

| File | Purpose |
|------|---------|
| `pg.js` | PostgreSQL memory adapter (put, get, list, delete, compact) |
| `compactor.js` | Hourly cleanup job for expired memory entries |

## Functions (pg.js)

```javascript
import { memoryPut, memoryGet, memoryList, memoryDel, memoryCompact } from './pg.js';

// Store memory entry
await memoryPut({
  table: 'eidolon_memory',
  scope: 'project',
  key: 'last-analysis',
  userId: 'uuid',
  content: { data: '...' },
  ttlDays: 30
});

// Retrieve entry
const entry = await memoryGet({ table, scope, key, userId });

// List entries by scope
const entries = await memoryList({ table, scope, userId });

// Delete expired entries
await memoryCompact({ table });
```

## Compactor

Runs hourly to clean up expired memory entries:
- `assistant_memory` table
- `eidolon_memory` table

Started via `startMemoryCompactor(policy)` in Eidolon initialization.

## Connections

- **Uses:** `../../db/pool.js` for shared database connection
- **Used by:** Eidolon core for state persistence
- **Tables:** `assistant_memory`, `eidolon_memory`
