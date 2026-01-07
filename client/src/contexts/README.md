> **Last Verified:** 2026-01-07

# Contexts (`client/src/contexts/`)

## ⚠️ Manual Refresh Event (2026-01-07)

When user clicks the refresh button (GlobalHeader spindle):
1. `location-context-clean.tsx` dispatches `vecto-strategy-cleared` event
2. `co-pilot-context.tsx` listens and clears strategy state + react-query cache
3. New snapshot is created → `vecto-snapshot-saved` triggers strategy regeneration

This ensures the UI shows loading state immediately, not stale strategy.

## Purpose

React context providers for global state management.

## Files

| File | Purpose |
|------|---------|
| `auth-context.tsx` | Authentication state (login, register, JWT tokens) |
| `co-pilot-context.tsx` | Shared state for co-pilot pages (strategy, blocks, SSE) |
| `location-context-clean.tsx` | GPS, weather, air quality, snapshots |

## AuthContext

Provides authentication state and methods:

```tsx
import { AuthProvider, useAuth } from './contexts/auth-context';

// Wrap app
<AuthProvider>
  <App />
</AuthProvider>

// Use in components
function MyComponent() {
  const {
    user,               // Current user object
    profile,            // Driver profile data
    vehicle,            // Vehicle information
    token,              // JWT token
    isAuthenticated,    // Auth status flag
    isLoading,          // Loading state
    login,              // Login function
    register,           // Registration function
    logout,             // Logout function
    refreshProfile,     // Refresh profile data
    updateProfile       // Update profile
  } = useAuth();
}
```

### Token Storage

JWT tokens are stored in localStorage under `vectopilot_auth_token` and automatically restored on app load.

## CoPilotContext

Provides shared state across all co-pilot pages:

```tsx
import { CoPilotProvider, useCoPilot } from './contexts/co-pilot-context';

// Wrap pages
<CoPilotProvider>
  <CoPilotLayout />
</CoPilotProvider>

// Use in components
function MyComponent() {
  const {
    strategyData,           // Current strategy from API
    blocksData,             // Smart blocks from API
    persistentStrategy,     // Daily strategy
    immediateStrategy,      // NOW strategy
    isGenerating,           // Strategy generation in progress
    enrichmentProgress,     // Enrichment progress percentage
    refreshStrategy         // Trigger strategy refresh
  } = useCoPilot();
}
```

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

## Critical Rules - Memoization

**IMPORTANT (2026-01-06):** All contexts MUST properly memoize their values to prevent infinite re-render loops.

### Rule 1: Context Value Must Be Memoized
```tsx
// ✅ CORRECT
const value = useMemo(() => ({
  someData,
  someFunction,
}), [someData, someFunction]);

// ❌ WRONG - Creates new object every render
<Context.Provider value={{ someData, someFunction }}>
```

### Rule 2: Derived Values in Dependencies Must Also Be Memoized

If you compute a value using `.map()`, `.filter()`, or any array/object transformation, you MUST wrap it in `useMemo`:

```tsx
// ❌ WRONG - .map() creates new array every render
const transformedItems = items.map(x => transform(x));
const value = useMemo(() => ({
  transformedItems,  // New reference every render!
}), [transformedItems]);  // This defeats the purpose of useMemo!

// ✅ CORRECT - Memoize the derived value too
const transformedItems = useMemo(
  () => items.map(x => transform(x)),
  [items]
);
const value = useMemo(() => ({
  transformedItems,  // Now stable!
}), [transformedItems]);
```

**Why?** `.map()` ALWAYS returns a new array reference. React's dependency comparison uses reference equality (`Object.is()`), so unmemoized derived values cause the context to recalculate on every render.

See `LESSONS_LEARNED.md` → "Derived Values in useMemo Dependencies" for full details.

## Connections

- **Used by:** All components needing location data
- **Fetches from:** `/api/location/*` endpoints
- **Provides to:** GlobalHeader, co-pilot.tsx, etc.
