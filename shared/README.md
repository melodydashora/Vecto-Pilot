> **Last Verified:** 2026-01-06

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
- `users` - Session tracking (NO location data)
- `snapshots` - Point-in-time context
- `strategies` - AI strategy outputs
- `briefings` - Real-time intelligence
- `rankings` - Venue recommendations
- `ranking_candidates` - Individual venues
- `discovered_events` - **AI-discovered events** (multi-model search)
- `markets` - **Global markets** with pre-stored timezones (102 markets, 3,333 aliases)
- `feedback` - User feedback
- `actions` - User interactions
- `coords_cache` - Geocode cache (6-decimal precision)

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
  is_active: boolean("is_active").default(true),      // False if deactivated
  deactivation_reason: text("deactivation_reason"),   // event_ended, incorrect_time, etc.
  deactivated_at: timestamp("deactivated_at"),        // When deactivated
  deactivated_by: text("deactivated_by"),             // ai_coach or user_id
  // ...
});
```

**Deduplication**: Uses MD5 hash of `normalize(title + venue + date + city)` to prevent duplicates across sources.

**Deactivation**: Events can be marked inactive by AI Coach or users. Deactivated events are filtered out of Map tab displays but kept in database for audit.

See [Event Discovery Architecture](../docs/architecture/event-discovery.md) for full documentation.

### markets Table

Stores 102 global rideshare markets with pre-stored timezones to skip Google Timezone API:

```javascript
export const markets = pgTable("markets", {
  market_slug: text("market_slug").primaryKey(),           // "dfw-metro", "london-uk"
  market_name: text("market_name").notNull(),              // "DFW Metro", "London"
  primary_city: text("primary_city").notNull(),            // "Dallas", "London"
  state: text("state").notNull(),                          // "TX", "England"
  country_code: varchar("country_code", { length: 2 }),    // "US", "GB"
  timezone: text("timezone").notNull(),                    // "America/Chicago", "Europe/London"
  primary_airport_code: text("primary_airport_code"),      // "DFW", "LHR"
  secondary_airports: jsonb("secondary_airports"),         // ["DAL", "AFW"]
  city_aliases: jsonb("city_aliases"),                     // ["Frisco", "Plano", "Irving", ...]
  has_uber: boolean("has_uber").default(true),
  has_lyft: boolean("has_lyft").default(true),
  is_active: boolean("is_active").default(true),
  // ...
});
```

**Coverage:** 31 US markets + 71 international markets with 3,333 city aliases.

**Usage in location.js:** When resolving GPS coordinates, the system checks the markets table first. If the city matches a known market (via `primary_city` or `city_aliases`), the pre-stored timezone is used instead of calling Google Timezone API.

See [server/scripts/README.md](../server/scripts/README.md) for seeding documentation.

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
