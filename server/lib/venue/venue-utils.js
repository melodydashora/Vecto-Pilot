/**
 * Venue Utilities
 *
 * Utility functions for venue consolidation (2026-01-05):
 * - Address parsing from Google Places API addressComponents
 * - Coordinate key generation (6 decimal precision)
 * - Venue name normalization for deduplication
 * - is_open calculation from hours_full_week (Bar Markers)
 *
 * 2026-01-10: D-014 Phase 4 - Now uses canonical hours module
 *
 * @see /home/runner/.claude/plans/noble-purring-yeti.md
 */

// 2026-01-10: D-014 Phase 4 - Use canonical hours module for all isOpen calculations
import { parseHoursTextMap, getOpenStatus } from "./hours/index.js";

/**
 * Parse Google addressComponents into granular address fields
 *
 * @param {Array} components - Google Places API addressComponents array
 * @returns {Object} Parsed address fields
 *
 * @example
 * const parsed = parseAddressComponents(place.addressComponents);
 * // Returns: { address_1: "123 Main St", city: "Dallas", state: "TX", zip: "75201", country: "US" }
 * // Note: country uses ISO-3166-1 alpha-2 code (US, not USA) - 2026-01-10 D-004 fix
 */
export function parseAddressComponents(components) {
  if (!components || !Array.isArray(components)) {
    return {
      address_1: null,
      address_2: null,
      city: null,
      state: null,
      zip: null,
      country: 'US'
    };
  }

  // Helper to extract component by type
  // Supports both Google Places API (New) format (longText) and legacy format (long_name)
  const getComponent = (type) => {
    const comp = components.find(c =>
      c.types?.includes(type) ||
      (Array.isArray(c.types) && c.types.includes(type))
    );
    return comp ? (comp.longText || comp.long_name || null) : null;
  };

  // Build street address from components
  const streetNumber = getComponent('street_number') || '';
  const route = getComponent('route') || '';
  const address_1 = [streetNumber, route].filter(Boolean).join(' ').trim() || null;

  // Suite/floor/unit
  const subpremise = getComponent('subpremise');
  const floor = getComponent('floor');
  const address_2 = subpremise || floor || null;

  // City - try multiple component types
  const city = getComponent('locality') ||
               getComponent('sublocality') ||
               getComponent('sublocality_level_1') ||
               getComponent('administrative_area_level_2') ||
               getComponent('administrative_area_level_3');

  // State - short form preferred (TX not Texas)
  const stateComp = components.find(c => c.types?.includes('administrative_area_level_1'));
  const state = stateComp ? (stateComp.shortText || stateComp.short_name || stateComp.longText || stateComp.long_name) : null;

  // Postal code and country
  const zip = getComponent('postal_code');
  const country = getComponent('country') || 'US';

  return { address_1, address_2, city, state, zip, country };
}

/**
 * Generate a coordinate key with 6 decimal precision
 *
 * 6 decimals = ~11cm precision, suitable for 50m radius matching
 * Format: "lat_lng" e.g., "33.123456_-96.123456"
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string|null} Coordinate key or null if invalid
 */
export function generateCoordKey(lat, lng) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return null;
  }
  return `${Number(lat).toFixed(6)}_${Number(lng).toFixed(6)}`;
}

/**
 * Normalize a venue name for deduplication matching
 *
 * Transformations:
 * - Lowercase
 * - Remove leading "The "
 * - Replace & with " and "
 * - Remove non-alphanumeric characters
 * - Collapse multiple spaces
 *
 * @param {string} name - Venue name
 * @returns {string|null} Normalized name or null if invalid
 *
 * @example
 * normalizeVenueName("The Katy Trail Ice House & Pub")
 * // Returns: "katy trail ice house and pub"
 */
export function normalizeVenueName(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')     // Remove leading "The "
    .replace(/&/g, ' and ')      // Replace & with " and "
    .replace(/[^\w\s]/g, '')     // Remove non-alphanumeric
    .replace(/\s+/g, ' ')        // Collapse multiple spaces
    .trim();
}

