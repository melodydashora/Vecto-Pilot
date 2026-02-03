> **Last Verified:** 2026-02-01

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
| `import-market-cities.js` | **Import market cities from JSON/CSV** (2026-02-01) |
| `fix-market-names.js` | Fix market name mismatches from research file |

## Market Data Scripts

### import-market-cities.js (2026-02-01)

Import/update `us_market_cities` table from JSON or CSV files with field names that match the schema exactly.

```bash
# Preview changes (dry run)
node scripts/import-market-cities.js path/to/markets.json --dry-run

# Import from JSON
node scripts/import-market-cities.js path/to/markets.json

# Import from CSV with updates
node scripts/import-market-cities.js path/to/markets.csv --upsert
```

**Supported formats:**
- **JSON**: See `platform-data/uber/research-findings/market-template.json` for template
- **CSV**: Header row with: `state_abbr,state,city,market_name,region_type`

### fix-market-names.js

One-time script to update market names from the legacy research-intel.txt format (CSV with `State,City,Market_Anchor,Region_Type`).

```bash
node scripts/fix-market-names.js
```

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
