# Migrations

Manual database migration scripts.

## Structure

| Path | Purpose |
|------|---------|
| `*.sql` | Manual migration files |
| `manual/` | One-off migration scripts |

## Naming Convention

```
YYYYMMDD_description.sql   # Date-prefixed for manual migrations
00X_name.sql               # Numbered for sequential migrations
```

## Current Migrations

| File | Purpose |
|------|---------|
| `001_init.sql` | Initial schema setup |
| `002_memory_tables.sql` | MCP memory system tables |
| `003_rls_security.sql` | Row-Level Security policies |
| `004_jwt_helpers.sql` | JWT helper functions |
| `20251103_*` | Feature-specific migrations |

## Running Migrations

```bash
# Via npm script
npm run db:migrate

# Manually
psql $DATABASE_URL -f migrations/001_init.sql
```

## Manual vs Drizzle Migrations

| Folder | Use Case |
|--------|----------|
| `migrations/` | RLS policies, functions, triggers, one-off fixes |
| `drizzle/` | Schema changes (tables, columns, indexes) |

## See Also

- [drizzle/](../drizzle/) - Auto-generated Drizzle migrations
- [shared/schema.js](../shared/schema.js) - Drizzle schema
