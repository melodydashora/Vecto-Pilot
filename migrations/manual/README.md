# Manual Migrations

One-off database scripts and fixes.

## Purpose

Scripts that are:
- Run manually by operators
- Not part of standard migration flow
- Used for data fixes or special operations

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
