# D-014/D-018 Audit Verification

**Date:** 2026-01-10
**Type:** Audit Verification
**Status:** VERIFIED - Documentation Update Required

## Summary

Comprehensive audit verified that commits `e6b6171d` and `9fbd22ba` successfully implemented the D-014 (isOpen consolidation) and D-018 (venue-intelligence canonical) fixes. However, DOC_DISCREPANCIES.md was not updated to reflect these completions.

## Verified Fixes

### D-014: Consolidated isOpen Logic
- **Status:** FIXED (code verified)
- **Canonical Module:** `server/lib/venue/hours/`
- **Evidence:**
  - `venue-hours.js:12` - Uses `parseStructuredHoursFullWeek` + `getOpenStatus`
  - `venue-enrichment.js:26,299` - Uses `parseGoogleWeekdayText` + `getOpenStatus`
  - `venue-utils.js:16,154` - Uses `parseHoursTextMap` + `getOpenStatus`

### D-018: venue-intelligence.js Canonical Evaluation
- **Status:** FIXED (code verified)
- **Evidence:**
  - `venue-intelligence.js:18-19` - Imports canonical module
  - `venue-intelligence.js:57` - Uses `getOpenStatus()` for evaluation
  - `venue-intelligence.js:63-72` - Google `openNow` used ONLY for debug logging

### D-012: Country Code Default
- **Status:** FIXED (code verified)
- **Evidence:**
  - `venue-utils.js:37` - Default is `'US'` (was 'USA')
  - `venue-utils.js:74` - Fallback is `'US'`

### D-011: location.js Country Name
- **Status:** NOT FIXED
- **Issue:** `location.js:161` still uses `c.long_name` instead of `c.short_name`
- **Action Required:** Change to `c.short_name` for ISO alpha-2 format

## Documentation Drift

DOC_DISCREPANCIES.md shows:
- D-014: "DEFERRED" - Should be "FIXED"
- D-018: "PENDING" - Should be "FIXED"
- D-012: "PENDING" - Should be "FIXED"

## Canonical Hours Module Architecture

```
server/lib/venue/hours/
├── index.js                    # Barrel export
├── evaluator.js                # getOpenStatus() - SINGLE SOURCE OF TRUTH
├── normalized-types.js         # Type definitions
├── README.md                   # Documentation
└── parsers/
    ├── index.js
    ├── google-weekday-text.js  # Google Places format
    ├── hours-text-map.js       # Text map format
    └── structured-hours.js     # JSON format (D-018)
```

## Key Rules Enforced

1. **Timezone Required:** No fallbacks - missing timezone returns `is_open: null`
2. **No Direct openNow:** Always parse weekdayDescriptions, never trust Google's `openNow`
3. **Single Source of Truth:** All isOpen calculations go through `getOpenStatus()`
4. **Rich Output:** Returns `is_open`, `closes_at`, `opens_at`, `closing_soon`, `minutes_until_close`

## Tags

#audit #d014 #d018 #d012 #hours-module #verification #documentation-drift
