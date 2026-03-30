# ETL Deep Analysis - Complete File Audit
**Date:** 2026-01-10
**Scope:** Full codebase architecture audit

---

## PART 1: Duplicate Function Analysis

### 1.1 Coords Key Functions (4 duplicates found)

| File | Line | Function | Precision | Status |
|------|------|----------|-----------|--------|
| `server/api/location/location.js` | 13 | `makeCoordsKey(lat, lng)` | 6 decimals | ⚠️ Duplicate |
| `server/api/location/snapshot.js` | 23 | `makeCoordsKey(lat, lng)` | 6 decimals | ⚠️ Duplicate |
| `server/lib/venue/venue-enrichment.js` | 433 | `getCoordsKey(lat, lng)` | 6 decimals | ⚠️ Different name |
| `server/lib/venue/venue-utils.js` | 83 | `generateCoordKey(lat, lng)` | 6 decimals | ✅ Exported |

**Analysis:**
- All use correct 6-decimal precision
- Same logic, different names = maintenance nightmare
- Should consolidate to single exported function

**Client Inconsistency:**
| File | Line | Code | Precision |
|------|------|------|-----------|
| `client/src/hooks/useBarsQuery.ts` | 96 | `latitude?.toFixed(4)` | 4 decimals | ⚠️ Inconsistent |

### 1.2 calculateIsOpen Functions (2 with different signatures)

| File | Line | Signature | Returns | Purpose |
|------|------|-----------|---------|---------|
| `server/lib/venue/venue-enrichment.js` | 293 | `calculateIsOpen(weekdayTexts, timezone)` | `boolean\|null` | Parses Google weekday descriptions |
| `server/lib/venue/venue-utils.js` | 133 | `calculateIsOpen(hoursFullWeek, timezone)` | `{is_open, next_close_time, closing_soon}` | Bar markers with rich status |

**Analysis:**
- Same name, completely different I/O contracts
- Easy to import wrong one silently
- Should rename to disambiguate:
  - `calculateIsOpenFromWeekdayText()` 
  - `calculateOpenStatusFromHoursObject()`

---

## PART 2: LLM Adapter Bypass Analysis

### 2.1 Files with Direct OpenAI API Calls

| File | Line | URL Pattern | Should Use Adapter? |
|------|------|-------------|---------------------|
| `server/lib/ai/providers/consolidator.js` | 226 | `api.openai.com/v1/chat/completions` | ✅ Yes - use callModel() |
| `server/scripts/sync-events.mjs` | 497 | `api.openai.com/v1/responses` | ✅ Yes - use callModel() |
| `server/gateway/assistant-proxy.ts` | 60 | `api.openai.com/v1/responses` | ⚠️ Evaluate |
| `server/api/chat/realtime.js` | 39 | `api.openai.com/v1/realtime/sessions` | ❌ No - different protocol |
| `server/lib/strategy/planner-gpt5.js` | 3 | Defines `OPENAI_URL` constant | ✅ Yes - use callModel() |
| `server/lib/ai/models-dictionary.js` | 109,288,316 | Documents endpoints | ℹ️ Reference only |

### 2.2 Files with Direct Gemini API Calls

| File | Line | URL Pattern | Should Use Adapter? |
|------|------|-------------|---------------------|
| `server/lib/ai/providers/consolidator.js` | 296 | `generativelanguage.googleapis.com` | ✅ Yes - use callModel() |
| `server/lib/location/holiday-detector.js` | 213 | `generativelanguage.googleapis.com` | ✅ Yes - use callModel() |
| `server/scripts/sync-events.mjs` | 586 | `generativelanguage.googleapis.com` | ✅ Yes - use callModel() |
| `server/api/research/research.js` | 22, 86 | `generativelanguage.googleapis.com` | ✅ Yes - use callModel() |
| `server/api/venue/venue-events.js` | 46 | `generativelanguage.googleapis.com` | ✅ Yes - use callModel() |
| `server/gateway/assistant-proxy.ts` | 71 | `generativelanguage.googleapis.com` | ⚠️ Evaluate |
| `server/scripts/test-gemini-search.js` | 15 | `generativelanguage.googleapis.com` | ❌ No - test script |
| `server/lib/ai/adapters/gemini-adapter.js` | 191 | `generativelanguage.googleapis.com` | ✅ This IS the adapter |

