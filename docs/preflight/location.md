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

**Key function:** `makeCoordsKey(lat, lng)` in `location.js` and `snapshot.js`

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

## Check Before Editing

- [ ] Am I using browser GPS, not IP geolocation?
- [ ] Am I getting venue coords from Google, not AI?
- [ ] Does my code respect `isLocationResolved` gating?
- [ ] Am I using `location-context-clean.tsx` for client location?
- [ ] **NO FALLBACKS**: Am I returning an error if data is missing (not using `|| 'default'`)?
- [ ] **NO HARDCODED LOCATIONS**: No cities, states, airports, timezones, or coordinates in code?
- [ ] **6-DECIMAL PRECISION**: Am I using `toFixed(6)` for all coordinate formatting/caching?
- [ ] **ROOT CAUSE**: If I'm catching coordinate errors, should they be architecturally possible?
