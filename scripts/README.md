# Scripts (`scripts/`)

## Purpose

Build, development, and operational utility scripts.

## Key Scripts

| Script | Purpose |
|--------|---------|
| `start-replit.js` | Replit-specific startup script |
| `seed-dev.js` | Seed development database |
| `prebuild-check.js` | Pre-build validation |
| `make-jwks.mjs` | Generate JWKS for JWT auth |
| `sign-token.mjs` | Sign JWT tokens |
| `create-all-tables.sql` | Database table creation SQL |
| `populate-market-data.js` | Populate market data |
| `import-platform-data.js` | Import platform data |

## Usage

Most scripts are run via npm:

```bash
npm run dev        # Development server
npm run build      # Production build
npm run db:push    # Push schema changes
npm run seed:dev   # Seed development data
```

## Connections

- **Called by:** `package.json` scripts
- **Related:** `server/scripts/` for server-specific scripts
