> **Last Updated:** 2026-04-14

# Database (`server/db/`)

Database connection management and Drizzle ORM client. For schema documentation, see [DB_SCHEMA.md](../../docs/architecture/DB_SCHEMA.md). For migration policy, see [migrations/README.md](../../migrations/README.md).

## Files

| File | Purpose |
|------|---------|
| `drizzle.js` | Drizzle ORM client (primary import) |
| `drizzle-lazy.js` | Lazy-initialized Drizzle client |
| `db-client.js` | Legacy client export |
| `pool.js` | PostgreSQL pool configuration |
| `connection-manager.js` | Connection pool lifecycle |
| `rls-middleware.js` | Row-level security middleware |

## Usage

```javascript
// From server/api/*/ (route handlers)
import { db } from '../../db/drizzle.js';
import { users, snapshots } from '../../../shared/schema.js';

const result = await db.select().from(snapshots).where(eq(snapshots.user_id, userId));
```

## Connection

Uses `DATABASE_URL` environment variable (Replit-managed PostgreSQL). Schema defined in `shared/schema.js`.
