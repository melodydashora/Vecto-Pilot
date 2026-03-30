> **Last Verified:** 2026-01-06

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
| `20251103_add_strategy_notify.sql` | Strategy notification trigger |
| `20251209_drop_unused_briefing_columns.sql` | Drop unused briefing columns |
| `20251209_fix_strategy_notify.sql` | Fix strategy notification |
| `20251214_add_event_end_time.sql` | Add event end time column |
| `20251214_discovered_events.sql` | Discovered events table |
| `20251228_auth_system_tables.sql` | Authentication system tables |
| `20251228_drop_snapshot_user_device.sql` | Drop snapshot user device columns |
| `20251229_district_tagging.sql` | District tagging feature |

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
