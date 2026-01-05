# Database (`server/db/`)

## Purpose

Database connection management and Drizzle ORM configuration.

## Files

| File | Purpose |
|------|---------|
| `db-client.js` | Main database client export |
| `connection-manager.js` | Connection pool management |
| `pool.js` | PostgreSQL pool configuration |
| `drizzle.js` | Drizzle ORM setup |
| `drizzle-lazy.js` | Lazy Drizzle initialization |
| `rls-middleware.js` | Row-level security middleware |

## SQL Files

| File | Purpose |
|------|---------|
| `001_init.sql` | Initial schema creation |
| `002_seed_dfw.sql` | DFW area seed data |

### Migration Scripts (`sql/`)

| File | Purpose |
|------|---------|
| `2025-10-31_strategy_generic.sql` | Strategy table generalization |
| `2025-11-03_blocks_ready_notify.sql` | Blocks ready notification trigger |
| `2025-12-27_event_deactivation_fields.sql` | Event deactivation field additions |

## Usage

```javascript
import { db } from './db/db-client.js';

// Query example
const users = await db.select().from(users).where(eq(users.id, userId));
```

## Connection String

Uses `DATABASE_URL` environment variable (Replit built-in PostgreSQL).

## Connections

- **Schema:** `../../shared/schema.js`
- **Used by:** All route handlers and lib modules

## Import Paths

From different locations:

```javascript
// From server/api/*/ (nested routes)
import { db } from '../../db/drizzle.js';
import { getDb } from '../../db/drizzle-lazy.js';
import { getPoolStats } from '../../db/pool.js';
import { getAgentState } from '../../db/connection-manager.js';

// From server/lib/*/ (lib modules)
import { db } from '../db/drizzle.js';
```
