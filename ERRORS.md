
# ERRORS.md - Codebase Error Analysis

**Last Updated:** 2025-12-09 UTC  
**Analysis Scope:** Architectural mismatches, runtime errors, API inconsistencies

---

## 🚨 CRITICAL ERRORS

### 1. **Gemini 3.0 Pro API Empty Response Error** ⚠️ PRODUCTION BLOCKING

**Location:** `server/lib/briefing-service.js` (fetchTrafficConditions)

**Evidence from Logs:**
```
[BriefingService] Generation error: Gemini traffic API failed: Empty response from Gemini
```

**Root Cause:**
The Gemini 3.0 Pro API call is returning empty responses, causing the entire briefing pipeline to fail. According to ARCHITECTURE.md:

> **Fail-Fast Architecture** - if Gemini API fails, the entire briefing flow fails with a clear error. No silent fallbacks that hide API failures.

**Current Behavior:**
- Traffic API fails with "Empty response from Gemini"
- Briefing generation aborts completely
- Strategy pipeline continues but lacks critical traffic data

**Analysis:**
Looking at `server/lib/briefing-service.js:616`, the code expects text content from Gemini but receives empty candidates:

```javascript
const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) {
  throw new Error(`Empty response from Gemini (finishReason: ${candidate.finishReason || 'unknown'})`);
}
```

**Potential Causes:**
1. **Safety Filter Blocking:** Gemini 3.0 may be blocking traffic/event queries due to safety filters (ARCHITECTURE.md shows safety filters disabled but may not be applied correctly)
2. **API Parameter Mismatch:** Model research shows Gemini 3.0 requires `thinking_level` parameter - may be missing
3. **Response Structure Change:** `thinking` content vs `text` content (see model-research-2025-12-09.json)

**Fix Required:**
```javascript
// BEFORE (Line ~180 in briefing-service.js)
const parts = candidate.content?.parts || [];
let text = null;
for (const part of parts) {
  if (part.thought) continue; // Skip thinking parts
  if (part.text) {
    text = part.text;
    break;
  }
}

// ISSUE: May need to handle Gemini 3.0 multipart responses differently
```

**Recommended Solution:**
1. Add `thinkingLevel: "HIGH"` to Gemini calls (per model-research-2025-12-09.json)
2. Verify safety settings are correctly applied
3. Add detailed logging of full Gemini response structure before parsing

---

### 2. **GPT-5.1 Unknown Parameter Error** ⚠️ PRODUCTION BLOCKING

**Location:** `server/lib/providers/consolidator.js`

**Evidence from Logs:**
```
[consolidator] ⚠️ GPT-5.1 failed (400): {
  "error": {
    "message": "Unknown parameter: 'reasoning'.",
    "type": "invalid_request_error"
```

**Root Cause:**
Code is passing `reasoning` parameter to GPT-5.1 API, but according to model-research-2025-12-09.json:

> **OpenAI o1 / GPT-5:**  
> `temperature` is fixed at `1.0`. Other values may cause 400 Error.  
> **USE INSTEAD:** `reasoning_effort` (values: minimal, low, medium, high)

**Current Code Error (consolidator.js ~line 80):**
```javascript
body.reasoning_effort = reasoningEffort; // ✅ CORRECT
// BUT somewhere else it's sending 'reasoning' ❌ WRONG
```

**Analysis:**
The parameter name should be `reasoning_effort`, not `reasoning`. This is a critical API compatibility issue.

**Architectural Violation:**
ARCHITECTURE.md states:
> **Model IDs Are Pinned and Verified Monthly** - Missing or changed IDs are treated as deployment blockers.

The consolidator is using outdated API parameters.

**Fix Required:**
Search codebase for all instances of `reasoning:` parameter and replace with `reasoning_effort:`.

---

### 3. **Google Places API: No Results for Valid Venues** ⚠️ DATA QUALITY

**Location:** `server/lib/venue-enrichment.js`

**Evidence from Logs:**
```
⚠️ [GOOGLE PLACES] No results found for "The Frisco Bar & Grill" at 33.088,-96.8278
⚠️ [GOOGLE PLACES] No results found for "Drury Inn & Suites Dallas Frisco" at 33.0974,-96.8372
⚠️ [GOOGLE PLACES] No results found for "Hyatt House Dallas/Frisco" at 33.0962,-96.8283
```

**Root Cause:**
GPT-5.1 is generating venue coordinates, but Google Places API (New) with 20-meter radius search is failing to find matching venues.

**Architectural Violation:**
ARCHITECTURE.md states:
> **Coordinates and Business Hours Come From Google or DB, Never Models**  
> Truth sources are Google Places/Routes and our persisted cache. Generative models must not originate or "correct" lat/lng or hours.

**Current Flow:**
1. GPT-5.1 generates venue coordinates ❌ (violates architecture)
2. Google Places API searches 20m radius
3. Finds nothing
4. Falls back to GPT coords ❌ (violates fail-closed principle)

**Correct Flow (per ARCHITECTURE.md):**
1. GPT-5.1 generates venue **names only**
2. Google Places Text Search finds venue
3. Google returns verified coordinates
4. If Google fails, **reject venue** (fail-closed)

