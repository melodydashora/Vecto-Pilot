// server/lib/location/index.js - Barrel exports for location module
// GPS, geocoding, weather, timezone, and snapshot context

// Core location operations
// 2026-01-15: Removed stale reverseGeocode/forwardGeocode/getTimezone exports from geo.js
// - reverseGeocode: now in venue-address-resolver.js (local function)
// - forwardGeocode: use geocodeAddress() from geocode.js directly
// - getTimezone: use getTimezoneForCoords() from geocode.js directly
export {
  haversineKm,
  haversineDistanceMeters,
  haversineDistanceKm,
  haversineDistanceMiles
} from './geo.js';
export { geocodeAddress, getTimezoneForCoords } from './geocode.js';
export { getSnapshotContext } from './get-snapshot-context.js';

// Validation
export {
  validateLocationFreshness,
  validateStrategyWindow
} from './validation-gates.js';
export { validateWeatherTraffic } from './weather-traffic-validator.js';

// Holiday detection
export { detectHoliday, isHolidayToday } from './holiday-detector.js';

// Module summary:
// - geo.js: Haversine distance calculations (km, meters, miles)
// - geocode.js: Google Geocoding/Timezone API (geocodeAddress, getTimezoneForCoords)
// - get-snapshot-context.js: Build complete snapshot context for AI
// - validation-gates.js: Location/strategy freshness checks
// - weather-traffic-validator.js: Weather/traffic data validation
// - holiday-detector.js: Holiday detection with override support
// Note: reverseGeocode is in server/lib/venue/venue-address-resolver.js (local function)
