# Tests (`tests/`)

## Purpose

Test suites for the application.

## Structure

| Folder | Purpose |
|--------|---------|
| `e2e/` | End-to-end Playwright tests |
| `eidolon/` | Eidolon framework tests |
| `gateway/` | Gateway server tests |
| `scripts/` | Test utility scripts |
| `triad/` | TRIAD pipeline tests |

## Commands

```bash
# Run all tests
npm run test

# Run unit tests only
npm run test:unit

# Run e2e tests only
npm run test:e2e

# Run with coverage
npm run test -- --coverage
```

## Connections

- **E2E:** Uses Playwright for browser testing
- **Unit:** Uses Jest for unit testing
