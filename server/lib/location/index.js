// server/lib/location/index.js - Barrel exports for location module
// GPS, geocoding, weather, timezone, and snapshot context

// Core location operations
export { reverseGeocode, forwardGeocode, getTimezone } from './geo.js';
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
// - geo.js: Google Geocoding/Timezone API integration
// - get-snapshot-context.js: Build complete snapshot context for AI
// - validation-gates.js: Location/strategy freshness checks
// - weather-traffic-validator.js: Weather/traffic data validation
// - holiday-detector.js: Holiday detection with override support
