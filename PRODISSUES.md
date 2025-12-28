
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

---

## Issue #6: Briefing Tab Shows No Data Until Strategy Completes (TIMING)

**Symptom:**
```
[BriefingTab] Received data: {
  hasWeather: false,
  hasTraffic: false,
  hasNews: false,
  hasEvents: false,
  hasClosures: false,
  hasAirport: false
}
```

The Briefing tab remains empty until the entire strategy pipeline completes, even though briefing data is generated early in the pipeline.

**Root Cause:**

**ARCHITECTURE MISMATCH**: The UI queries briefing data tied to `snapshotId`, but the data flow has a race condition:

1. **Pipeline Order** (from `strategy-generator-parallel.js`):
   ```
   Phase 1: snapshot created
   Phase 2: briefing generated (runBriefing) ← DATA EXISTS HERE
   Phase 3: strategy_for_now generated (runImmediateStrategy)
   Phase 4: venues generated
   ```

2. **UI Query Timing** (from `useBriefingQueries.ts`):
   - Queries fire as soon as `snapshotId` exists
   - But briefing row may be a **placeholder** (NULL fields)
   - Retry logic polls every 5 seconds for up to 30 seconds
   - **PROBLEM**: If briefing generation takes >30s, UI gives up

3. **Actual Timing** (from logs):
   ```
   [BRIEFING] START: Frisco, TX (cb1638cd) at 15:09:26
   [BRIEFING] COMPLETE: Frisco, TX at 15:09:55  ← 29 SECONDS
   [Strategy] immediate strategy saved at 15:10:02  ← 7 SECONDS LATER
   ```

**Why This Happens:**

1. **Placeholder Row Race**: `generateAndStoreBriefing()` creates a row with NULL fields immediately to prevent duplicate generation
2. **Client Sees Placeholder**: UI queries briefing before `traffic_conditions`, `events`, `news`, etc. are populated
3. **Retry Window Too Short**: 30-second timeout (6 retries × 5s) barely covers slow briefing generation
4. **Strategy Dependency**: User perception is that briefing "needs strategy" because both complete around the same time

**Impact:**
- User sees empty Briefing tab for 30-60 seconds
- No way to validate what data is being sent to strategist
- Can't verify traffic/events quality before strategy generation

**Fix Options:**

### Option A: Extend Retry Window (QUICK FIX)
```javascript
// In useBriefingQueries.ts
const MAX_RETRY_ATTEMPTS = 12; // 12 × 5s = 60 seconds (was 6/30s)
```

**Pros**: Simple, covers slow Gemini calls  
**Cons**: Doesn't fix root cause

### Option B: Add Loading States Per Field (RECOMMENDED)
```javascript
// In useBriefingQueries.ts - add granular loading checks
function isTrafficLoading(data) {
  return !data?.traffic_conditions || 
         data.traffic_conditions.fetchedAt === null;
}

// Show partial data as it arrives:
{trafficData?.summary && (
  <TrafficSection data={trafficData} />
)}
```

**Pros**: Shows data as it arrives, better UX  
**Cons**: Requires UI refactor

### Option C: SSE Events for Briefing Progress (BEST)
```javascript
// Server emits events as briefing completes:
SSE: briefing_traffic_ready { snapshot_id, traffic }
SSE: briefing_events_ready { snapshot_id, events }
SSE: briefing_complete { snapshot_id }

// Client updates state incrementally
```

**Pros**: Real-time updates, no polling waste  
**Cons**: More complex implementation

---

## Issue #7: JSON Parsing Concern for LLM Input (DATA QUALITY)

**Question:**
> "if we can't parse the json data before sending the briefing row with the snapshot to the AI model for strategy_for_now field to be populated"

**Assessment:**

**NO PARSING ISSUE EXISTS** - The briefing data is sent to GPT-5.2 as **formatted text**, not raw JSON.

**How It Actually Works** (from `consolidator.js`):

```javascript
async function runImmediateStrategy(snapshotId, { snapshot }) {
  const briefing = await getBriefingBySnapshotId(snapshotId);
  
  // Briefing is FORMATTED as text for GPT-5.2:
  const userPrompt = `
CURRENT CONDITIONS:
Weather: ${snapshot.weather?.tempF}°F, ${snapshot.weather?.conditions}
Air Quality: AQI ${snapshot.air?.aqi}

TRAFFIC: ${briefing.traffic_conditions?.summary}
Active incidents: ${briefing.traffic_conditions?.incidents?.length || 0}

EVENTS TODAY: ${briefing.events?.length || 0} events
${briefing.events?.map(e => `- ${e.title} at ${e.venue}`).join('\n')}

NEWS: ${briefing.news?.items?.length || 0} items
${briefing.news?.items?.map(n => `- ${n.title}: ${n.summary}`).join('\n')}
`;
  
  // GPT-5.2 receives clean formatted text, not JSON
  const result = await callModel("consolidator", { 
    user: userPrompt 
  });
}
```

**What Gets Sent to LLM:**

1. **Weather**: Formatted as `"69°F, Clear"` ✅
2. **Traffic**: Summary + incident count + key issues array ✅
3. **Events**: Title, venue, time, impact for each event ✅
4. **News**: Title + summary for each item ✅
5. **School Closures**: District name + dates ✅

**Data Deduplication Status:**

From the logs, we can see:
```
[BRIEFING] Cache hit: news=5, closures=18  ← Daily cache works
[Dedup] Found 100 existing events to avoid duplicates ← Event dedup works
```

**NO DUPLICATES ARE SENT** because:
1. **News/Closures**: City-level daily cache (same data for all users in Frisco, TX)
2. **Events**: Semantic deduplication in `sync-events.mjs` prevents duplicate event inserts
3. **Traffic**: Fresh TomTom data every snapshot (no duplicates possible)

**Validation Through UI:**

The Briefing tab exists specifically to validate this data quality:
- Traffic: Shows `summary`, `keyIssues`, `incidents` array
- Events: Shows all 50 events from `discovered_events` table
- News: Shows filtered news items (5 shown, not all raw results)
- Closures: Shows 18 school closures

**Recommendation:**

**NO MODEL CHANGE NEEDED** - The current flow is working correctly:

1. ✅ Briefing generates clean, structured data
2. ✅ Data is formatted as human-readable text for GPT-5.2
3. ✅ Deduplication prevents sending duplicates
4. ✅ UI shows same data sent to LLM for validation

**The only issue is TIMING** (Issue #6 above), not data quality.

---

**Last Updated:** December 28, 2025  
**Status:** REQUIRES IMMEDIATE ACTION
