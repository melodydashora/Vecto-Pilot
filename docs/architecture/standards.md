# Repository Standards & Hardening Protocol

**Status:** BINDING CONTRACT
**Effective:** 2026-01-10
**Enforcement:** CI Pipeline + Manual Review

This document defines mandatory standards for code, documentation, and operations. Violations block merges.

---

## 1. Database Schema Standards

### 1.1 Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Tables | `snake_case`, plural | `snapshots`, `ranking_candidates` |
| Columns | `snake_case` | `created_at`, `snapshot_id` |
| Foreign Keys | `<referenced_entity>_id` | `user_id`, `snapshot_id` |
| Boolean columns | `is_` or `has_` prefix | `is_active`, `has_coordinates` |
| Timestamps | `*_at` suffix, `timestamptz` | `created_at`, `updated_at` |

### 1.2 ISO Code Fields (Semantic Rules)

| Field | Standard | Format | Example |
|-------|----------|--------|---------|
| `country_code` | ISO 3166-1 alpha-2 | 2 uppercase letters | `US`, `GB`, `JP` |
| `timezone` | IANA TZ Database | Full string | `America/Chicago`, `Europe/London` |
| `currency_code` | ISO 4217 | 3 uppercase letters | `USD`, `EUR`, `GBP` |
| `language_code` | ISO 639-1 | 2 lowercase letters | `en`, `es`, `ja` |

### 1.3 Timestamp Rules

```sql
-- CORRECT: All timestamps in UTC with timezone
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

-- WRONG: Local time or no timezone
created_at TIMESTAMP  -- Missing timezone!
```

### 1.4 Required Columns

Every table MUST have:
- Primary key (preferably UUID)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

---

## 2. Single Source of Truth

### 2.1 Database Schema Documentation

**Canonical File:** `docs/DATABASE_SCHEMA.md`

**Rules:**
1. Generated automatically via `scripts/generate-schema-docs.js`
2. NEVER edit manually - always regenerate
3. CI fails if generation produces git diff (prevents drift)

**Regeneration Command:**
```bash
node scripts/generate-schema-docs.js
```

### 2.2 Source of Truth Hierarchy

| Data Type | Authoritative Source | NOT Authoritative |
|-----------|---------------------|-------------------|
| DB Schema | `shared/schema.js` | Any markdown docs |
| API Contracts | Route handlers | README descriptions |
| Model Config | `server/lib/ai/model-registry.js` | Inline comments |
| Feature Flags | Environment variables | Code comments |

---

## 3. Comment Standards

### 3.1 Truth Statements Only

Comments MUST be factual truth statements. No speculative language.

```javascript
// WRONG - Speculative
// This should cache the result for 5 minutes
// This might help with performance

// CORRECT - Factual
// Caches result in placesMemoryCache with 6-hour TTL (see CACHE_TTL_MS)
// Returns null if timezone is missing (per NO FALLBACKS rule in CLAUDE.md)
```

### 3.2 Cache Claims Must Be Verifiable

Any comment claiming caching behavior MUST reference:
- The actual cache variable/function
- The TTL or invalidation logic
- A test that verifies the behavior

```javascript
// WRONG - Unverifiable claim
// Results are cached for performance

// CORRECT - Verifiable
// Cached in placesMemoryCache (Map) with CACHE_TTL_MS = 6 hours
// See tests/venue/caching.test.js for verification
```

### 3.3 Date-Stamped Changes

Major changes require inline comments with date and reason:

```javascript
// 2026-01-10: Renamed event_date → event_start_date for symmetric naming
// 2026-01-07: Removed timezone fallback per NO FALLBACKS rule
```

---

## 4. Logging Standards

### 4.1 Required Log Fields

Every significant operation MUST log with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `snapshot_id` | UUID | Current snapshot context |
| `user_id` | UUID | Authenticated user |
| `correlation_id` | UUID | Request trace ID |
| `phase` | string | Workflow phase (e.g., `snapshot_ingest`, `strategy_generate`) |
| `duration_ms` | number | Operation duration |
| `source` | string | Module/file name |

### 4.2 Log Format

```javascript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  phase: 'strategy_generate',
  snapshot_id: snapshotId,
  user_id: userId,
  correlation_id: reqId,
  duration_ms: Date.now() - startTime,
  source: 'strategy-generator.js',
  message: 'Strategy generation complete'
}));
```

### 4.3 AI Model Logging

Every LLM call MUST log effective configuration:

```javascript
console.log({
  phase: 'llm_call',
  model_id: 'claude-opus-4-6-20260201',
  role: 'STRATEGY_CORE',
  reasoning_effort: 'high',  // or thinking_level for Gemini
  temperature: 0,            // if applicable
  max_tokens: 32000,
  snapshot_id,
  correlation_id
});
```