/**
 * Calculate is_open, next_close_time, and closing_soon from hours text map
 *
 * CRITICAL: This powers the Bar Markers feature (green/red markers on MapTab)
 *
 * 2026-01-10: D-014 Phase 4 - Now uses canonical hours module (parseHoursTextMap + getOpenStatus)
 * This wrapper maintains backward compatibility while using the consolidated evaluation logic.
 *
 * @param {Object} hoursTextMap - Object with day names as keys, e.g., { monday: "4:00 PM - 2:00 AM", ... }
 * @param {string} timezone - IANA timezone string, e.g., "America/Chicago"
 * @returns {Object} { is_open: boolean|null, next_close_time: string|null, closing_soon: boolean }
 *
 * @example
 * const status = calculateIsOpenFromHoursTextMap({ monday: "4:00 PM - 2:00 AM" }, "America/Chicago");
 * // Returns: { is_open: true, next_close_time: "2:00 AM", closing_soon: false }
 */
export function calculateIsOpenFromHoursTextMap(hoursTextMap, timezone) {
  const defaultResult = { is_open: null, next_close_time: null, closing_soon: false };

  if (!hoursTextMap || typeof hoursTextMap !== 'object') {
    return defaultResult;
  }

  if (!timezone) {
    console.warn('[venue-utils] calculateIsOpenFromHoursTextMap called without timezone');
    return defaultResult;
  }

  // 2026-01-10: D-014 Phase 4 - Use canonical parser + evaluator
  const parseResult = parseHoursTextMap(hoursTextMap);

  if (!parseResult.ok) {
    console.warn(`[venue-utils] parseHoursTextMap failed: ${parseResult.error}`);
    return defaultResult;
  }

  const status = getOpenStatus(parseResult.schedule, timezone);

  // Map canonical OpenStatus to legacy return format for backward compatibility
  return {
    is_open: status.is_open,
    next_close_time: status.closes_at,
    closing_soon: status.closing_soon
  };
}

/**
 * Format today's hours for display
 *
 * @param {Object} hoursTextMap - Object with day names as keys
 * @param {string} timezone - IANA timezone string
 * @returns {string|null} Today's hours string or null
 */
export function getHoursToday(hoursTextMap, timezone) {
  if (!hoursTextMap || !timezone) return null;

  try {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: timezone
    }).toLowerCase();

    return hoursTextMap[dayName] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Merge venue types arrays, removing duplicates
 *
 * @param {string[]} existing - Existing venue_types array
 * @param {string[]} newTypes - New types to add
 * @returns {string[]} Merged array with unique values
 */
export function mergeVenueTypes(existing, newTypes) {
  const existingArray = Array.isArray(existing) ? existing : [];
  const newArray = Array.isArray(newTypes) ? newTypes : [];
  return [...new Set([...existingArray, ...newArray])];
}

/**
 * Convert expense level string to rank number
 *
 * @param {string} expenseLevel - '$', '$$', '$$$', or '$$$$'
 * @returns {number|null} 1-4 or null
 */
export function expenseLevelToRank(expenseLevel) {
  if (!expenseLevel) return null;
  const levels = { '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };
  return levels[expenseLevel] || null;
}

/**
 * Convert expense rank to level string
 *
 * @param {number} rank - 1-4
 * @returns {string|null} '$', '$$', '$$$', '$$$$' or null
 */
export function expenseRankToLevel(rank) {
  if (!rank || rank < 1 || rank > 4) return null;
  return '$'.repeat(rank);
}

/**
 * @deprecated Use calculateIsOpenFromHoursTextMap instead (D-014 Phase 0.1)
 * Alias for backward compatibility - will be removed after Phase 6
 */
export const calculateIsOpen = calculateIsOpenFromHoursTextMap;
