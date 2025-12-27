# Test Scripts (`tests/scripts/`)

## Purpose

Utility scripts for test setup and validation.

## Files

| File | Purpose |
|------|---------|
| `preflight-check.js` | Pre-test environment validation |
| `smoke-test.js` | Quick API smoke test |
| `toggle-rls.js` | Enable/disable Row Level Security for tests |

## Usage

```bash
# Run preflight checks before tests
node tests/scripts/preflight-check.js

# Quick smoke test of core endpoints
node tests/scripts/smoke-test.js

# Toggle RLS for testing
node tests/scripts/toggle-rls.js enable
node tests/scripts/toggle-rls.js disable
```
