# Event Display Issue - The Boardwalk at Granite Park

**Date:** 2025-10-30  
**Issue:** Event information ("Boo on the Boardwalk") not showing in UI despite venue being recommended  
**Venue:** The Boardwalk at Granite Park, 6600 State Hwy 121, Frisco, TX 75034

---

## Current UI Display (Missing Event Data)

```
The Boardwalk at Granite Park
Closed
6600 State Hwy 121, Frisco, TX 75034, USA

$14.00/ride • 6.6 mi • 13 min • 1x Surge
🤖 AI Generated

Closed Now
This venue is currently closed. Recommended as a strategic staging location...

Staging Area: Legacy West East Parking Garage

Pro Tips:
• Pick up at main Boardwalk valet near The Biscuit Bar
• Approach via Granite Pkwy westbound
• Steady lunch flow 12–2 PM...
```

**Missing:**
- ❌ Event badge (e.g., "🎃 Event tonight")
- ❌ Event summary ("Boo on the Boardwalk - Halloween event starting at 6 PM")
- ❌ Business hours display
- ❌ Event impact level

---

## Expected UI Display (With Event Data)

```
The Boardwalk at Granite Park
🎃 Event tonight  [← MISSING]
6600 State Hwy 121, Frisco, TX 75034, USA

$14.00/ride • 6.6 mi • 13 min • 1x Surge
🤖 AI Generated

🎃 Boo on the Boardwalk  [ℹ️ Info Icon]  [← MISSING]
Halloween festival starting at 6 PM with costume contests, 
trick-or-treating for kids, live music. Large crowd expected.
Impact: High demand expected

Business Hours: 11 AM - 9 PM  [← MISSING]
Currently closed (opens in 2 hours)

Staging Area: Legacy West East Parking Garage

Pro Tips:
• Pick up at main Boardwalk valet near The Biscuit Bar
...
```

---

## Data Flow Analysis

### 1. Event Research (Perplexity API)
**File:** `server/lib/venue-event-research.js`

**Process:**
```javascript
researchVenueEvents(venueName, city, date)
  ↓
  Perplexity search query:
  "Events happening today at The Boardwalk at Granite Park in Frisco"
  ↓
  Parse response:
  {
    has_events: true/false,
    summary: "Boo on the Boardwalk - Halloween festival...",
    badge: "🎃 Event tonight",
    citations: ["https://..."],
    impact_level: "high",
    researched_at: "2025-10-30T...",
    date: "2025-10-30"
  }
```

**Debug Checks:**
- [ ] Is Perplexity API being called for this venue?
- [ ] Check logs for: `[PERPLEXITY] Venue Events Query`
- [ ] Verify API response contains event data
- [ ] Check if `has_events` is correctly set to `true`

### 2. Database Storage
**File:** `server/routes/blocks.js:729`

**Process:**
```javascript
UPDATE ranking_candidates 
SET venue_events = $1
WHERE ranking_id = $2 AND place_id = $3
```

**Debug Checks:**
- [ ] Query database: `SELECT venue_events FROM ranking_candidates WHERE name LIKE '%Boardwalk%'`
- [ ] Verify JSONB structure matches expected format
- [ ] Check if `place_id` matches between GPT-5 suggestion and Places API
- [ ] Confirm `ranking_id` is correct

**Expected Data:**
```json
{
  "venue_name": "The Boardwalk at Granite Park",
  "has_events": true,
  "summary": "Boo on the Boardwalk - Halloween festival with costume contests, trick-or-treating...",
  "badge": "🎃 Event tonight",
  "citations": ["https://theboardwalkatgranitepark.com/events/..."],
  "impact_level": "high",
  "researched_at": "2025-10-30T18:20:00.000Z",
  "date": "2025-10-30"
}
```

### 3. API Response (Blocks Endpoint)
**File:** `server/routes/blocks.js:872-875`

**Process:**
```javascript
const eventData = eventsMap.get(block.placeId) || null;

return {
  hasEvent: eventData?.has_events || false,
  eventBadge: eventData?.badge || null,
  eventSummary: eventData?.summary || null,
  eventImpact: eventData?.impact || null
}
```

