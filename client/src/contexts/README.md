# Contexts (`client/src/contexts/`)

## Purpose

React context providers for global state management.

## Files

| File | Purpose |
|------|---------|
| `location-context-clean.tsx` | GPS, weather, air quality, snapshots |

## LocationContext

The main context provider that handles:
- Browser GPS location
- Weather fetching
- Air quality data
- Snapshot creation and saving

### Usage

```tsx
import { LocationProvider, useLocation } from './contexts/location-context-clean';

// Wrap app
<LocationProvider>
  <App />
</LocationProvider>

// Use in components
function MyComponent() {
  const {
    currentCoords,      // { latitude, longitude } - GPS only, NO city/state!
    city,               // Separate property - resolved from API
    state,              // Separate property - resolved from API
    timeZone,           // Resolved timezone
    weather,            // { temp, conditions, description }
    airQuality,         // { aqi, category }
    isLocationResolved, // NEW: Gate flag for downstream queries
    refreshGPS
  } = useLocation();
}
```

**⚠️ IMPORTANT**: `currentCoords` only has `latitude` and `longitude`. City/state are SEPARATE properties!

```tsx
// ❌ WRONG - city does NOT exist on coords
const city = locationContext.currentCoords?.city;  // undefined!

// ✅ CORRECT - city is a separate property
const city = locationContext.city;
```

### Data Flow

```
Browser GPS → LocationContext
    ├── /api/location/resolve → city, state, timezone
    ├── /api/location/weather → weather data
    ├── /api/location/airquality → AQI data
    └── /api/location/snapshot → save snapshot to DB
```

### Key Rules

From CLAUDE.md:
- **No fallbacks**: GPS-first app, no IP-based fallback
- **Single weather source**: Weather fetched here only, not in GlobalHeader
- **Deduplication**: Uses `lastEnrichmentCoordsRef` to prevent duplicate API calls
- **isLocationResolved gate**: Downstream queries (Bar Tab, Strategy) must wait for this flag

### isLocationResolved Flag (Dec 2025)

Prevents race conditions where queries fire before city/state are resolved:

```tsx
// Gate downstream queries on isLocationResolved
const { data: venuesData } = useQuery({
  queryKey: ['/api/venues/nearby', ...],
  enabled: !!(coords?.latitude && coords?.longitude &&
              locationContext?.isLocationResolved),  // Wait for resolve!
});
```

**When set to `true`:**
- After successful `/api/location/resolve` returns city + formattedAddress
- Signals that location identity is fully resolved

**When reset to `false`:**
- On `refreshGPS()` call (user requested new location)

### Events

Emits `vecto-snapshot-saved` event when snapshot is created:

```javascript
window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
  detail: { snapshotId }
}));
```

## Connections

- **Used by:** All components needing location data
- **Fetches from:** `/api/location/*` endpoints
- **Provides to:** GlobalHeader, co-pilot.tsx, etc.
