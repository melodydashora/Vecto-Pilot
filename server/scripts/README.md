# Scripts (`server/scripts/`)

## Purpose

Server-side utility scripts for maintenance and operations.

## Scripts

| Script | Purpose |
|--------|---------|
| `holiday-override.js` | Manage holiday override configuration |
| `db-doctor.js` | Database health checks and repairs |
| `seed-dfw-venues.js` | Seed DFW area venue data |
| `run-sql-migration.js` | Execute SQL migrations |
| `continuous-monitor.js` | Continuous system monitoring |
| `self-healing-monitor.js` | Self-healing system monitor |
| `test-gemini-search.js` | Test Gemini search functionality |
| `workspace-startup.sh` | Workspace initialization script |

## Usage

```bash
# Holiday override management
node server/scripts/holiday-override.js list
node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2025-01-02"
node server/scripts/holiday-override.js remove <id>
node server/scripts/holiday-override.js enable
node server/scripts/holiday-override.js disable
node server/scripts/holiday-override.js test

# Database operations
node server/scripts/db-doctor.js
node server/scripts/run-sql-migration.js

# Testing
node server/scripts/test-gemini-search.js
```

## Connections

- **Related:** `../config/holiday-override.json`
- **Used for:** Manual system configuration, database operations, testing
