> **Last Verified:** 2026-01-06

# Data

Runtime data storage for application state and caching.

## Structure

| Folder | Purpose |
|--------|---------|
| `context-snapshots/` | Cached context snapshots for debugging |

## Usage

This folder stores ephemeral runtime data that doesn't belong in the database.

## Notes

- Not committed to git (in .gitignore)
- Can be safely deleted to reset local state
- Recreated automatically by the application
