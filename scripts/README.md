# Scripts (`scripts/`)

## Purpose

Build and development utility scripts.

## Key Scripts

| Script | Purpose |
|--------|---------|
| `start-replit.js` | Replit-specific startup script |

## Usage

Most scripts are run via npm:

```bash
npm run dev        # Development server
npm run build      # Production build
npm run db:push    # Push schema changes
```

## Connections

- **Called by:** `package.json` scripts
- **Related:** `server/scripts/` for server-specific scripts