**Fix Required:**
Rewrite venue-enrichment.js to:
- Use Places Text Search (not searchNearby)
- Search by venue name + city
- Only accept Google-verified coordinates
- Filter out venues Google can't verify

---

## ⚠️ HIGH-PRIORITY ERRORS

### 4. **Strategy Persistent Storage Cleared on Every Mount**

**Location:** `client/src/pages/co-pilot.tsx`

**Evidence from Logs:**
```
🧹 Clearing persistent strategy on app mount
```

**Architectural Mismatch:**
ARCHITECTURE.md states (Updated Dec 8, 2025):
> **localStorage Behavior:** Strategy data persists across sessions. App mount clears `vecto_persistent_strategy` and `vecto_strategy_snapshot_id` only on manual refresh or location change.

**Current Behavior:**
Every time the component mounts (even without refresh), strategy cache is cleared. This causes unnecessary re-fetches.

**Impact:**
- Users lose strategy data on navigation
- Increased API calls
- Poor UX for returning users

**Fix Required:**
```javascript
// REMOVE from co-pilot.tsx useEffect:
useEffect(() => {
  console.log('🧹 Clearing persistent strategy on app mount');
  localStorage.removeItem('vecto_persistent_strategy');
  localStorage.removeItem('vecto_strategy_snapshot_id');
}, []); // ❌ Runs on every mount

// REPLACE WITH:
useEffect(() => {
  // Only clear if location changed or manual refresh
  const lastLocation = localStorage.getItem('vecto_last_location');
  const currentLocation = `${location.lat},${location.lng}`;
  
  if (lastLocation !== currentLocation) {
    console.log('📍 Location changed - clearing stale strategy');
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    localStorage.setItem('vecto_last_location', currentLocation);
  }
}, [location.lat, location.lng]);
```

---

### 5. **Zod Validation Error with Undefined Fields**

**Location:** `server/middleware/validation.js`

**Evidence from Logs:**
```
[validation] ZodError for action: undefined
```

**Root Cause:**
Actions are being sent without required fields, but error message doesn't specify which field is undefined.

**Fix Required:**
```javascript
// CURRENT (validation.js line ~40)
console.warn('[validation] ZodError for action:', err.errors?.map(e => `${e.path?.join('.')}=${e.message}`).join(', '));

// ISSUE: When path is empty, logs "undefined"

// FIX: Add fallback
console.warn('[validation] ZodError:', err.errors?.map(e => {
  const field = e.path?.join('.') || 'unknown_field';
  return `${field}: ${e.message}`;
}).join(', '));
```

---

### 6. **Missing place_id for All Enriched Venues**

**Location:** `server/lib/venue-enrichment.js`

**Evidence from Logs:**
```
[Venue Enrichment] ✅ "The Frisco Bar & Grill": placeId=NO, coords=33.088,-96.8278, status=UNKNOWN
```

**Impact:**
- Cannot cache venue data (no stable identifier)
- Cannot verify business hours
- Cannot detect permanently closed venues
- ML training data lacks venue identity

**Architectural Violation:**
ARCHITECTURE.md requires:
> **Deterministic Merge by Key, Never by Index**  
> All enrich/validate merges use stable keys (place_id preferred; name fallback)

Without place_id, the entire merge strategy fails.

---

## 🔍 MEDIUM-PRIORITY ERRORS

### 7. **Database Schema Mismatch: Briefing Storage**

**Current Code:** `server/lib/briefing-service.js` stores briefing data in `briefings` table

**ARCHITECTURE.md States:**
> `strategies` table columns: `briefing_news`, `briefing_events`, `briefing_traffic` - DEPRECATED (moved to briefings table)

**Issue:**
Code correctly uses `briefings` table, but ARCHITECTURE.md still references deprecated columns. This is a **documentation error**, not a code error.

**Fix Required:**
Update ARCHITECTURE.md to remove strikethrough and clearly state briefings table is the current source of truth.

---

### 8. **Holiday Detection Not Visible in Logs**

**Expected Behavior:**
`server/lib/holiday-detector.js` should run during snapshot creation

**Evidence:**
Logs show snapshot creation but no holiday detection logs:
```
[BriefingService] 📸 Snapshot: { ..., holiday: null, is_holiday: false }
```

**Analysis:**
Either:
1. Holiday detector is not being called
2. Holiday detector is failing silently
3. No holidays match current date

**Verification Needed:**
Check if `holiday-detector.js` is imported and called in `server/routes/location.js` during snapshot creation.

---

### 9. **Inconsistent Distance Source Tracking**

**Location:** `server/lib/venue-enrichment.js`

**Code:**
```javascript
distanceSource: "google_routes_api"
```

**ARCHITECTURE.md:**
> `distanceSource` flag prevents hidden degradation

**Issue:**
When Google Places fails, code sets:
```javascript
distanceSource: "enrichment_failed"
```

But when GPT coords are preserved:
```javascript
// Missing: Should be "gpt_coords_unverified"
```

