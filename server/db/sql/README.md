> **Last Verified:** 2026-01-06

# SQL Migrations (`server/db/sql/`)

## Purpose

Raw SQL migration files for database schema changes that can't be expressed via Drizzle ORM.

## Files

| File | Date | Purpose |
|------|------|---------|
| `2025-10-31_strategy_generic.sql` | Oct 31, 2025 | Strategy table schema |
| `2025-11-03_blocks_ready_notify.sql` | Nov 3, 2025 | PostgreSQL NOTIFY for blocks ready |
| `2025-12-27_event_deactivation_fields.sql` | Dec 27, 2025 | Event deactivation tracking fields |

## Naming Convention

```
YYYY-MM-DD_descriptive_name.sql
```

## When to Use

Use raw SQL migrations for:
- PostgreSQL-specific features (NOTIFY/LISTEN, triggers)
- Complex data migrations
- Performance-critical schema changes
- Features not supported by Drizzle ORM

## Execution

These are typically run manually or via migration scripts:

```bash
# Example: Run via psql
psql $DATABASE_URL -f server/db/sql/2025-12-27_event_deactivation_fields.sql
```

## See Also

- [`../README.md`](../README.md) - Database connection
- [`/drizzle/`](../../../drizzle/README.md) - Drizzle-generated migrations
- [`/migrations/`](../../../migrations/README.md) - Migration tracking