**Summary:** 9 production files bypass adapters (excluding test scripts and the adapter itself)

---

## PART 3: Documentation vs Reality Mismatches

### 3.1 Users Table Location Claims (ALL FIXED ✅)

| File | Line | Incorrect Claim | Reality | Status |
|------|------|-----------------|---------|--------|
| `README.md` | 150 | "users: GPS coordinates, resolved address, timezone" | Users has NO location fields | ✅ Fixed |
| `docs/architecture/database-schema.md` | 7 | "users - User Location Authority" | Users is session tracking only | ✅ Fixed |
| `server/api/location/snapshot.js` | 67-68 | "Get resolved address from users table" | Code reads coords_cache | ✅ Fixed |
| `server/api/location/README.md` | 44 | "POST /api/users/location" | Endpoint doesn't exist | ✅ Fixed |
| `server/lib/ai/coach-dal.js` | 82 | "Location data is pulled from users table" | Code queries snapshots | ✅ Fixed |
| `SYSTEM_MAP.md` | 392 | "users (GPS coordinates, location, auth)" | Outdated | ⚠️ Pending |
| `docs/architecture/authentication.md` | 56 | "users: last location" | Outdated | ⚠️ Pending |
| `LESSONS_LEARNED.md` | 702 | "Users table = source of truth for resolved location" | Outdated | ⚠️ Pending |

### 3.2 Actual Schema (shared/schema.js:19-30)