**Fix Required:**
Add explicit source tracking:
- `google_routes_api` - Verified Google data
- `google_places_failed` - Places API returned no results
- `gpt_coords_unverified` - Using LLM coordinates (violates architecture)

---

### 10. **Missing Retry Logic for Transient Google API Failures**

**Location:** `server/lib/venue-enrichment.js` (getPlaceDetails)

**Current Code:**
Has retry logic for 429/5xx errors ✅

**Issue:**
Network errors (ECONNRESET, ETIMEDOUT) are not retried. They should be.

**Evidence:**
```javascript
} catch (error) {
  // Network errors: retry
  if (attempt < maxRetries - 1) {
    // ... retry
  }
}
```

This only retries if there's a network error AND we're not on the last attempt. But if the error is an API error (not network), it doesn't retry.

**Fix Required:**
Separate retry logic for:
1. Network errors (always retry)
2. API errors 429/503 (retry with backoff)
3. API errors 400/404 (don't retry)

---

## 📊 ARCHITECTURAL COMPLIANCE ISSUES

### 11. **Violation: Coordinates Originating from LLM**

**Location:** `server/lib/tactical-planner.js` + `server/lib/venue-enrichment.js`

**ARCHITECTURE.md Rule:**
> **Coordinates and Business Hours Come From Google or DB, Never Models**

**Current Flow:**
1. GPT-5.1 generates coordinates ❌
2. Google Places searches 20m radius
3. No results found
4. **Keeps GPT coordinates** ❌

**Evidence:**
```javascript
// venue-enrichment.js fallback
return {
  ...venue,
  lat: venue.lat, // ❌ Preserving GPT coords
  lng: venue.lng, // ❌ Preserving GPT coords
  distanceSource: "enrichment_failed"
};
```

**Required Fix:**
```javascript
// CORRECT: Fail-closed approach
if (!placeDetails?.place_id) {
  console.warn(`⚠️ Google cannot verify "${venue.name}" - REJECTING venue`);
  return null; // ✅ Filter out unverifiable venues
}
```

---

### 12. **Missing Split Cache Strategy Implementation**

**ARCHITECTURE.md States (Dec 9, 2025):**
> **SPLIT CACHE STRATEGY:**  
> - Daily briefing (news, events, closures): 24-hour cache  
> - Traffic: Always refreshes on app open or manual refresh

**Current Code:**
`server/lib/briefing-service.js` has `isDailyBriefingStale()` and `isTrafficStale()` functions ✅

**Issue:**
Traffic refresh is called in `refreshTrafficInBriefing()`, but **nowhere in the codebase is this function actually called**.

**Missing Implementation:**
Need to add traffic refresh on:
1. App open (frontend mount)
2. Manual refresh button
3. Poll interval (every 5 minutes)

**Fix Required:**
Add endpoint: `GET /api/briefing/traffic/refresh/:snapshotId`

---

## 🐛 MINOR ISSUES

### 13. **Inconsistent Error Response Format**

**Location:** Multiple routes

**Issue:**
Some routes return:
```javascript
{ error: 'not_found', snapshot_id: snapshotId }
```

Others return:
```javascript
{ ok: false, error: 'VALIDATION_ERROR', message: '...' }
```

**Fix Required:**
Standardize on one format (prefer the second with `ok` flag).

---

### 14. **Missing GEMINI_API_KEY Environment Variable Check**

**Location:** Multiple files

**Evidence:**
Code checks `process.env.GEMINI_API_KEY` inline without centralized validation.

**Fix Required:**
Add to `server/lib/validate-env.js`:
```javascript
requiredVars: [
  'GEMINI_API_KEY',
  // ... other vars
]
```

---

## 🎯 PRIORITY RANKING

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 🔴 P0 | Gemini Empty Response (#1) | Blocks production | Medium |
| 🔴 P0 | GPT-5.1 Unknown Parameter (#2) | Blocks production | Low |
| 🔴 P0 | Google Places No Results (#3) | Data quality | High |
| 🟡 P1 | Strategy Cache Cleared (#4) | UX degradation | Low |
| 🟡 P1 | Missing place_id (#6) | ML integrity | Medium |
| 🟢 P2 | Coordinates from LLM (#11) | Architecture violation | Medium |
| 🟢 P2 | Split Cache Missing (#12) | Performance | Medium |

---

## 🔧 RECOMMENDED FIXES (In Order)

1. **Immediate (Today):**
   - Fix GPT-5.1 `reasoning` → `reasoning_effort` parameter (#2)
   - Add detailed Gemini response logging (#1)
   - Fix strategy cache clearing logic (#4)

2. **This Week:**
   - Rewrite venue enrichment to use Places Text Search (#3)
   - Add retry logic for all transient failures (#10)
   - Implement traffic refresh endpoint (#12)

3. **Next Sprint:**
   - Enforce fail-closed for unverifiable venues (#11)
   - Standardize error response format (#13)
   - Add centralized env var validation (#14)

---

## 📝 NOTES

- All line numbers are approximate based on current file state
- Some errors may be cascading effects of root causes
- Test coverage needed for all critical paths
- Consider adding integration tests for Google API calls

---

**End of Error Analysis**
