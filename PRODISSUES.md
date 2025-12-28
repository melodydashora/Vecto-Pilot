
# Production Issues - Root Cause Analysis

**Generated:** December 28, 2025  
**Environment:** Production deployment on Replit  
**Analysis Period:** Recent deployment logs

---

## Executive Summary

Analysis of production logs reveals **3 critical issues** and **2 warnings** that require immediate attention:

1. **CRITICAL:** Google Places API returning 0% name matches (venue enrichment failure)
2. **CRITICAL:** Venues showing `isOpen=null` and `hours=unknown` (no business hours data)
3. **CRITICAL:** Event verification disabled (0 events verified)
4. **WARNING:** Event matcher finding events but GPT-5.2 address resolution may be inaccurate
5. **WARNING:** Multiple DB reconnection events (connection pool instability)

---

## Critical Issues

### 1. Google Places API Name Matching Failure (CRITICAL)

**Symptom:**
```
🏢 [VENUES 3/4 - Places API] ⚠️ "Legacy Hall (Food Hall) – 7800 Windrose Ave" → Google found "MUG Beauty Co." (0% match) - REJECTED (below 20% threshold)
🏢 [VENUES 3/4 - Places API] ⚠️ "Union Bear Brewing Co. (Granite Park)" → Google found "KLW Demolition" (0% match) - REJECTED (below 20% threshold)
🏢 [VENUES 3/4 - Places API] ⚠️ "Dallas/Plano Marriott at Legacy Town Center" → Google found "Scruffy Duffies" (0% match) - REJECTED (below 20% threshold)
```

**Root Cause:**

The Google Places API `findPlace` queries are resolving to **completely wrong businesses** at the same coordinates. This indicates:

1. **GPT-5.2 tactical planner is providing coordinates that don't match the venue names**
   - Coordinates may be for parking lots, street addresses, or nearby landmarks
   - LLM "hallucinating" exact coordinates without Google verification

2. **Places API is returning the nearest business at those coordinates, not the intended venue**
   - `findPlace` uses `locationBias` which finds ANY business near those coords
   - If coords are off by even 50m, it returns wrong business

