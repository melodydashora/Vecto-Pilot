# Scripts (`server/scripts/`)

## Purpose

Server-side utility scripts for maintenance and operations.

## Key Scripts

| Script | Purpose |
|--------|---------|
| `holiday-override.js` | Manage holiday override configuration |

## Usage

```bash
# Holiday override management
node server/scripts/holiday-override.js list
node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2026-01-02"
node server/scripts/holiday-override.js remove <id>
node server/scripts/holiday-override.js enable
node server/scripts/holiday-override.js disable
node server/scripts/holiday-override.js test
```

## Connections

- **Related:** `../config/holiday-override.json`
- **Used for:** Manual system configuration
