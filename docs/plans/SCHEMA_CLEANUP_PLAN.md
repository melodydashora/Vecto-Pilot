# Schema Cleanup Plan: ranking_candidates Table

**Created:** 2026-01-09
**Updated:** 2026-01-09
**Status:** PHASE 1 & 2 COMPLETE - Phase 3 pending
**Priority:** P2 (Schema Hygiene)

---

## Problem Statement

The `ranking_candidates` table has **6 redundant columns** where the same value is written to multiple columns for backward compatibility. This wastes storage, creates confusion, and makes the codebase harder to maintain.

## Redundant Column Analysis

### Drive Time Columns (3 columns storing same value)

| Column | Type | Purpose | Used By |
|--------|------|---------|---------|
| `drive_minutes` | integer | **CANONICAL** - Primary drive time field | coach-dal.js, chat-context.js, blocks-fast.js, content-blocks.js |
| `drive_time_min` | integer | LEGACY | intelligence/index.js only |
| `drive_time_minutes` | integer | LEGACY | Not read anywhere (write-only) |

**Evidence from enhanced-smart-blocks.js (lines 196, 212, 232):**
```javascript
drive_minutes: driveMinutes,        // Line 196 - PRIMARY
drive_time_min: driveMinutes,       // Line 212 - LEGACY (comment: "Legacy fields")
drive_time_minutes: driveMinutes,   // Line 232 - LEGACY
```

### Distance Columns (3 columns storing same/derived value)

| Column | Type | Purpose | Used By |
|--------|------|---------|---------|
| `distance_miles` | double | **CANONICAL** - Primary distance field | coach-dal.js, chat-context.js, blocks-fast.js, content-blocks.js, venue-event-verifier.js |
| `estimated_distance_miles` | double | LEGACY | blocks-fast.js (filtering only - can be migrated) |
| `straight_line_km` | double | LEGACY | Not read anywhere (write-only) |

**Evidence from enhanced-smart-blocks.js (lines 195, 213, 231):**
```javascript
distance_miles: distanceMiles,                    // Line 195 - PRIMARY
straight_line_km: distanceMiles * 1.60934,        // Line 213 - LEGACY (incorrect: miles→km conversion)
estimated_distance_miles: distanceMiles,          // Line 231 - LEGACY
```

**Note:** `straight_line_km` is poorly named - it stores `distanceMiles * 1.60934` (converting miles to km, not straight-line distance).

---

## Migration Plan

### Phase 1: Consolidate Reads (LOW RISK)

1. **Update intelligence/index.js** (line 1062):
   - Change `driveTimeMin: ranking_candidates.drive_time_min`
   - To: `driveTimeMin: ranking_candidates.drive_minutes`

2. **Update blocks-fast.js** (lines 301-310):
   - Change filter from `estimated_distance_miles` to `distance_miles`
   - Already mapped: `estimatedDistanceMiles: c.distance_miles` (line 263)

3. **Verify transformers.js handles both** (already does):
   ```javascript
   estimatedDistanceMiles: dbBlock.distance_miles ?? dbBlock.estimated_distance_miles,
   driveTimeMinutes: dbBlock.drive_minutes ?? dbBlock.driveTimeMinutes,
   ```

### Phase 2: Stop Writing Legacy Columns (MEDIUM RISK)

Update `enhanced-smart-blocks.js` to remove legacy writes:

```javascript
// BEFORE (writes same value 3 times)
distance_miles: distanceMiles,
drive_minutes: driveMinutes,
// ...legacy section...
drive_time_min: driveMinutes,           // REMOVE
straight_line_km: distanceMiles * 1.60934,  // REMOVE
estimated_distance_miles: distanceMiles,    // REMOVE
drive_time_minutes: driveMinutes,           // REMOVE

// AFTER (single write per value)
distance_miles: distanceMiles,
drive_minutes: driveMinutes,
// Legacy columns: null (no longer populated)
```

### Phase 3: Schema Migration (REQUIRES DOWNTIME OR CAREFUL ROLLOUT)

Create migration to drop unused columns:

```sql
-- Migration: Drop redundant columns from ranking_candidates
ALTER TABLE ranking_candidates DROP COLUMN IF EXISTS drive_time_min;
ALTER TABLE ranking_candidates DROP COLUMN IF EXISTS drive_time_minutes;
ALTER TABLE ranking_candidates DROP COLUMN IF EXISTS estimated_distance_miles;
ALTER TABLE ranking_candidates DROP COLUMN IF EXISTS straight_line_km;
```

Update `shared/schema.js` to remove column definitions.

---

## Files Requiring Changes

| File | Change |
|------|--------|
| `server/api/intelligence/index.js` | Line 1062: Use `drive_minutes` instead of `drive_time_min` |
| `server/api/strategy/blocks-fast.js` | Lines 301-310: Use `distance_miles` for filtering |
| `server/lib/venue/enhanced-smart-blocks.js` | Lines 212-232: Remove legacy column writes |
| `server/validation/transformers.js` | Remove fallback logic after migration |
| `shared/schema.js` | Remove 4 column definitions |
| `docs/architecture/database-schema.md` | Update documentation |

---

## Risk Assessment

| Phase | Risk Level | Rollback Strategy |
|-------|------------|-------------------|
| Phase 1 | LOW | Revert code change |
| Phase 2 | MEDIUM | Old data still has legacy columns; revert + re-populate |
| Phase 3 | HIGH | Requires database restore or migration reversal |

---

## Recommended Approach

1. ~~**Immediate (P1-6 followup):** Complete Phase 1 to consolidate reads~~ ✅ DONE 2026-01-09
2. ~~**Next Sprint:** Phase 2 to stop writing legacy columns~~ ✅ DONE 2026-01-09
3. **Future:** Phase 3 schema migration when confident:
   - Old data has cycled out (ranking_candidates are ephemeral, ~24h lifespan)
   - No code reads legacy columns (verified via Phase 1)
   - Remove fallbacks from transformers.js THEN drop columns

**Phase 3 Prerequisite:** Wait 48-72 hours after Phase 2 deployment to ensure
old data with legacy columns has been replaced by new data with canonical columns only.

---

## Notes

- The `straight_line_km` column is a misnomer - it stores `distance_miles * 1.60934` which is just a unit conversion, not a straight-line calculation
- All legacy columns are marked with a `// Legacy fields for compatibility` comment in enhanced-smart-blocks.js
- The `features` JSONB column duplicates some of this data (isOpen, category, etc.) - may warrant separate cleanup
