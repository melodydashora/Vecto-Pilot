> **Last Verified:** 2026-01-06

# Schema

JSON schema definitions for validation.

## Files

| File | Purpose |
|------|---------|
| `plan.schema.json` | Schema for plan mode output files |

## Usage

Schemas are used for:
- Validating configuration files
- IDE autocompletion support
- Documentation generation

## Note

The primary database schema is in `shared/schema.js` using Drizzle ORM.
This folder contains auxiliary JSON schemas for other purposes.

## See Also

- [shared/schema.js](../shared/schema.js) - Database schema (Drizzle ORM)
- [docs/architecture/database-schema.md](../docs/architecture/database-schema.md) - Schema documentation
