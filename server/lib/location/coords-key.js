/**
 * Canonical Coordinate Key Generator
 *
 * 2026-01-10: Created to consolidate 4 duplicate implementations
 *
 * CONSOLIDATES:
 *   - server/api/location/location.js:13 makeCoordsKey()
 *   - server/api/location/snapshot.js:23 makeCoordsKey()
 *   - server/lib/venue/venue-enrichment.js:433 getCoordsKey()
 *   - server/lib/venue/venue-utils.js:83 generateCoordKey()
 *
 * GPS PRECISION: 6 decimals = ~11cm accuracy
 *   - 4 decimals = ~11m (too imprecise, causes cache collisions)
 *   - 6 decimals = ~11cm (exact, required for venue matching)
 *   - 8 decimals = ~1.1mm (overkill, wastes storage)
 *
 * FORMAT: "lat_lng" (e.g., "33.081234_-96.812345")
 *   - Used as cache key in coords_cache, places_cache
 *   - Used for venue deduplication in venue_catalog.coord_key
 */

/**
 * Generate a coordinate key from lat/lng
 *
 * @param {number|string} lat - Latitude value
 * @param {number|string} lng - Longitude value
 * @returns {string|null} Coordinate key in format "lat_lng" with 6 decimal precision, or null if invalid
 *
 * @example
 * coordsKey(33.0812345, -96.8123456) // "33.081235_-96.812346"
 * coordsKey("33.08", "-96.81")       // "33.080000_-96.810000"
 * coordsKey(null, null)              // null
 */
export function coordsKey(lat, lng) {
  // Preserve null-check behavior from venue-utils.js for backward compatibility
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) {
    return null;
  }
  return `${Number(lat).toFixed(6)}_${Number(lng).toFixed(6)}`;
}

/**
 * Parse a coordinate key back to lat/lng
 *
 * @param {string} key - Coordinate key in format "lat_lng"
 * @returns {{ lat: number, lng: number }} Parsed coordinates
 *
 * @example
 * parseCoordKey("33.081235_-96.812346") // { lat: 33.081235, lng: -96.812346 }
 */
export function parseCoordKey(key) {
  const [lat, lng] = key.split('_').map(Number);
  return { lat, lng };
}

/**
 * Validate a coordinate key format
 *
 * @param {string} key - Coordinate key to validate
 * @returns {boolean} True if valid format
 */
export function isValidCoordKey(key) {
  if (typeof key !== 'string') return false;
  const parts = key.split('_');
  if (parts.length !== 2) return false;
  const [lat, lng] = parts.map(Number);
  return !isNaN(lat) && !isNaN(lng) &&
         lat >= -90 && lat <= 90 &&
         lng >= -180 && lng <= 180;
}

/**
 * Normalize a coordinate value to 6 decimal precision (~11cm accuracy).
 *
 * Use this at every storage gate that writes lat/lng to a `doublePrecision`
 * column (snapshots.lat/lng, venue_catalog.lat/lng, coords_cache.lat/lng).
 * Without it, the numeric columns drift away from the matching `coord_key`
 * cache key — `coord_key` rounds to 6 decimals, raw inserts don't, and a
 * query like `WHERE lat = 33.127913` misses a snapshot stored as `33.1279135`
 * even though their coord_keys match.
 *
 * Returns null for null/undefined/NaN; otherwise a Number rounded to 6 decimals.
 *
 * @param {number|string|null} value - Coordinate value
 * @returns {number|null}
 *
 * @example
 * normalizeCoord(33.1279135)  // 33.127914
 * normalizeCoord(-96.8762)    // -96.8762  (stored as -96.876200 in 6-decimal coord_key)
 * normalizeCoord("33.08")     // 33.08
 * normalizeCoord(null)        // null
 */
export function normalizeCoord(value) {
  if (value == null || isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(6));
}

// Legacy aliases for backward compatibility
// These will be deprecated in future versions
export const makeCoordsKey = coordsKey;
export const getCoordsKey = coordsKey;
export const generateCoordKey = coordsKey;

export default {
  coordsKey,
  parseCoordKey,
  isValidCoordKey,
  normalizeCoord,
  // Legacy aliases
  makeCoordsKey,
  getCoordsKey,
  generateCoordKey,
};
