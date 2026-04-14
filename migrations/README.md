> **Last Updated:** 2026-04-14

# Migrations

## Migration Policy

| Aspect | Policy |
|--------|--------|
| **Canonical schema** | `shared/schema.js` (Drizzle ORM — all tables, columns, indexes) |
| **Standard path** | Drizzle-managed migrations via `npm run db:migrate` (output in `drizzle/`) |
| **Exception path** | Targeted direct SQL when `drizzle-kit push` risks global drift |
| **Exception rule** | Every direct-SQL exception MUST be logged in `docs/review-queue/pending.md` and backfilled into migration history |

For the current exceptions table (direct-SQL changes pending prod deployment), see [DB_SCHEMA.md §13](../docs/architecture/DB_SCHEMA.md#13-migrations).

## Directory Structure

| Path | Purpose |
|------|---------|
| `migrations/*.sql` | Manual migrations: RLS policies, triggers, functions, one-off fixes |
| `drizzle/` | Auto-generated Drizzle migrations (schema changes) |
| `shared/schema.js` | Single source of truth for all table definitions |
| `drizzle.config.js` | Drizzle Kit configuration (points to shared/schema.js) |

## Running Migrations

```bash
# Standard path (Drizzle-managed schema changes)
npm run db:migrate

# Manual migrations (RLS, triggers, one-off fixes)
psql $DATABASE_URL -f migrations/<filename>.sql
```

## Naming Convention

```
YYYYMMDD_description.sql   # Date-prefixed for manual migrations
00X_name.sql               # Numbered for sequential bootstrap migrations
```

## When to Use Direct SQL vs Drizzle

| Scenario | Use |
|----------|-----|
| New table, column, index | `drizzle-kit push` or `drizzle-kit generate` |
| RLS policy, trigger, function | Manual SQL in `migrations/` |
| Surgical column add to avoid touching unrelated constraints | Direct SQL (log in pending.md) |
| Emergency prod fix | Direct SQL (log in pending.md, backfill later) |

## See Also

- [DB_SCHEMA.md](../docs/architecture/DB_SCHEMA.md) — Canonical schema documentation
- [shared/schema.js](../shared/schema.js) — Drizzle schema definitions
- [drizzle/](../drizzle/) — Auto-generated Drizzle migration files
