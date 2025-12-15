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
