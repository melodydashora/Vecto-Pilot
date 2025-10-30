# Business Hours Display Issue

**Date:** 2025-10-30  
**Issue:** Business hours not showing in UI for venues  
**Example:** The Boardwalk at Granite Park showing "Closed" but no hours displayed

---

## Expected vs. Actual Display

### Expected
```
The Boardwalk at Granite Park
🎃 Event tonight
6600 State Hwy 121, Frisco, TX 75034

🕐 Mon-Thu 11AM-9PM, Fri-Sat 11AM-10PM, Sun 11AM-8PM  [← MISSING]
Currently closed (opens in 2 hours)

Pro Tips:
...
```

### Actual
```
The Boardwalk at Granite Park
Closed
6600 State Hwy 121, Frisco, TX 75034

Closed Now  [← Generic message, no hours]
This venue is currently closed. Recommended as a strategic staging location...

Pro Tips:
...
```

---

## Data Flow Analysis

### 1. Google Places API (Source)
**File:** `server/lib/venue-enrichment.js:438-461`

**Expected Response:**
```javascript
{
  weekday_text: [
    "Monday: 11:00 AM – 9:00 PM",
    "Tuesday: 11:00 AM – 9:00 PM",
    // ...
  ],
  isOpen: false,
  businessHours: "Mon-Thu 11AM-9PM, Fri-Sat 11AM-10PM, Sun 11AM-8PM"
}
```

**Code:**
```javascript
const isOpen = calculateIsOpen(weekdayTexts, timezone);
const condensedHours = weekdayTexts ? condenseHours(weekdayTexts) : null;

return {
  isOpen: isOpen,
  businessHours: condensedHours || null,
  // ...
}
```

**Debug Checks:**
- [ ] Is `weekdayTexts` populated by Google Places API?
- [ ] Is `condenseHours()` working correctly?
- [ ] Is `businessHours` null or empty string?

### 2. Blocks API (Pass-through)
**File:** `server/routes/blocks.js`

**Expected to Include:**
```javascript
{
  isOpen: true/false,
  businessHours: "Mon-Thu 11AM-9PM...",
  // ...
}
```

**Debug Checks:**
- [ ] Check if `businessHours` field is included in API response
- [ ] Verify field name matches (camelCase vs. snake_case)
- [ ] Confirm field is not filtered out

### 3. Frontend Display
**File:** `client/src/pages/co-pilot.tsx:1189-1196`

**Code:**
```tsx
{block.businessHours && (
  <div className="flex items-center gap-2 mb-3 text-sm">
    <Clock className="w-4 h-4 text-blue-600" />
    <span className="text-gray-700">
      {block.businessHours}
    </span>
  </div>
)}
```

**Debug Checks:**
- [ ] Console.log `block.businessHours` value
- [ ] Check if conditional `block.businessHours &&` is falsy
- [ ] Verify Clock icon is imported from lucide-react

---

## Common Failure Points

### Issue 1: Google Places API Not Returning Hours
**Symptom:** `weekdayTexts` is null or undefined

**Causes:**
- Venue doesn't have hours in Google Maps
- API response missing `opening_hours` field
- Place details using wrong field name (e.g., `current_opening_hours` vs `opening_hours`)

**Solution:**
```javascript
// In getPlaceDetails, ensure we're requesting opening_hours
const fields = [
  'name',
  'formatted_address',
  'geometry',
  'place_id',
  'opening_hours',  // ← Make sure this is included
  'business_status'
];
```

### Issue 2: Hours Condensing Failing
**Symptom:** `condenseHours()` returns null despite having valid input

**Cause:** Regex parsing fails on Google's hour format

**Debug:**
```javascript
console.log('Raw weekdayTexts:', weekdayTexts);
const condensed = condenseHours(weekdayTexts);
console.log('Condensed hours:', condensed);
```

**Expected:**
```
Raw weekdayTexts: [
  "Monday: 11:00 AM – 9:00 PM",
  "Tuesday: 11:00 AM – 9:00 PM",
  ...
]
Condensed hours: "Mon-Thu 11AM-9PM, Fri-Sat 11AM-10PM, Sun 11AM-8PM"
```

### Issue 3: Field Not Passed Through Blocks API
**Symptom:** `businessHours` in enrichment but missing in API response

**Cause:** Field not mapped in blocks.js response builder

**Solution:** Verify blocks.js includes businessHours in the response:
```javascript
const block = {
  name: v.name,
  address: v.address,
  isOpen: v.isOpen,
  businessHours: v.businessHours,  // ← Must be here
  // ...
};
```

### Issue 4: UI Conditional Not Triggering
**Symptom:** `businessHours` exists but UI not rendering

**Cause:** Falsy value check failing (empty string, "unknown", etc.)

**Debug:**
```javascript
console.log('Block businessHours value:', `"${block.businessHours}"`);
console.log('Is truthy?', !!block.businessHours);
```

---

## Missing Hours Default Policy

**From replit.md:**
> Missing business hours default to "unknown" and never "closed" - this prevents false "closed" states (e.g., IKEA showing closed when hours data is unavailable).

**Current Behavior:** Shows generic "Closed Now" message

