# Pre-flight: Location & GPS

Quick reference for location handling. Read before modifying any location code.

## GPS-First Rule

**No IP fallback. No default locations. GPS or nothing.**

## ABSOLUTE PRECISION - 6 DECIMALS

**This app requires pinpoint accuracy. Always use 6-decimal precision.**

```javascript
// WRONG - 4 decimals (~11 meters, causes cache collisions)
const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
const log = `Resolving ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

// CORRECT - 6 decimals (~11 centimeters, exact location)
const key = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
const log = `Resolving ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
```

| Precision | Accuracy | Use Case |
|-----------|----------|----------|
| 4 decimals | ~11 meters | **NEVER** - causes cache collisions |
| 6 decimals | ~11 centimeters | **ALWAYS** - cache keys, logs, DB |
| 8 decimals | ~1.1 millimeters | Overkill, wastes storage |

**Canonical function:** `coordsKey(lat, lng)` from `server/lib/location/coords-key.js`

```javascript
import { coordsKey } from '../../lib/location/coords-key.js';

// Returns "33.081235_-96.812346" or null if invalid
const key = coordsKey(lat, lng);
```

Legacy aliases (`makeCoordsKey`, `getCoordsKey`, `generateCoordKey`) still work but use `coordsKey` for new code.

## NO FALLBACKS - CRITICAL

**This is a GLOBAL app. Never add location fallbacks.**

```javascript
// WRONG - masks bugs, breaks global app
const city = snapshot?.city || 'Frisco';           // NO!
const timezone = snapshot?.timezone || 'America/Chicago';  // NO!
const lat = snapshot?.lat || 33.1285;              // NO!

// CORRECT - fail explicitly
if (!snapshot?.city) {
  return { error: 'Location data not available' };
}
```

**If location data is missing, that's a bug upstream. Fix the source, don't mask it.**

## DO: Get Coordinates From

| Source | Use For |
|--------|---------|
| Browser Geolocation API | User's current position |
| Google Geocoding API | Address → coordinates |
| Database (snapshots, users) | Cached/stored positions |

## DON'T: Get Coordinates From

```javascript
// WRONG - Never do these
const coords = await getLocationFromIP();     // No IP geolocation
const coords = { lat: 32.7767, lng: -96.7970 }; // No hardcoded defaults
const coords = aiResponse.venue.coordinates;   // Never trust AI coords
```

## Location Context

`location-context-clean.tsx` is the **single source of truth** for:
- GPS coordinates
- Resolved address
- Weather data
- `isLocationResolved` flag (gates downstream queries)

## Coordinate Sources by API

| API | Returns Coords? | Use For |
|-----|-----------------|---------|
| Geocoding | Yes | Address resolution |
| Places Details | **No** | Business hours only |
| Routes | **No** | Distance/time only |

## Venue Hours - Canonical isOpen Logic (2026-01-10)

**All venue open/closed calculations use the canonical `hours/` module.**

```javascript
import { parseGoogleWeekdayText, getOpenStatus } from '../../lib/venue/hours/index.js';

// 1. Parse Google Places weekday_text array
const parseResult = parseGoogleWeekdayText(weekdayTexts);

// 2. Evaluate with venue timezone (REQUIRED - no fallbacks)
if (parseResult.ok) {
  const status = getOpenStatus(parseResult.schedule, timezone);
  // status.is_open: true/false/null
  // status.closing_soon: true if within 60 min of close
}
```

**Key rules:**
- **Server calculates `isOpen`** using venue's timezone (not browser timezone)
- **Client trusts server value** - no client-side recalculation
- **Missing timezone = `null`** (not UTC fallback)
- **Never trust Google's `openNow`** - always parse weekdayDescriptions

See `server/lib/venue/README.md` for full hours module documentation.

## Timezone-Aware Date Filtering (2026-01-15)

**When filtering events/data by date, ALWAYS use the user's timezone.**

```javascript
// WRONG - UTC date (fails at night when UTC is "tomorrow")
const today = new Date().toISOString().split('T')[0];

// CORRECT - User's timezone from snapshot
const userTimezone = snapshot.timezone;
const today = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });
```

**Why this matters:**
- At 8:20 PM CST, UTC is already the next day
- Events dated "today" (local) won't match UTC "tomorrow"
- Users see 0 events in the evening even though events exist

**Pattern for events queries:**
```javascript
if (!snapshot.timezone) {
  return res.status(500).json({ error: 'Snapshot timezone required' });
}
const today = snapshot.local_iso
  ? new Date(snapshot.local_iso).toISOString().split('T')[0]
  : new Date().toLocaleDateString('en-CA', { timeZone: snapshot.timezone });
```

## Check Before Editing

- [ ] Am I using browser GPS, not IP geolocation?
- [ ] Am I getting venue coords from Google, not AI?
- [ ] Does my code respect `isLocationResolved` gating?
- [ ] Am I using `location-context-clean.tsx` for client location?
- [ ] **NO FALLBACKS**: Am I returning an error if data is missing (not using `|| 'default'`)?
- [ ] **NO HARDCODED LOCATIONS**: No cities, states, airports, timezones, or coordinates in code?
- [ ] **6-DECIMAL PRECISION**: Am I using `coordsKey()` for all coordinate key generation?
- [ ] **ROOT CAUSE**: If I'm catching coordinate errors, should they be architecturally possible?
- [ ] **VENUE HOURS**: Am I using the canonical `hours/` module for open/closed checks?
- [ ] **TIMEZONE DATES**: Am I using `snapshot.timezone` when filtering by date? (Not UTC!)
