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
- `discovered_events` - **AI-discovered events** (multi-model search)
- `feedback` - User feedback
- `actions` - User interactions
- `coords_cache` - Geocode cache

### discovered_events Table

Stores events found by multi-model AI search (SerpAPI, GPT-5.2, Gemini, Claude, Perplexity):

```javascript
export const discovered_events = pgTable("discovered_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  venue_name: text("venue_name"),
  address: text("address"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  event_date: text("event_date").notNull(),   // YYYY-MM-DD
  event_time: text("event_time"),              // "7:00 PM"
  event_end_time: text("event_end_time"),      // "10:00 PM"
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  category: text("category").notNull().default('other'),
  expected_attendance: text("expected_attendance").default('medium'),
  source_model: text("source_model").notNull(),  // SerpAPI, GPT-5.2, etc.
  event_hash: text("event_hash").notNull().unique(),  // Deduplication key
  // ...
});
```

**Deduplication**: Uses MD5 hash of `normalize(title + venue + date + city)` to prevent duplicates across sources.

See [Event Discovery Architecture](../docs/architecture/event-discovery.md) for full documentation.

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
