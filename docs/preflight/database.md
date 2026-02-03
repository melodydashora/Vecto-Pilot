# Pre-flight: Database

Quick reference for database operations. Read before modifying any DB code.

## snapshot_id Linking Rule

**All data links to `snapshot_id`.** This is the moment-in-time anchor.

```javascript
// CORRECT - Always include snapshot_id
await db.insert(rankings).values({
  snapshot_id: snapshotId,  // Required
  ranking_id: rankingId,
  // ...
});

// WRONG - Missing snapshot_id
await db.insert(rankings).values({
  ranking_id: rankingId,  // Where's snapshot_id?
});
```

## Core Tables

| Table | Primary Key | Links To |
|-------|-------------|----------|
| `snapshots` | `snapshot_id` | users (user_id) |
| `strategies` | `id` | snapshots (snapshot_id) |
| `rankings` | `ranking_id` | snapshots (snapshot_id) |
| `ranking_candidates` | `id` | rankings (ranking_id) |
| `actions` | `action_id` | snapshots, rankings |
| `discovered_events` | `id` | venue_catalog (venue_id) |
| `venue_catalog` | `venue_id` | - (source of truth for venues) |

## Event Field Names (2026-01-10 Canonical Names)

**Always use canonical field names** - no fallbacks to legacy names:

| Canonical Field | Purpose | Format |
|-----------------|---------|--------|
| `event_start_date` | Event date | `YYYY-MM-DD` |
| `event_start_time` | Event time | `HH:MM` (24h) |
| `event_end_time` | End time | `HH:MM` (24h) - REQUIRED |
| `event_end_date` | Multi-day end | `YYYY-MM-DD` (defaults to start) |

**Legacy field names** (DO NOT use in new code):
- `event_date` -> Use `event_start_date`
- `event_time` -> Use `event_start_time`

See `server/lib/events/pipeline/types.js` for full type definitions.

## Sorting Convention

**Always `created_at DESC`** (newest first):

```javascript
// CORRECT
.orderBy(desc(snapshots.created_at))

// WRONG - oldest first
.orderBy(asc(snapshots.created_at))
```

## DO: Use Drizzle ORM

```javascript
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
```

## DON'T: Raw SQL (unless necessary)

```javascript
// Prefer Drizzle over raw SQL
// Raw SQL is acceptable for complex queries only
```

## Check Before Editing

- [ ] Does my insert include `snapshot_id`?
- [ ] Am I sorting by `created_at DESC`?
- [ ] Am I using Drizzle ORM, not raw SQL?
- [ ] Did I check `shared/schema.js` for table structure?
- [ ] Am I using canonical event field names? (`event_start_date`, `event_start_time`)
- [ ] For event data, did I check `server/lib/events/pipeline/types.js`?
