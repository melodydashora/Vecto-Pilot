> **Last Verified:** 2026-01-09

# Tests (`tests/`)

## Purpose

Test suites for the application.

## Structure

| Folder/File | Purpose |
|-------------|---------|
| `e2e/` | End-to-end Playwright tests |
| `eidolon/` | Eidolon framework tests |
| `events/` | ETL pipeline integration tests |
| `gateway/` | Gateway server tests |
| `scripts/` | Test utility scripts |
| `triad/` | TRIAD pipeline tests |

## Root Test Files

| File | Purpose |
|------|---------|
| `auth-token-validation.test.js` | Auth token validation tests |
| `blocksApi.test.js` | Blocks API endpoint tests |
| `coach-schema.test.js` | AI Coach schema validation tests |
| `coach-validation.test.js` | AI Coach input validation tests |
| `schema-validation.test.js` | Schema validation tests |
| `snapshot-ownership-event.test.ts` | Snapshot ownership and event tests |
| `phase-c-infrastructure.js` | Infrastructure phase tests |
| `run-all-phases.js` | Test runner for all phases |
| `run-all-tests.js` | Master test runner |
| `verify-startup.sh` | Startup verification script |

## Documentation

| File | Purpose |
|------|---------|
| `README-BLOCKS.md` | Block system test documentation |

## Commands

```bash
# Run all tests
npm run test

# Run unit tests only
npm run test:unit

# Run e2e tests only
npm run test:e2e

# Run ETL pipeline tests
node tests/events/pipeline.test.js

# Run with coverage
npm run test -- --coverage
```

## Connections

- **E2E:** Uses Playwright for browser testing
- **Unit:** Uses Jest for unit testing