```javascript
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

---

## PART 4: Event Field Naming Analysis

### 4.1 Files Modified for Symmetric Naming

#### Backend Files
| File | Changes |
|------|---------|
| `server/db/migrations/2026-01-10-rename-event-fields.sql` | Created: ALTER TABLE column renames |
| `shared/schema.js` | Updated: `event_date` → `event_start_date`, `event_time` → `event_start_time` |
| `server/lib/events/pipeline/types.js` | Updated: JSDoc NormalizedEvent type |
| `server/lib/events/pipeline/normalizeEvent.js` | Updated: Output field names, accepts both old/new input |
| `server/lib/events/pipeline/validateEvent.js` | Updated: Validation rules reference new fields |
| `server/lib/events/pipeline/hashEvent.js` | Updated: Hash reads from new fields |
| `server/lib/events/pipeline/README.md` | Updated: Documentation |
| `server/scripts/sync-events.mjs` | Updated: SQL queries and mapping |
| `server/lib/briefing/briefing-service.js` | Updated: SQL queries and mapping |
| `server/api/briefing/briefing.js` | Updated: SQL queries and function logic |
| `server/lib/briefing/event-schedule-validator.js` | Updated: Field references |
| `server/lib/venue/event-matcher.js` | Updated: SQL queries and mapping |
| `server/lib/venue/venue-cache.js` | Updated: SQL queries |
| `server/jobs/event-sync-job.js` | Updated: SQL queries |
| `server/validation/transformers.js` | Updated: Field references |

#### Frontend Files
| File | Changes |
|------|---------|
| `client/src/components/BriefingTab.tsx` | Updated: BriefingEvent interface, isEventForToday logic |
| `client/src/utils/co-pilot-helpers.ts` | Updated: FilterableEvent interface, all helper functions |
| `client/src/components/EventsComponent.tsx` | Updated: Event interface, JSX |
| `client/src/components/MapTab.tsx` | Updated: MapEvent interface, display logic |
| `client/src/pages/co-pilot/MapPage.tsx` | Updated: Interfaces, mapping |
| `client/src/components/RideshareIntelTab.tsx` | Updated: Event mapping |

#### Test Files
| File | Changes |
|------|---------|
| `tests/events/pipeline.test.js` | Updated: Test data, assertions (57/57 passing) |

### 4.2 Field Mapping Strategy

```
LLM Output (raw)          →  normalizeEvent.js  →  Database/Frontend
─────────────────────────────────────────────────────────────────────
event_date: "01/15/2026"  →  event_start_date: "2026-01-15"
event_time: "7 PM"        →  event_start_time: "19:00"
event_end_time: "11 PM"   →  event_end_time: "23:00"
event_end_date: null      →  event_end_date: null
```

---

## PART 5: Pipeline Feature Flag Analysis

### 5.1 MULTI_STRATEGY_ENABLED Flag

| File | Line | Code | Issue |
|------|------|------|-------|
| `server/lib/strategy/strategy-generator-parallel.js` | 14 | `const MULTI_STRATEGY_ENABLED = process.env.MULTI_STRATEGY_ENABLED === 'true'` | Feature flag |
| `server/lib/strategy/strategy-generator-parallel.js` | 321-323 | `if (!MULTI_STRATEGY_ENABLED) { return { ok: false, reason: 'feature_disabled' }; }` | Silent exit |
| `server/lib/strategy/strategy-generator.js` | 53 | `await generateMultiStrategy({...})` | Calls potentially disabled function |

**Analysis:**
- `generateStrategyForSnapshot()` calls `generateMultiStrategy()`
- If `MULTI_STRATEGY_ENABLED !== 'true'`, pipeline silently returns `{ ok: false }`
- No strategy generated but no prominent error logged
- Caller may not realize pipeline is disabled

---

## PART 6: Precision Analysis

### 6.1 GPS Coordinate Precision Audit

| Location | Code | Decimals | Accuracy | Status |
|----------|------|----------|----------|--------|
| `server/api/location/location.js:14-15` | `lat.toFixed(6)` | 6 | ~11cm | ✅ Correct |
| `server/api/location/snapshot.js:24-25` | `lat.toFixed(6)` | 6 | ~11cm | ✅ Correct |
| `server/lib/venue/venue-enrichment.js:434-435` | `Number(lat).toFixed(6)` | 6 | ~11cm | ✅ Correct |
| `server/lib/venue/venue-utils.js:87` | `Number(lat).toFixed(6)` | 6 | ~11cm | ✅ Correct |
| `client/src/hooks/useBarsQuery.ts:96` | `latitude?.toFixed(4)` | 4 | ~11m | ⚠️ Inconsistent (logging only) |

---

## PART 7: Files Read for Context

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project rules, critical constraints |
| `SAVE-IMPORTANT.md` | Architecture decisions (users table simplified) |
| `shared/schema.js` | Actual database schema |
| `server/lib/events/pipeline/*.js` | ETL pipeline modules |
| `client/src/components/*.tsx` | Frontend event components |
| `client/src/utils/co-pilot-helpers.ts` | Event helper functions |
| `docs/architecture/database-schema.md` | Database documentation |
| `docs/review-queue/pending.md` | Outstanding review items |

---

## PART 8: Summary Statistics

| Category | Count |
|----------|-------|
| **Duplicate functions found** | 6 (4 coords + 2 isOpen) |
| **Adapter bypass files** | 9 production files |
| **Doc/schema mismatches fixed** | 5 |
| **Doc/schema mismatches remaining** | 3 |
| **Files modified for field rename** | 21 |
| **Tests passing** | 57/57 (100%) |
| **Memory files created** | 2 |

---

## PART 9: Recommended Next Actions

### Immediate (P1)
1. Create `server/lib/location/coords-key.js` with single `coordsKey()` function
2. Replace all 4 duplicate implementations with imports
3. Rename `calculateIsOpen` functions to disambiguate

### Short-term (P2)
1. Refactor consolidator.js to use callModel()
2. Refactor holiday-detector.js to use callModel()
3. Refactor sync-events.mjs to use callModel()
4. Add CI check for direct API URLs outside adapters

### Documentation (P3)
1. Fix remaining doc mismatches in SYSTEM_MAP.md, authentication.md, LESSONS_LEARNED.md
2. Run database migration for event field renames
