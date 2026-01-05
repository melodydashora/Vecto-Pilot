/**
 * Venue Utilities
 *
 * Utility functions for venue consolidation (2026-01-05):
 * - Address parsing from Google Places API addressComponents
 * - Coordinate key generation (6 decimal precision)
 * - Venue name normalization for deduplication
 * - is_open calculation from hours_full_week (Bar Markers)
 *
 * @see /home/runner/.claude/plans/noble-purring-yeti.md
 */

/**
 * Parse Google addressComponents into granular address fields
 *
 * @param {Array} components - Google Places API addressComponents array
 * @returns {Object} Parsed address fields
 *
 * @example
 * const parsed = parseAddressComponents(place.addressComponents);
 * // Returns: { address_1: "123 Main St", city: "Dallas", state: "TX", zip: "75201", country: "USA" }
 */
export function parseAddressComponents(components) {
  if (!components || !Array.isArray(components)) {
    return {
      address_1: null,
      address_2: null,
      city: null,
      state: null,
      zip: null,
      country: 'USA'
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
  const country = getComponent('country') || 'USA';

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
 * Calculate is_open, next_close_time, and closing_soon from hours_full_week
 *
 * CRITICAL: This powers the Bar Markers feature (green/red markers on MapTab)
 *
 * @param {Object} hoursFullWeek - Object with day names as keys, e.g., { monday: "4:00 PM - 2:00 AM", ... }
 * @param {string} timezone - IANA timezone string, e.g., "America/Chicago"
 * @returns {Object} { is_open: boolean|null, next_close_time: string|null, closing_soon: boolean }
 *
 * @example
 * const status = calculateIsOpen({ monday: "4:00 PM - 2:00 AM" }, "America/Chicago");
 * // Returns: { is_open: true, next_close_time: "2:00 AM", closing_soon: false }
 */
export function calculateIsOpen(hoursFullWeek, timezone) {
  const defaultResult = { is_open: null, next_close_time: null, closing_soon: false };

  if (!hoursFullWeek || typeof hoursFullWeek !== 'object') {
    return defaultResult;
  }

  if (!timezone) {
    console.warn('[venue-utils] calculateIsOpen called without timezone');
    return defaultResult;
  }

  try {
    const now = new Date();

    // Get day name in venue's timezone
    const dayName = now.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: timezone
    }).toLowerCase();

    // Get current time in venue's timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    });
    const currentTime = timeFormatter.format(now); // "14:30"
    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const currentMinutes = currentHour * 60 + currentMinute; // Minutes since midnight

    // Get today's hours
    const todayHours = hoursFullWeek[dayName];

    if (!todayHours || todayHours === 'Closed' || todayHours.toLowerCase() === 'closed') {
      return { is_open: false, next_close_time: null, closing_soon: false };
    }

    // Handle "Open 24 hours"
    if (todayHours.toLowerCase().includes('24 hours') || todayHours.toLowerCase() === 'open 24 hours') {
      return { is_open: true, next_close_time: null, closing_soon: false };
    }

    // Parse hours like "4:00 PM - 2:00 AM" or "11:00 AM - 10:00 PM"
    const hoursMatch = todayHours.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);

    if (!hoursMatch) {
      // Can't parse, return unknown
      return defaultResult;
    }

    const [, openHour, openMin, openAmPm, closeHour, closeMin, closeAmPm] = hoursMatch;

    // Convert to 24-hour format
    let openH = parseInt(openHour);
    let closeH = parseInt(closeHour);
    const openM = parseInt(openMin || '0');
    const closeM = parseInt(closeMin || '0');

    // Handle AM/PM
    if (openAmPm?.toUpperCase() === 'PM' && openH !== 12) openH += 12;
    if (openAmPm?.toUpperCase() === 'AM' && openH === 12) openH = 0;
    if (closeAmPm?.toUpperCase() === 'PM' && closeH !== 12) closeH += 12;
    if (closeAmPm?.toUpperCase() === 'AM' && closeH === 12) closeH = 0;

    const openMinutes = openH * 60 + openM;
    let closeMinutes = closeH * 60 + closeM;

    // Handle overnight hours (closes after midnight)
    const overnight = closeMinutes <= openMinutes;
    if (overnight) {
      closeMinutes += 24 * 60; // Add 24 hours
    }

    // Adjust current time for overnight comparison
    let adjustedCurrentMinutes = currentMinutes;
    if (overnight && currentMinutes < openMinutes) {
      adjustedCurrentMinutes += 24 * 60; // We're in the "next day" portion
    }

    // Check if currently open
    const is_open = adjustedCurrentMinutes >= openMinutes && adjustedCurrentMinutes < closeMinutes;

    // Calculate next close time
    const closeHour24 = closeH;
    const closeMinStr = String(closeM).padStart(2, '0');
    const closeAmPmStr = closeAmPm || (closeH >= 12 ? 'PM' : 'AM');
    const next_close_time = is_open
      ? `${closeH > 12 ? closeH - 12 : closeH}:${closeMinStr} ${closeAmPmStr}`
      : null;

    // Check if closing within 60 minutes (for red marker)
    const minutesUntilClose = is_open ? closeMinutes - adjustedCurrentMinutes : 0;
    const closing_soon = is_open && minutesUntilClose > 0 && minutesUntilClose <= 60;

    return { is_open, next_close_time, closing_soon };
  } catch (error) {
    console.error('[venue-utils] Error calculating is_open:', error);
    return defaultResult;
  }
}

/**
 * Format today's hours for display
 *
 * @param {Object} hoursFullWeek - Object with day names as keys
 * @param {string} timezone - IANA timezone string
 * @returns {string|null} Today's hours string or null
 */
export function getHoursToday(hoursFullWeek, timezone) {
  if (!hoursFullWeek || !timezone) return null;

  try {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: timezone
    }).toLowerCase();

    return hoursFullWeek[dayName] || null;
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
