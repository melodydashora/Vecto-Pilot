> **Last Verified:** 2026-01-06

# Manual Migrations

One-off database scripts and fixes.

## Purpose

Scripts that are:
- Run manually by operators
- Not part of standard migration flow
- Used for data fixes or special operations

## Files

| File | Purpose |
|------|---------|
| `20251006_add_perf_indexes.sql` | Add performance indexes |
| `20251007_add_fk_cascade.sql` | Add foreign key cascades |
| `20251007_fk_cascade_fix.sql` | Fix foreign key cascade issues |

## Usage

```bash
# Run a manual script
psql $DATABASE_URL -f migrations/manual/script_name.sql
```

## Notes

- Document what each script does
- Include rollback instructions if applicable
- Mark scripts as "applied" after running

## See Also

- [migrations/](../) - Standard migrations
