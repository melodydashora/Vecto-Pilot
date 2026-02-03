# 4-Phase Hardening Plan

**Created:** 2026-01-10
**Source:** DOC_DISCREPANCIES.md (single source of truth)
**Priority:** ALL findings are HIGH priority per CLAUDE.md Rule 9

## Summary of Active Discrepancies

### Critical (P0 - Breaks AI Coach)
- **D-005 to D-008:** coach/schema.js column name mismatches
- **D-015:** Coach uses wrong table names (market_information → market_intelligence, etc.)
- **D-016:** Direct anthropic.messages.create() in briefing-service.js:349

### High Priority
- **D-001 to D-003:** Docs claim users table has location data (it doesn't)
- **D-009, D-010:** DATA_FLOW_MAP.json lists deleted tables
- **D-013:** places_cache.place_id stores coordsKey (semantic mismatch)
- **D-014:** 3 duplicate isOpen functions with different signatures
- **D-017:** toFixed(4) violates 6-decimal GPS precision
- **D-018:** venue-intelligence.js trusts Google openNow directly

### Medium Priority
- **D-004, D-011, D-012:** Country field uses 'USA' not ISO 'US'

## Phase Details

### Phase 0: Stop Truth Drift (IMMEDIATE)
Fix documentation that contradicts code:
1. Fix coach schema metadata to match shared/schema.js
2. Regenerate DATA_FLOW_MAP.json with correct table names
3. Fix docs claiming users table has location data

### Phase 1: Unify Duplicate Venue Hours Logic
Consolidate into single source of truth:
- venue-hours.js:24 - isOpenNow(hoursFullWeek, timezone, checkTime)
- venue-enrichment.js:293 - calculateIsOpen(weekdayTexts, timezone)
- venue-utils.js:133 - calculateIsOpen(hoursFullWeek, timezone)

### Phase 2: Enforce Adapter-Only AI Calls + ULTRATHINK
1. Replace direct SDK calls with callModel()
2. Add CI enforcement
3. Verify lowest temperature + highest thinking level

### Phase 3: ISO DB Naming + Standards
1. Implement country_code migration
2. Rename places_cache.place_id → coords_key
3. Fix toFixed(4) → toFixed(6)

### Phase 4: Schema Defect Resolution
Full schema validation and documentation refresh

## Reference
See `docs/DOC_DISCREPANCIES.md` for full tracking with exact file:line locations.
