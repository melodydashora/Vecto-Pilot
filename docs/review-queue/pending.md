# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## How to Use This File

1. Review each flagged item below
2. Check if the referenced doc needs updating
3. Update the doc if needed
4. Change status from `PENDING` to `REVIEWED`
5. Extract rules to `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md`
6. Delete completed items from this file

## Status Legend

| Status | Meaning |
|--------|---------|
| `PENDING` | Needs review |
| `REVIEWED` | Done - extract rules, then delete |
| `DEFERRED` | Will review later |

---

## 2026-01-05 Codebase Audit Findings

**Health Score: 92/100 (Excellent)**

### Security Issues

| Issue | Severity | Status |
|-------|----------|--------|
| JWT_SECRET fallback mismatch (auth.js vs location.js) | HIGH | FIXED |
| `qs` npm package vulnerability | HIGH | FIXED |
| `esbuild` vulnerabilities (via drizzle-kit) | MODERATE | FIXED (npm override) |
| `resolveVenueAddressString` deprecated (no callers) | LOW | REMOVED |

### Confirmed Working

- Venue Consolidation (venue_catalog unified)
- Highlander Session Model (one session per user)
- PostgreSQL Advisory Locks (horizontal scaling ready)
- Gemini 3 adapter upgraded (@google/genai SDK)
- Timezone-aware event filtering
- BarsTable trusts server's isOpen calculation
- Event deduplication (similar name/address/time grouping)

---

## Currently Pending

### High Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | New tables: `us_market_cities`, `market_intel` | PENDING |
| `docs/preflight/database.md` | New tables need documentation | PENDING |
| `docs/architecture/auth-system.md` | Auth changes (CASCADE fix, JWT consistency) | PENDING |

### Medium Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/api-reference.md` | New endpoints: `/for-location`, `/markets-dropdown`, `/add-market` | PENDING |
| `docs/preflight/location.md` | Venue enrichment changes (500m radius, district tagging) | PENDING |

### Low Priority (Deferred)

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/client-structure.md` | Minor component changes | DEFERRED |
| `docs/architecture/server-structure.md` | Background job changes | DEFERRED |

---

## Recently Completed (Move to reviewed-queue)

> **Note:** Items below are complete. Extract rules to `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md` then delete.

*No items pending cleanup.*

---
