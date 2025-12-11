# Shared (`shared/`)

## Purpose

Code shared between client and server.

## Files

| File | Purpose |
|------|---------|
| `schema.js` | Drizzle ORM schema (PostgreSQL tables) |
| `config.js` | Shared configuration utilities |
| `identity.ts` | Identity utilities |
| `ports.js` | Port configuration |

## Types

The `types/` subfolder contains shared TypeScript types.

## Schema

`schema.js` defines all database tables using Drizzle ORM:
- `users` - User location authority
- `snapshots` - Point-in-time context
- `strategies` - AI strategy outputs
- `briefings` - Real-time intelligence
- `rankings` - Venue recommendations
- `ranking_candidates` - Individual venues
- `feedback` - User feedback
- `actions` - User interactions
- `coords_cache` - Geocode cache

## Usage

```javascript
import { users, snapshots, strategies } from '../shared/schema.js';
```

## Import Paths

**Note:** The `shared/` folder is at project root, not inside `server/`.

```javascript
// From server/api/*/ (2 levels deep in server)
import { strategies, snapshots, rankings } from '../../../shared/schema.js';

// From server/lib/*/ (2 levels deep in server)
import { strategies, snapshots } from '../../shared/schema.js';

// From server/jobs/ (1 level deep in server)
import { strategies, snapshots } from '../../shared/schema.js';

// From gateway-server.js (project root)
import { users, snapshots } from './shared/schema.js';
```

**Common Mistake:** Using `../../shared/` from `server/api/*/` resolves to `server/shared/` (wrong folder). Use `../../../shared/` instead.

## Connections

- **Used by:** All server modules requiring DB access
- **Documentation:** [Database Schema](../docs/architecture/database-schema.md)
