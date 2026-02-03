# Codebase Refactor Audit - 2026-01-10

## Critical Finding 1: Duplicate Coords Key Functions

**4 identical implementations with different names:**

| Location | Function Name | Precision | Exported? |
|----------|---------------|-----------|-----------|
| `server/api/location/location.js:13` | `makeCoordsKey()` | 6 decimals | No |
| `server/api/location/snapshot.js:23` | `makeCoordsKey()` | 6 decimals | No |
| `server/lib/venue/venue-enrichment.js:433` | `getCoordsKey()` | 6 decimals | No |
| `server/lib/venue/venue-utils.js:83` | `generateCoordKey()` | 6 decimals | Yes |

**Client inconsistency:**
- `client/src/hooks/useBarsQuery.ts:96` uses `toFixed(4)` in logging (4 decimals = ~11m vs 6 decimals = ~11cm)

### Recommended Fix
Create single canonical function in `server/lib/location/coords-key.js`:
```javascript
export function coordsKey(lat, lng) {
  return `${Number(lat).toFixed(6)}_${Number(lng).toFixed(6)}`;
}
```
Then replace all 4 implementations with imports.

---

## Critical Finding 2: Duplicate calculateIsOpen Functions

**Same name, DIFFERENT signatures and return types:**

| Location | Signature | Returns | Purpose |
|----------|-----------|---------|---------|
| `venue-enrichment.js:293` | `calculateIsOpen(weekdayTexts, timezone)` | `boolean\|null` | Parses Google weekday description strings |
| `venue-utils.js:133` | `calculateIsOpen(hoursFullWeek, timezone)` | `{is_open, next_close_time, closing_soon}` | Parses structured hours object for Bar Markers |

**Why this is dangerous:**
- Same function name, completely different I/O contracts
- Easy to import the wrong one and get silent incorrect behavior
- Breaking changes difficult to track

### Recommended Fix
Rename to reflect inputs:
- `calculateIsOpenFromWeekdayText(weekdayTexts, timezone)` → boolean|null
- `calculateOpenStatusFromHoursObject(hoursFullWeek, timezone)` → {is_open, next_close_time, closing_soon}

---

## Critical Finding 3: LLM Adapter Bypasses

**Files calling LLM APIs directly (not through adapter):**

### Production Code (must fix)
1. `server/lib/ai/providers/consolidator.js:226,296` - Direct OpenAI and Gemini
2. `server/lib/location/holiday-detector.js:213` - Direct Gemini
3. `server/lib/strategy/planner-gpt5.js:3` - Defines OPENAI_URL
4. `server/api/research/research.js:22,86` - Direct Gemini (2 instances)
5. `server/api/venue/venue-events.js:46` - Direct Gemini
6. `server/scripts/sync-events.mjs:497,586` - Direct OpenAI and Gemini
7. `server/gateway/assistant-proxy.ts:60,71` - Direct OpenAI and Gemini

### Acceptable Exceptions
- `server/api/chat/realtime.js:39` - OpenAI Realtime API (different protocol)
- `server/scripts/test-gemini-search.js:15` - Test script only

### Why this matters
- Model parameters not centrally managed
- Retry logic duplicated inconsistently
- Temperature/thinking settings vary per file
- Hard to switch models or apply global policies

---

## Critical Finding 4: toFixed(4) vs toFixed(6) Precision

All coords key functions use 6 decimals, but:
- `client/src/hooks/useBarsQuery.ts:96` logs with `toFixed(4)` (inconsistent)

Even in logging, consistent precision helps debugging.

---

## Phase A Refactor Plan: Single Primitives

### Step 1: Coords Key Consolidation
```bash
# Create canonical module
server/lib/location/coords-key.js

# Delete/replace:
- server/api/location/location.js (local function)
- server/api/location/snapshot.js (local function)  
- server/lib/venue/venue-enrichment.js (local function)

# Keep and re-export:
- server/lib/venue/venue-utils.js generateCoordKey → import from coords-key.js
```

### Step 2: calculateIsOpen Disambiguation
```bash
# In venue-enrichment.js:
- Rename calculateIsOpen → calculateIsOpenFromWeekdayText

# In venue-utils.js:
- Rename calculateIsOpen → calculateOpenStatusFromHoursObject
```

---