**Expected Behavior:**
```tsx
{!block.businessHours && !block.isOpen && (
  <div className="text-sm text-gray-600">
    Business hours unknown
  </div>
)}

{block.businessHours && !block.isOpen && (
  <div className="text-sm text-gray-700">
    {block.businessHours}
    <br />
    <span className="text-red-600">Currently closed</span>
  </div>
)}
```

---

## Diagnostic Steps

### Step 1: Check Google Places API Response
Add logging to `venue-enrichment.js`:
```javascript
const placeDetails = await getPlaceDetails(venue.lat, venue.lng, venue.name, timezone);
console.log('📍 Place Details for', venue.name, ':', {
  weekday_text: placeDetails?.weekday_text,
  isOpen: placeDetails?.isOpen,
  businessHours: placeDetails?.businessHours,
  business_status: placeDetails?.business_status
});
```

### Step 2: Verify Blocks API Response
```bash
curl 'http://localhost:5000/api/blocks?snapshotId=xxx' | jq '.blocks[] | select(.name | contains("Boardwalk")) | {name, businessHours, isOpen}'
```

Expected output:
```json
{
  "name": "The Boardwalk at Granite Park",
  "businessHours": "Mon-Thu 11AM-9PM, Fri-Sat 11AM-10PM, Sun 11AM-8PM",
  "isOpen": false
}
```

### Step 3: Frontend Debugging
Add to `client/src/pages/co-pilot.tsx`:
```javascript
useEffect(() => {
  if (blocks && blocks.length > 0) {
    blocks.forEach((block, i) => {
      console.log(`Block ${i}: ${block.name}`);
      console.log(`  - businessHours: "${block.businessHours}"`);
      console.log(`  - isOpen: ${block.isOpen}`);
      console.log(`  - Will display hours? ${!!block.businessHours}`);
    });
  }
}, [blocks]);
```

### Step 4: Check Google Places API Fields
Verify the API request includes the right fields:
```javascript
// In places-hours.js or venue-enrichment.js
const response = await fetch(
  `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours,current_opening_hours,business_status&key=${API_KEY}`
);
```

Note: Google has TWO hour fields:
- `opening_hours` - Regular hours
- `current_opening_hours` - Special hours (holidays, etc.)

We should check both!

---

## Quick Fix Implementation

### Option 1: Use "Hours Unknown" Fallback
```tsx
{/* Business Hours - Always show something */}
<div className="flex items-center gap-2 mb-3 text-sm">
  <Clock className="w-4 h-4 text-blue-600" />
  <span className="text-gray-700">
    {block.businessHours || 'Business hours unknown'}
  </span>
  {!block.isOpen && block.businessHours && (
    <Badge variant="destructive" className="ml-2">Closed Now</Badge>
  )}
</div>
```

### Option 2: Calculate Hours from Google Data
If Google provides structured hours but not text:
```javascript
// Parse opening_hours.periods array
const periods = placeDetails?.opening_hours?.periods;
if (periods) {
  const formattedHours = formatPeriodsToText(periods);
  // "Mon-Fri 9AM-5PM, Sat 10AM-2PM"
}
```

### Option 3: Show "Check Google Maps" Link
```tsx
{!block.businessHours && (
  <a 
    href={`https://www.google.com/maps/place/?q=place_id:${block.placeId}`}
    target="_blank"
    className="text-sm text-blue-600 hover:underline"
  >
    View hours on Google Maps →
  </a>
)}
```

---

## Testing Checklist

- [ ] Venue with known hours displays correctly
- [ ] Venue without hours shows "unknown" (not "closed")
- [ ] Currently open venue shows hours + "Open Now"
- [ ] Currently closed venue shows hours + "Closed Now"
- [ ] 24/7 venue shows "Open 24 hours"
- [ ] Venue with special hours (holiday) shows correct hours

---

## API Request Examples

### Get Place Details with Hours
```javascript
const url = `https://maps.googleapis.com/maps/api/place/details/json`;
const params = {
  place_id: 'ChIJxxx',
  fields: 'opening_hours,current_opening_hours,business_status,utc_offset_minutes',
  key: process.env.GOOGLE_MAPS_API_KEY
};
```

### Expected Response
```json
{
  "result": {
    "opening_hours": {
      "open_now": false,
      "periods": [
        {
          "open": {"day": 0, "time": "1100"},
          "close": {"day": 0, "time": "2000"}
        }
      ],
      "weekday_text": [
        "Monday: 11:00 AM – 9:00 PM",
        "Tuesday: 11:00 AM – 9:00 PM",
        "Wednesday: 11:00 AM – 9:00 PM",
        "Thursday: 11:00 AM – 9:00 PM",
        "Friday: 11:00 AM – 10:00 PM",
        "Saturday: 11:00 AM – 10:00 PM",
        "Sunday: 11:00 AM – 8:00 PM"
      ]
    },
    "business_status": "OPERATIONAL"
  }
}
```

---

## Root Cause Summary

Most likely causes (in order of probability):

1. **Google Places API not returning hours** - Venue not in Google's database or missing hours
2. **Wrong field name** - Using `opening_hours` when should use `current_opening_hours`
3. **Field not passed through** - `businessHours` enriched but not included in blocks response
4. **UI conditional issue** - Hours exist but display conditional failing

**Recommended Action:** Add debug logging to all three layers (enrichment → blocks → UI) and trace where the data is lost.