**Debug Checks:**
- [ ] Add console.log in blocks.js line 828: `console.log('Event Data for', v.name, ':', eventData)`
- [ ] Verify `eventsMap` contains entry for this `place_id`
- [ ] Check if `place_id` is null or mismatched
- [ ] Confirm API response includes event fields

### 4. UI Rendering
**File:** `client/src/pages/co-pilot.tsx:1146-1189`

**Process:**
```tsx
{block.hasEvent && block.eventBadge && (
  <div className="bg-indigo-50 border-2 border-indigo-400">
    <span>{block.eventBadge.split(' ')[0]}</span>
    <p>{block.eventBadge.split(' ').slice(1).join(' ')}</p>
    
    {block.eventSummary && (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Info className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>
            <p>{block.eventSummary}</p>
            {block.eventImpact && (
              <span>Impact: {block.eventImpact} demand expected</span>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )}
  </div>
)}
```

**Debug Checks:**
- [ ] Console.log in browser: `blocks.filter(b => b.name.includes('Boardwalk'))[0]`
- [ ] Check if `hasEvent` is `true`
- [ ] Verify `eventBadge` and `eventSummary` are populated
- [ ] Confirm tooltip component is rendering

---

## Common Failure Points

### Issue 1: Place ID Mismatch
**Symptom:** Event data in database but not appearing in UI

**Cause:** GPT-5 suggests venue with coordinates → Google Places API returns different `place_id` than what's stored

**Solution:**
```javascript
// In venue-enrichment.js, ensure place_id is consistently used
const placeDetails = await getPlaceDetails(venue.lat, venue.lng, venue.name);
// placeDetails.place_id MUST match the one used in event research
```

**Verification:**
```sql
SELECT name, place_id, venue_events 
FROM ranking_candidates 
WHERE name LIKE '%Boardwalk%';
```

### Issue 2: Event Research Not Triggered
**Symptom:** No event data in database at all

**Cause:** `researchMultipleVenueEvents` not called or failed silently

**Solution:**
```javascript
// In blocks.js, verify event research is called
console.log(`🎪 [${correlationId}] Starting event research for ${venues.length} venues...`);
const eventResults = await researchMultipleVenueEvents(venues, date);
console.log(`🎪 [${correlationId}] Event research complete:`, eventResults.length);
```

**Check Logs:**
```bash
grep "Starting event research" /tmp/logs/*.log
grep "PERPLEXITY.*Boardwalk" /tmp/logs/*.log
```

### Issue 3: Timing Issue
**Symptom:** Event data populated AFTER UI has already rendered

**Cause:** Event research happens asynchronously after blocks response sent

**Solution:** Ensure event research completes BEFORE sending blocks response:
```javascript
// WRONG:
sendResponse(blocks);
await researchEvents(); // Too late!

// RIGHT:
await researchEvents();
await updateDatabase();
sendResponse(blocks); // Event data included
```

### Issue 4: Business Hours Missing
**Symptom:** No "Business Hours" field displayed

**Cause:** `getPlaceDetails` not returning formatted hours, or hours normalization failing

**Debug:**
```javascript
// In venue-enrichment.js
const placeDetails = await getPlaceDetails(venue.lat, venue.lng, venue.name, timezone);
console.log('Place Details for', venue.name, ':', placeDetails.businessHours);
```

**Expected Output:**
```javascript
{
  businessHours: "Mon-Thu 11AM-9PM, Fri-Sat 11AM-10PM, Sun 11AM-8PM",
  isOpen: false,
  businessStatus: "OPERATIONAL"
}
```

---

## Diagnostic SQL Queries

### Check if event data exists
```sql
SELECT 
  name,
  place_id,
  venue_events->'has_events' as has_events,
  venue_events->'badge' as badge,
  venue_events->'summary' as summary,
  venue_events->'impact_level' as impact
FROM ranking_candidates 
WHERE name LIKE '%Boardwalk%' 
ORDER BY created_at DESC 
LIMIT 3;
```

