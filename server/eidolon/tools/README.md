# Eidolon Tools (`server/eidolon/tools/`)

## Purpose

Diagnostic and database tools for the Eidolon Enhanced SDK.

## Files

| File | Purpose |
|------|---------|
| `sql-client.ts` | SQL query client for Eidolon database operations |

## SQL Client

Type-safe database query client:

```typescript
import { SQLClient } from './sql-client';

const client = new SQLClient();
const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
```

## Connections

- **Uses:** `../../db/pool.js` for shared database connection
- **Used by:** Eidolon core for workspace operations