**Impact:**
- **100% of venues** showing `hours=unknown` and `isOpen=null`
- No operational intelligence (can't tell if venues are open)
- SmartBlocks recommendations are unreliable
- User experience severely degraded

**Fix Required:**

**Option A: Switch to Text Search (Recommended)**
```javascript
// In server/lib/venue/venue-enrichment.js
// REPLACE findPlace with textSearch for better name matching
const request = {
  textQuery: `${venueName} ${venueAddress}`,  // Full text query
  locationBias: {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: 200  // 200m radius
    }
  }
};
```

**Option B: Two-pass verification**
1. First pass: Use GPT-5.2 coords as-is
2. If name match < 20%: Do a second Places API call with text search only
3. Compare both results, take better match

**File:** `server/lib/venue/venue-enrichment.js` lines 150-250

---

### 2. All Venues Showing `isOpen=null` and `hours=unknown` (CRITICAL)

**Symptom:**
```
🏢 [VENUE "Legacy Hall (Legacy West)"] 2.7mi, 8min, isOpen=null, hours=unknown
🏢 [VENUE "Renaissance Dallas at Plano Legacy West Hotel"] 3.3mi, 10min, isOpen=null, hours=unknown
🏢 [VENUE "Cambria Hotel Plano - Frisco"] 3.3mi, 8min, isOpen=null, hours=unknown
```

**Root Cause:**

This is a **cascading failure** from Issue #1:

1. Places API returns wrong business (0% name match)
2. Code **rejects** the result due to < 20% threshold
3. Venue enrichment marks it as `[UNVERIFIED]`
4. No business hours extracted → `hours=unknown`
5. No `isOpen` calculation possible → `isOpen=null`

**Impact:**
- Users cannot filter by "Open Now"
- Strategy recommendations include closed venues
- No time-based venue intelligence
- BarsTable shows "Unknown" for all open/closed statuses

**Fix Required:**

Depends on fixing Issue #1. Once Places API returns correct venues:
- `regularOpeningHours` will populate
- `isOpen` will be calculated server-side
- Client can display accurate status

**Temporary Mitigation:**

Show venues regardless of status but add disclaimer:
```javascript
// In client/src/components/BarsTable.tsx
{isOpen === null && (
  <Badge variant="outline">Status Unknown - Call First</Badge>
)}
```

---

### 3. Event Verification Disabled (CRITICAL)

**Symptom:**
```
[event-verifier] No events to verify
🏢 [VENUES 3/4 - Places API] ✅ 0 verified events extracted (1ms)
```

**Root Cause:**

The event verifier is **completely disabled**:

1. `sync-events.mjs` discovers 21 events successfully
2. Events stored in `discovered_events` table
3. Event matcher finds 54 events for Frisco, TX
4. **BUT:** Event verifier receives empty array

**Likely Cause:**

Either:
- Event matcher is not passing events to verifier (filter too strict)
- Verifier input validation rejecting all events
- Code path bypassing verification entirely

**Investigation Required:**

Check `server/lib/venue/event-matcher.js`:
```javascript
// Look for this pattern:
const eventsToVerify = matchedEvents.filter(e => e.needsVerification);
// If filter is too strict, eventsToVerify will be []
```

Check `server/lib/subagents/event-verifier.js`:
```javascript
// Look for early return:
if (!events || events.length === 0) {
  return { verified: [], rejected: [] };  // ← This is happening
}
```

**Fix Required:**

1. Add logging to event-matcher output:
   ```javascript
   console.log(`[event-matcher] Matched ${matchedEvents.length} events, ${eventsToVerify.length} need verification`);
   ```

2. Verify event-matcher is actually passing events:
   ```javascript
   // In venue-enrichment.js after event matching
   console.log(`[event-matcher] Passing ${eventsToVerify.length} events to verifier:`, eventsToVerify.map(e => e.event_name));
   ```

3. Check verifier isn't silently failing

**Impact:**
- Events shown on venues are **unverified**
- May include outdated/cancelled events
- User trust in event data compromised

---

## Warnings

### 4. Event Matcher Address Matching May Be Inaccurate (WARNING)

**Symptom:**
```
[event-matcher] ✅ MATCH: "Equinox Plano (Legacy West)" ↔ "Legacy West - Reindeer Run Club (Weekly Run/Walk 5K)" (address match)
```

**Root Cause:**

Event matcher using **loose address matching** that may false-positive:
- Both have "Legacy West" in the name
- But actual addresses may differ significantly
- GPT-5.2 may have invented coordinates for the event

**Investigation Required:**

Check `server/lib/venue/event-matcher.js` address matching logic:
```javascript
// Current logic (from LESSONS_LEARNED.md):
function addressesMatchStrictly(addr1, addr2) {
  const num1 = extractStreetNumber(addr1);  // "6991"
  const num2 = extractStreetNumber(addr2);
  if (num1 !== num2) return false;  // Numbers must match
  
  const street1 = extractStreetName(addr1);  // "main"
  const street2 = extractStreetName(addr2);
  return street1 === street2 || street1.includes(street2);
}
```

**Potential Issue:**
- Events discovered by GPT-5.2 may have **approximate addresses**
- "Legacy West" is a district, not a street address
- May need fuzzy matching for event venues vs. strict matching

**Fix Required:**

Add logging to show WHY match succeeded:
```javascript
console.log(`[event-matcher] MATCH: "${venueName}" ↔ "${eventName}" (${matchReason}: num=${num1}, street=${street1})`);
```

---

### 5. Database Connection Pool Instability (WARNING)

**Symptom:**
```
💾 [DB 1/1] ✅ LISTEN client reconnected  ← 💾
💾 [DB 1/1] ✅ LISTEN client reconnected  ← 💾
💾 [DB 1/1] ✅ LISTEN client reconnected  ← 💾
```

**Root Cause:**

PostgreSQL `LISTEN` client is **repeatedly disconnecting and reconnecting**. This indicates:

1. **Network instability** between app and database
2. **Connection timeout** too aggressive (PG_IDLE_TIMEOUT_MS)
3. **Database autoscale** causing connection churn
4. **LISTEN notifications** not keeping connection alive

**Impact:**
- SSE events may be delayed
- Strategy/blocks notifications may drop
- Users may not see real-time updates

**Investigation Required:**

Check `server/db/connection-manager.js`:
```javascript
// Current timeout (from LESSONS_LEARNED.md):
PG_IDLE_TIMEOUT_MS=10000  // 10s for autoscale

// For production, may need:
PG_IDLE_TIMEOUT_MS=30000  // 30s to reduce churn
```

**Fix Required:**

1. **Increase idle timeout** for production:
   ```bash
   PG_IDLE_TIMEOUT_MS=30000
   ```

2. **Add keepalive pings** to LISTEN connection:
   ```javascript
   // In connection-manager.js
   setInterval(() => {
     listenClient.query('SELECT 1');  // Keepalive
   }, 25000);  // Every 25s
   ```

3. **Add reconnection backoff** to prevent rapid reconnects:
   ```javascript
   let reconnectDelay = 1000;  // Start at 1s
   const maxDelay = 30000;     // Max 30s
   
   function reconnect() {
     setTimeout(() => {
       connect();
       reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
     }, reconnectDelay);
   }
   ```

---

## Action Items

### Immediate (Today)

1. **Fix Places API name matching** (Issue #1)
   - Switch from `findPlace` to `textSearch`
   - Test with "Legacy Hall" and "Union Bear Brewing Co."

2. **Enable event verification** (Issue #3)
   - Add debug logging to event-matcher
   - Verify events are passed to verifier
   - Re-enable verification flow

### High Priority (This Week)

3. **Fix business hours** (Issue #2)
   - Depends on #1 being fixed
   - Add fallback to text search if name match < 20%

4. **Stabilize DB connections** (Issue #5)
   - Increase PG_IDLE_TIMEOUT_MS to 30000
   - Add LISTEN keepalive pings

### Medium Priority (Next Week)

5. **Improve event matcher logging** (Issue #4)
   - Add match reason to logs
   - Verify address matching accuracy

---

## Testing Checklist

After fixes:

- [ ] Places API returns correct venues (name match > 80%)
- [ ] All venues show accurate `isOpen` status
- [ ] All venues show `hours` (e.g., "Mon-Fri: 8AM-10PM")
- [ ] Event verifier processes matched events
- [ ] No DB reconnection spam in logs (< 1 per minute)
- [ ] SmartBlocks UI shows "Open Now" badges correctly

---

## Files Requiring Changes

| File | Issue | Priority |
|------|-------|----------|
| `server/lib/venue/venue-enrichment.js` | #1, #2 | CRITICAL |
| `server/lib/venue/event-matcher.js` | #4 | MEDIUM |
| `server/lib/subagents/event-verifier.js` | #3 | CRITICAL |
| `server/db/connection-manager.js` | #5 | HIGH |
| `client/src/components/BarsTable.tsx` | #2 (temp fix) | HIGH |

---

## Monitoring

Add these metrics to production monitoring:

1. **Places API match rate**: `(matches_above_20_percent / total_venues) * 100`
2. **Venues with hours**: `(venues_with_hours / total_venues) * 100`
3. **Events verified**: `verified_events_count`
4. **DB reconnection rate**: `reconnections_per_minute`

Target SLAs:
- Places API match rate: > 80%
- Venues with hours: > 90%
- Events verified: > 50% of matched events
- DB reconnection rate: < 1/min

---

**Last Updated:** December 28, 2025  
**Status:** REQUIRES IMMEDIATE ACTION
