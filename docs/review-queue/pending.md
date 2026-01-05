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

## Currently Pending

### High Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | New tables: `us_market_cities`, `market_intel` | PENDING |
| `docs/preflight/database.md` | New tables need documentation | PENDING |

### Medium Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/api-reference.md` | New endpoints: `/for-location`, `/markets-dropdown`, `/add-market` | PENDING |

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

## Archive Reference

For completed work and extracted rules, see:
- `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md` - Actionable patterns
- `../reviewed-queue/YYYY-MM-DD-summary.md` - Historical details
