# Standards Pre-flight Card

Quick reference for repo standards. Full details: `docs/architecture/standards.md`

---

## Database Naming

```
Tables:     snake_case, plural     → snapshots, ranking_candidates
Columns:    snake_case             → created_at, snapshot_id
FKs:        <entity>_id            → user_id, snapshot_id
Booleans:   is_* or has_*          → is_active, has_coordinates
Timestamps: *_at, timestamptz UTC  → created_at, updated_at
```

## ISO Codes

```
country_code  ISO 3166-1 alpha-2   → 'US', 'GB', 'JP' (NOT 'USA')
timezone      IANA TZ string       → 'America/Chicago' (NOT 'CST')
currency_code ISO 4217             → 'USD', 'EUR'
```

## Comments - Truth Only

```javascript
// WRONG
// This should cache for 5 minutes
// This might improve performance

// CORRECT
// Cached in placesMemoryCache with CACHE_TTL_MS = 6 hours
// 2026-01-10: Renamed for symmetric naming (see PR #123)
```

## Required Log Fields

```javascript
{
  snapshot_id,      // Current context
  user_id,          // Authenticated user
  correlation_id,   // Request trace
  phase,            // 'snapshot_ingest', 'strategy_generate'
  duration_ms,      // Operation time
  source            // 'strategy-generator.js'
}
```

## AI Model Logging

```javascript
// Every LLM call MUST log:
{
  phase: 'llm_call',
  model_id: 'claude-opus-4-6-20260201',
  role: 'STRATEGY_CORE',
  reasoning_effort: 'high',
  snapshot_id, correlation_id
}
```

## LLM Calls - Adapter Only

```javascript
// CORRECT
import { callModel } from '../lib/ai/adapters/index.js';
await callModel('STRATEGY_CORE', { system, user });

// WRONG - Direct API
await fetch('https://api.openai.com/...');
```

## No Duplicate Functions

```javascript
// ONE function per concept
import { coordsKey } from '../lib/location/coords-key.js';

// NEVER reimplement locally
function makeCoordsKey(lat, lng) { ... }  // ❌ Duplicate!
```

## GPS Precision

```javascript
// CORRECT - 6 decimals (~11cm)
lat.toFixed(6)

// WRONG - 4 decimals (~11m)
lat.toFixed(4)
```

## CI Checks

| Check | Command |
|-------|---------|
| Schema docs | `node scripts/generate-schema-docs.js` |
| Standards | `node scripts/check-standards.js` |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm run test` |

## Doc Drift Protocol

1. Code and docs contradict? → Trust CODE
2. Add to `docs/DOC_DISCREPANCIES.md`
3. Fix docs within 24 hours
4. Remove from discrepancies

## Quick Validation

```bash
# Before committing
npm run lint && npm run typecheck
node scripts/check-standards.js
node scripts/generate-schema-docs.js && git diff --exit-code docs/DATABASE_SCHEMA.md
```
