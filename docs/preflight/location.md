# Pre-flight: Location & GPS

Quick reference for location handling. Read before modifying any location code.

## GPS-First Rule

**No IP fallback. No default locations. GPS or nothing.**

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
