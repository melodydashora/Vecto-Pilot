## 🔴 ACTIVE ISSUES

### Issue #6: Duplicate GPS Enrichment on App Load (Dec 7, 2025)
**Status:** 🔴 Active  
**Severity:** Medium  
**Component:** `client/src/contexts/location-context-clean.tsx`

**Problem:**
- Generation counter shows enrichment running twice on initial app load
- Console logs show:
  ```
  🔢 Generation #1 starting for GPS update
  ✅ Generation #1 is latest - updating state
  [Then immediately triggers again with same coords]
  ```

**Root Cause:**
- `useEffect` with `coords` dependency triggers enrichment
- `refreshGPS()` is called on mount, which updates coords
- Updated coords trigger the enrichment `useEffect` again
- Results in duplicate API calls (location/weather/air)

**Impact:**
- Unnecessary API usage (2x calls on every app load)
- Slower perceived load time
- Potential rate limiting issues

**Proposed Fix:**
- Add `isInitialMount` ref to track first render
- Skip enrichment `useEffect` on initial mount (let refreshGPS handle it)
- Only trigger enrichment on subsequent coord changes

**Test Verification:**
```javascript
// After fix, console should show:
// 🔢 Generation #1 starting for GPS update
// ✅ Generation #1 is latest - updating state
// (no duplicate generation #1)
```

---

### Issue #7: Duplicate Snapshot Creation (Dec 7, 2025)
**Status:** 🔴 Active  
**Severity:** High  
**Component:** `client/src/contexts/location-context-clean.tsx`

**Problem:**
- Two snapshots created in rapid succession on app load
- Console logs show:
  ```
  ✅ Snapshot saved successfully: 457a9129-dd60-40c8-aa93-639bf95d2626
  🎯 Co-Pilot: Snapshot ready, triggering all tabs + waterfall: 457a9129...
  [Then immediately:]
  ✅ Snapshot saved successfully: 090cd3fd-43ff-4ca3-ac4c-b279ca2c48c5
  🎯 Co-Pilot: Snapshot ready, triggering all tabs + waterfall: 090cd3fd...
  ```

**Root Cause:**
- Same as Issue #6 - duplicate enrichment causes duplicate snapshot creation
- Each enrichment cycle creates a new snapshot
- Second snapshot overwrites UI state while first is still processing

**Impact:**
- Wasted AI strategy generation (first waterfall abandoned)
- Higher API costs (2x Claude/GPT-5/Gemini calls)
- Confusing UI state (strategy switches mid-load)
- Database pollution (orphaned snapshots/strategies)

**Proposed Fix:**
- Fix Issue #6 (prevents duplicate enrichment)
- Add debouncing to snapshot creation (500ms)
- Add snapshot ID tracking to prevent rapid re-creation

**Test Verification:**
```javascript
// After fix, console should show:
// ✅ Snapshot saved successfully: [single UUID]
// 🎯 Co-Pilot: Snapshot ready, triggering waterfall
// (no second snapshot creation)
```

---

## ✅ RESOLVED ISSUES

### Issue #1: PostgreSQL Connection Drops (RESOLVED Dec 7, 2025)