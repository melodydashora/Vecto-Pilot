// server/api/location/index.js - Barrel exports for location routes
// Location endpoints: GPS resolution, geocoding, weather, AQ, snapshots

export { default as locationRouter } from './location.js';
export { default as snapshotRouter } from './snapshot.js';

// Route summary:
// GET  /api/location/resolve - GPS → Address resolution
// GET  /api/location/ip - IP-based geolocation fallback (for previews/iframes)
// GET  /api/location/weather - Current weather + forecast
// GET  /api/location/airquality - AQI data
// POST /api/location/snapshot - Save location snapshot
// GET  /api/snapshot/:id - Fetch snapshot data
// GET  /api/users/me - Current user's location
