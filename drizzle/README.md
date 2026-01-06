> **Last Verified:** 2026-01-06

# Drizzle Migrations

Auto-generated database migrations from Drizzle Kit.

## Structure

| Path | Purpose |
|------|---------|
| `*.sql` | Migration SQL files |
| `meta/` | Migration metadata and snapshots |

## Migration Files

Files are named with sequential numbers and random names:
- `0002_freezing_shiva.sql`
- `0003_bouncy_cobalt_man.sql`
- etc.

## Commands

```bash
# Generate new migration from schema changes
npx drizzle-kit generate

# Push schema directly (development only)
npm run db:push

# View migration status
npx drizzle-kit status
```

## Workflow

1. Modify `shared/schema.js`
2. Run `npx drizzle-kit generate`
3. Review generated SQL
4. Run `npm run db:push` to apply

## Notes

- Migrations are auto-generated - do not edit manually
- For manual SQL, use `migrations/` folder instead
- `meta/` folder tracks migration state

## See Also

- [shared/schema.js](../shared/schema.js) - Source schema
- [migrations/](../migrations/) - Manual migrations
- [drizzle.config.js](../drizzle.config.js) - Drizzle configuration
