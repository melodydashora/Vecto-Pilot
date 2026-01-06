> **Last Verified:** 2026-01-06

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
| `load-market-research.js` | Load market research data from files |
| `memory-cli.mjs` | CLI for memory system operations |
| `seed-market-intelligence.js` | Seed market intelligence data |
| `analyze-data-flow.js` | Analyze application data flow |
| `generate-schema-docs.js` | Generate schema documentation |
| `generate-schema-docs.sh` | Schema docs generation shell script |
| `resolve-venue-addresses.js` | Resolve venue addresses via geocoding |
| `test-event-dedup.js` | Test event deduplication logic |
| `test-news-fetch.js` | Test news fetching functionality |

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