---

## 5. Function Deduplication

### 5.1 No Duplicate Exports

Each concept MUST have exactly ONE exported function. Duplicates are CI failures.

**Currently Known Duplicates (TO BE FIXED):**

| Concept | Files | Action |
|---------|-------|--------|
| Coords key generation | location.js, snapshot.js, venue-enrichment.js, venue-utils.js | Consolidate to `server/lib/location/coords-key.js` |
| isOpen calculation | venue-enrichment.js, venue-utils.js | Rename to disambiguate signatures |

### 5.2 Import Pattern

```javascript
// CORRECT - Single source
import { coordsKey } from '../lib/location/coords-key.js';

// WRONG - Local reimplementation
function makeCoordsKey(lat, lng) { ... }  // Duplicate!
```

---

## 6. LLM Adapter Enforcement

### 6.1 All LLM Calls Through Adapter

Production code MUST use the adapter pattern:

```javascript
// CORRECT
import { callModel } from '../lib/ai/adapters/index.js';
const result = await callModel('STRATEGY_CORE', { system, user });

// WRONG - Direct API call
const response = await fetch('https://api.openai.com/v1/chat/completions', ...);
```

### 6.2 Exceptions

Only these are allowed to call LLM APIs directly:
- `server/lib/ai/adapters/*.js` - The adapters themselves
- `server/api/chat/realtime.js` - WebSocket protocol requires direct connection
- `tests/**/*.js` - Test mocks

---

## 7. Documentation Drift Prevention

### 7.1 DOC_DISCREPANCIES.md

**File:** `docs/DOC_DISCREPANCIES.md`

When code and docs contradict:
1. Add entry to DOC_DISCREPANCIES.md
2. Trust the CODE (not docs)
3. Fix docs within 24 hours
4. Remove from discrepancies list

### 7.2 Review Queue Protocol

All documentation changes flow through:
1. `docs/review-queue/pending.md` - Flagged items
2. `docs/review-queue/YYYY-MM-DD.md` - Daily analysis
3. `docs/reviewed-queue/CHANGES.md` - Historical record

---

## 8. CI Enforcement

### 8.1 Required Checks

| Check | Script | Failure Condition |
|-------|--------|-------------------|
| Schema docs drift | `scripts/generate-schema-docs.js` | Non-empty git diff |
| Standards compliance | `scripts/check-standards.js` | Any violation |
| Type checking | `npm run typecheck` | TypeScript errors |
| Linting | `npm run lint` | ESLint errors |
| Tests | `npm run test` | Test failures |

### 8.2 check-standards.js Checks

1. **Snake case enforcement** - All DB columns use snake_case
2. **ISO code suffixes** - Country fields use `_code` suffix
3. **Duplicate function detection** - No exported duplicates
4. **Cache claim verification** - Comments claiming cache have backing code
5. **Direct LLM URL detection** - No api.openai.com outside adapters
6. **Precision check** - No toFixed(4) or toFixed(5) for coordinates

---

## 9. Migration Protocol

### 9.1 Breaking vs Non-Breaking

| Change Type | Protocol |
|-------------|----------|
| Add column | Non-breaking: Add with DEFAULT or NULL |
| Rename column | Non-breaking: Add new, backfill, update code, then drop old |
| Remove column | Breaking: Requires migration plan |
| Change type | Breaking: Requires migration plan |

### 9.2 Country Code Migration (In Progress)

**Status:** HIGH PRIORITY

**Affected Tables:**
- `snapshots.country` → Add `country_code`
- `venue_catalog.country` → Add `country_code`
- `driver_profiles.country` → Add `country_code`

**Migration Steps:**
1. Add `country_code CHAR(2)` columns
2. Backfill: `UPDATE ... SET country_code = CASE WHEN country = 'USA' THEN 'US' ... END`
3. Update code to read/write new columns
4. Validate data integrity
5. (Future) Drop legacy `country` columns

---

## 10. Enforcement Summary

| Violation | Consequence |
|-----------|-------------|
| Direct LLM API call | CI failure |
| Duplicate exported function | CI failure |
| Schema doc drift | CI failure |
| Missing required log fields | Code review rejection |
| Speculative comments | Code review rejection |
| Manual DATABASE_SCHEMA.md edit | Automatic revert |

---

## References

- `CLAUDE.md` - Project rules and constraints
- `docs/preflight/standards.md` - Quick reference card
- `scripts/check-standards.js` - Automated enforcement
- `scripts/generate-schema-docs.js` - Schema doc generator