## Phase B Refactor Plan: Centralize LLM Calls

All LLM calls should go through `callModel(role, ...)` from adapters.

Files to refactor:
1. consolidator.js - Use callModel('STRATEGY_TACTICAL', ...) 
2. holiday-detector.js - Use callModel('BRIEFING_HOLIDAY', ...)
3. sync-events.mjs - Use callModel for discovery
4. research.js - Use callModel('RESEARCH', ...)
5. venue-events.js - Use callModel
6. assistant-proxy.ts - Evaluate if adapter works for this use case

---

## Verification Scripts (Add to CI)

```bash
# Check for duplicate coords functions
grep -rn "toFixed(4)" server/ | grep -i coord
grep -rn "makeCoordsKey\|getCoordsKey\|generateCoordKey\|coordsKey" server/

# Check for direct LLM calls outside adapters
grep -rn "api.openai.com" server/ --include="*.js" --include="*.ts" | grep -v adapters | grep -v models-dictionary
grep -rn "generativelanguage.googleapis.com" server/ --include="*.js" --include="*.ts" | grep -v adapters
```

---

## Critical Finding 5: MULTI_STRATEGY_ENABLED Silent No-Op

**Location:** `server/lib/strategy/strategy-generator-parallel.js:321`

```javascript
if (!MULTI_STRATEGY_ENABLED) {
  triadLog.info(`Multi-strategy feature disabled`);
  return { ok: false, reason: 'feature_disabled' };  // SILENT EXIT!
}
```

**Impact:**
- `generateStrategyForSnapshot()` calls `generateMultiStrategy()`
- If `MULTI_STRATEGY_ENABLED !== 'true'`, pipeline silently returns
- Caller gets `{ ok: false }` but no strategy is generated
- Tables show "no data" but no errors logged prominently

**Fix needed:** 
Either always run pipeline OR log a WARN-level message when feature is disabled.

---

## Critical Finding 6: Doc/Schema Mismatch - Users Table Location

**Docs claim users has location (WRONG):**
- `README.md:150` - "users: GPS coordinates, resolved address, timezone (authoritative location source)"
- `docs/architecture/database-schema.md:7` - "users - User Location Authority"
- `server/api/location/README.md:44` - "POST /api/users/location - Update user location"
- Many other references

**Schema reality (CORRECT):**
```javascript
// shared/schema.js line 18-30
// NO LOCATION DATA - all location goes to snapshots table
export const users = pgTable("users", {
  user_id: uuid("user_id").primaryKey(),
  device_id: text("device_id").notNull(),
  session_id: uuid("session_id"),
  current_snapshot_id: uuid("current_snapshot_id"),
  session_start_at: timestamp,
  last_active_at: timestamp,
  created_at, updated_at
});
// 8 columns total - NO lat, lng, city, state, timezone
```

**Code comments confirm no location:**
- `shared/schema.js:1717` - "usersRelations removed - users table no longer has location data"
- `server/api/location/location.js:1501` - "2026-01-05: Users table no longer stores location data"
- `SAVE-IMPORTANT.md:43` - "NO location fields in users table"

**Why this matters:**
Engineers reading docs will try to "fix" location bugs in users table when data is actually in snapshots table.

### Docs that need updating:
1. `README.md` - Remove "GPS coordinates" from users description
2. `docs/architecture/database-schema.md` - Remove "User Location Authority" 
3. `server/api/location/README.md` - Remove "/api/users/location" endpoint reference
4. `docs/architecture/authentication.md:56` - Update "last location" reference
5. `server/lib/ai/coach-dal.js:82` - Comment claims users table has location

---

## Critical Finding 7: Comment Lies in Snapshot Endpoint

**Location:** `server/api/location/snapshot.js:67-68`

```javascript
// LOCATION RESOLUTION: Get resolved address from users table (source of truth)
// Users table is populated from coords_cache when location.js resolves coords
```

**Reality:** Code path only reads from `coords_cache`, not users table.

---

## Status

- [x] Audit completed: 2026-01-10
- [x] Findings 1-7 documented
- [ ] Phase A: Coords key consolidation
- [ ] Phase A: calculateIsOpen disambiguation  
- [ ] Phase B: LLM adapter centralization
- [ ] Phase C: Fix doc/schema mismatches
- [ ] CI verification scripts added