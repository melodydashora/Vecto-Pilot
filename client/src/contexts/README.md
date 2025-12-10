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
import { LocationProvider, useLocationContext } from './contexts/location-context-clean';

// Wrap app
<LocationProvider>
  <App />
</LocationProvider>

// Use in components
function MyComponent() {
  const {
    latitude,
    longitude,
    city,
    state,
    weather,
    air,
    refreshGPS
  } = useLocationContext();
}
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