### Check all event-enabled venues
```sql
SELECT 
  name,
  venue_events->'badge' as event_badge
FROM ranking_candidates 
WHERE venue_events IS NOT NULL 
  AND venue_events->>'has_events' = 'true'
ORDER BY created_at DESC 
LIMIT 10;
```

### Verify event research logs
```sql
SELECT 
  created_at,
  venue_name,
  has_events,
  badge,
  impact_level,
  error
FROM venue_event_research_log  -- If this table exists
WHERE venue_name LIKE '%Boardwalk%'
ORDER BY created_at DESC;
```

---

## Quick Fix Checklist

1. **Restart Workflow** - Ensure latest code is running
2. **Check Logs** - Look for Perplexity API calls
3. **Query Database** - Verify event data is stored
4. **Test API** - `curl http://localhost:5000/api/blocks?...` and check response
5. **Browser Console** - Log `blocks` array and inspect event fields
6. **Force Refresh** - Clear localStorage and trigger new strategy generation

---

## Recommended Investigation Steps

### Step 1: Enable Debug Logging
Add to `server/routes/blocks.js` around line 828:
```javascript
blocks.forEach((block, index) => {
  console.log(`Block ${index}: ${block.name}`);
  console.log(`  - hasEvent: ${block.hasEvent}`);
  console.log(`  - eventBadge: ${block.eventBadge}`);
  console.log(`  - eventSummary: ${block.eventSummary ? block.eventSummary.substring(0, 50) + '...' : 'null'}`);
  console.log(`  - placeId: ${block.placeId}`);
});
```

### Step 2: Add Frontend Debugging
In `client/src/pages/co-pilot.tsx`, add after blocks are loaded:
```javascript
useEffect(() => {
  if (blocks && blocks.length > 0) {
    const boardwalk = blocks.find(b => b.name.includes('Boardwalk'));
    if (boardwalk) {
      console.log('🎪 Boardwalk Block Data:', {
        hasEvent: boardwalk.hasEvent,
        eventBadge: boardwalk.eventBadge,
        eventSummary: boardwalk.eventSummary,
        eventImpact: boardwalk.eventImpact
      });
    }
  }
}, [blocks]);
```

### Step 3: Verify Event Research Timing
Add timestamp logging to track when event research happens:
```javascript
console.log(`[${new Date().toISOString()}] EVENT RESEARCH START`);
const events = await researchMultipleVenueEvents(venues);
console.log(`[${new Date().toISOString()}] EVENT RESEARCH END - ${events.length} results`);
```

### Step 4: Check Place ID Consistency
```javascript
// After venue enrichment
console.log('Venue Place IDs:', venues.map(v => ({
  name: v.name,
  place_id: v.place_id,
  coordinates: `${v.lat},${v.lng}`
})));

// After event research
console.log('Event Research Place IDs:', eventResults.map(e => ({
  venue_name: e.venue_name,
  place_id: e.place_id  // Should match above
})));
```

---

## Expected Log Sequence (Working System)

```
[blocks] Starting blocks generation for snapshot: abc123...
[TRIAD 2/3 - GPT-5 Planner] Calling GPT-5...
[GPT-5] Recommended 6 venues
[Venue Enrichment] Enriching 6 venues...
[Venue Enrichment] ✅ The Boardwalk at Granite Park enriched (place_id: ChIJ...)
[venue-events] Researching events for 6 venues...
🔍 [PERPLEXITY] Venue Events Query: "Events happening today at The Boardwalk at Granite Park in Frisco"
📰 [PERPLEXITY] Venue Events Response: { answer: "Boo on the Boardwalk...", citations: 7 }
✅ [PERPLEXITY] Event data: { has_events: true, badge: "🎃 Event tonight", impact: "high" }
[blocks] Updating venue_events for place_id ChIJ... with event data
🎪 [CORR-123] Added event for place_id "ChIJ...": 🎃 Event tonight
[blocks] Sending 6 blocks with event data
```

---

## Contact for Help

If issue persists after debugging:
1. Capture full logs showing Perplexity call + database update
2. Export SQL query results showing venue_events data
3. Provide browser console showing blocks array
4. Share correlation ID for the specific request
