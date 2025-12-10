/**
 * Traffic-aware ETA calculations for urban metro areas
 * Uses calibrated road factor and time-of-day congestion model
 */

const R_EARTH_M = 6371000; // meters

/**
 * Calculate great-circle distance using Haversine formula
 * @param {Object} a - {lat, lng}
 * @param {Object} b - {lat, lng}
 * @returns {number} Distance in meters
 */
function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Calculate road distance from straight-line distance
 * @param {number} haversine_m - Straight-line distance in meters
 * @param {number} k - Road factor (1.25 for grid-like urban metros)
 * @returns {number} Estimated road distance in meters
 */
function roadDistanceMeters(haversine_m, k = 1.25) {
  return haversine_m * k;
}

/**
 * Urban driving average speed by hour of day (24-hour format)
 * Accounts for traffic lights, turns, and city congestion
 * Units: mph (realistic city driving speeds, not freeway)
 */
const defaultSpeedMphByHour = {
  0: 35,  1: 38,  2: 38,  3: 37,  // Late night - fewer lights but slower
  4: 35,  5: 32,  6: 28,  7: 22,  // Morning rush
  8: 20,  9: 25, 10: 30, 11: 32,  // Post-rush builds
  12: 30, 13: 32, 14: 30, 15: 25,  // Midday to early afternoon
  16: 22, 17: 20, 18: 23, 19: 30,  // Evening rush recovery
  20: 33, 21: 35, 22: 36, 23: 35,  // Evening
};

/**
 * Weekend relief factor by day of week (0=Sunday, 6=Saturday)
 */
const weekdaySpeedFactor = {
  0: 1.10, // Sun
  1: 0.98, // Mon
  2: 0.98, // Tue
  3: 0.97, // Wed
  4: 0.97, // Thu
  5: 1.02, // Fri (AM heavier, PM lighter; average)
  6: 1.06, // Sat
};

/**
 * Calculate traffic-aware ETA
 * @param {Object} a - Origin {lat, lng}
 * @param {Object} b - Destination {lat, lng}
 * @param {Date} when - Time of travel (defaults to now)
 * @param {Object} opts - Options {kRoadFactor, hourSpeedMph, weekdayFactor, rainMultiplier}
 * @returns {Object} {distanceMeters, roadMeters, minutes}
 */
function etaMinutes(a, b, when = new Date(), opts = {}) {
  const k = opts.kRoadFactor ?? 1.25;
  const rain = opts.rainMultiplier ?? 1.0;
  const speeds = { ...defaultSpeedMphByHour, ...(opts.hourSpeedMph ?? {}) };
  const wdf = { ...weekdaySpeedFactor, ...(opts.weekdayFactor ?? {}) };

  const d = haversineMeters(a, b);
  const rd = roadDistanceMeters(d, k);

  const hour = when.getHours();
  const dow = when.getDay();

  let mph = speeds[hour] * (wdf[dow] ?? 1.0) * rain;
  // Clamp sanity: 15 mph minimum in heavy traffic; 70 mph maximum average
  mph = Math.min(70, Math.max(15, mph));

  const metersPerMinute = (mph * 1609.344) / 60;
  const minutes = rd / metersPerMinute;

  return { distanceMeters: d, roadMeters: rd, minutes };
}

/**
 * Convenience wrapper for "leave now" estimates with rain toggle
 * @param {Object} a - Origin {lat, lng}
 * @param {Object} b - Destination {lat, lng}
 * @param {boolean} raining - Is it raining?
 * @param {number} kRoad - Road factor (default 1.25 for grid-like urban metros)
 * @returns {Object} {distanceMeters, roadMeters, minutes}
 */
function estimateNow(a, b, raining = false, kRoad = 1.25) {
  return etaMinutes(a, b, new Date(), {
    kRoadFactor: kRoad,
    rainMultiplier: raining ? 0.9 : 1.0,
  });
}

export {
  haversineMeters,
  roadDistanceMeters,
  etaMinutes,
  estimateNow,
};
