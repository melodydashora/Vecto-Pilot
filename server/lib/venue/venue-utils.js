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
// 2026-01-10: Use canonical coords-key module (consolidated from 4 duplicates)
import { coordsKey as generateCoordKeyCanonical } from "../location/coords-key.js";

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
 * 2026-01-10: Now re-exports from canonical coords-key module
 *
 * 6 decimals = ~11cm precision, suitable for 50m radius matching
 * Format: "lat_lng" e.g., "33.123456_-96.123456"
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string|null} Coordinate key or null if invalid
 */
export const generateCoordKey = generateCoordKeyCanonical;

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

// ============================================================================
// COMPACT HOURS FORMATTER (2026-01-14)
// ============================================================================

/**
 * Helper: Convert 24-hour time string to 12-hour format
 * Input: "1700" or "0030"
 * Output: "5PM" or "12:30AM"
 *
 * @param {string} timeStr - 4-digit time string (HHMM)
 * @returns {string} Formatted time like "5PM" or "12:30AM"
 */
function formatTime24to12(timeStr) {
  if (!timeStr || timeStr.length !== 4) return timeStr;

  const hour = parseInt(timeStr.slice(0, 2), 10);
  const min = timeStr.slice(2);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;

  // Only show minutes if not :00
  return min === '00' ? `${hour12}${ampm}` : `${hour12}:${min}${ampm}`;
}

/**
 * Formats Google Places hours into a compressed weekly view for UI display
 *
 * 2026-01-14: Added for compact hours display in venue listings
 *
 * Input: Google Places API 'opening_hours' object with 'periods' array
 * Output: "Mon-Thu: 11AM-8PM, Fri-Sat: 10AM-9PM, Sun: 12-6PM"
 *
 * @param {Object} googleHours - Google Places opening_hours object
 * @param {Array} googleHours.periods - Array of {open: {day, time}, close: {day, time}}
 * @returns {string} Compact hours string or "Hours not available"
 *
 * @example
 * // Input from Google Places API:
 * const hours = {
 *   periods: [
 *     { open: { day: 1, time: "1100" }, close: { day: 1, time: "2000" } },
 *     { open: { day: 2, time: "1100" }, close: { day: 2, time: "2000" } },
 *     // ... etc
 *   ]
 * };
 * formatCompactHours(hours);
 * // Returns: "Mon-Thu: 11AM-8PM, Fri-Sat: 10AM-9PM"
 */
export function formatCompactHours(googleHours) {
  if (!googleHours || !googleHours.periods || googleHours.periods.length === 0) {
    return "Hours not available";
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Step 1: Map periods to daily hours (keyed by day index 0-6)
  // Handle multiple periods per day (e.g., lunch + dinner service)
  const dailyHours = {};

  for (const period of googleHours.periods) {
    if (!period.open || period.open.day === undefined) continue;

    const dayIdx = period.open.day;
    const openTime = period.open.time || '0000';
    const closeTime = period.close?.time || '2359';

    const timeRange = `${formatTime24to12(openTime)}-${formatTime24to12(closeTime)}`;

    if (!dailyHours[dayIdx]) {
      dailyHours[dayIdx] = [];
    }
    dailyHours[dayIdx].push(timeRange);
  }

  // Step 2: Convert daily hours to string per day
  const dailyStrings = {};
  for (let i = 0; i < 7; i++) {
    if (dailyHours[i] && dailyHours[i].length > 0) {
      dailyStrings[i] = dailyHours[i].join(', ');
    } else {
      dailyStrings[i] = 'Closed';
    }
  }

  // Step 3: Group consecutive days with identical hours
  // Start from Monday (1) and wrap to Sunday (0)
  const groups = [];
  let currentGroup = null;

  // Order: Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];

  for (const dayIdx of orderedDays) {
    const hours = dailyStrings[dayIdx];

    if (!currentGroup) {
      currentGroup = { startIdx: dayIdx, endIdx: dayIdx, hours };
    } else if (currentGroup.hours === hours) {
      currentGroup.endIdx = dayIdx;
    } else {
      groups.push(currentGroup);
      currentGroup = { startIdx: dayIdx, endIdx: dayIdx, hours };
    }
  }
  if (currentGroup) {
    groups.push(currentGroup);
  }

  // Step 4: Format groups into readable strings
  const formatted = groups
    .filter(g => g.hours !== 'Closed') // Hide closed days for brevity
    .map(g => {
      const startDay = dayNames[g.startIdx];
      const endDay = dayNames[g.endIdx];
      const dayLabel = (g.startIdx === g.endIdx) ? startDay : `${startDay}-${endDay}`;
      return `${dayLabel}: ${g.hours}`;
    });

  // If all days are closed, show that explicitly
  if (formatted.length === 0) {
    return "Closed";
  }

  return formatted.join(', ');
}

/**
 * Formats Google weekdayDescriptions array into compact format
 *
 * Alternative to formatCompactHours when you have weekdayDescriptions
 * instead of periods array.
 *
 * Input: ["Monday: 4:00 PM – 2:00 AM", "Tuesday: 4:00 PM – 2:00 AM", ...]
 * Output: "Mon-Fri: 4PM-2AM, Sat-Sun: 2PM-2AM"
 *
 * @param {string[]} weekdayDescriptions - Array of "Day: Hours" strings
 * @returns {string} Compact hours string
 */
export function formatCompactHoursFromDescriptions(weekdayDescriptions) {
  if (!weekdayDescriptions || !Array.isArray(weekdayDescriptions) || weekdayDescriptions.length === 0) {
    return "Hours not available";
  }

  const dayNameMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6
  };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Step 1: Parse weekdayDescriptions into daily hours
  const dailyStrings = {};
  for (let i = 0; i < 7; i++) {
    dailyStrings[i] = 'Closed';
  }

  for (const desc of weekdayDescriptions) {
    // Format: "Monday: 4:00 PM – 2:00 AM" or "Monday: Closed"
    const colonIdx = desc.indexOf(':');
    if (colonIdx === -1) continue;

    const dayName = desc.slice(0, colonIdx).toLowerCase().trim();
    const hours = desc.slice(colonIdx + 1).trim();

    const dayIdx = dayNameMap[dayName];
    if (dayIdx !== undefined) {
      // Compact the hours format (remove extra spaces, normalize)
      const compactHours = hours
        .replace(/\s*–\s*/g, '-')  // Normalize dash
        .replace(/\s*-\s*/g, '-')
        .replace(/:00/g, '')       // Remove :00 for cleaner display
        .replace(/\s+/g, '');      // Remove spaces

      dailyStrings[dayIdx] = compactHours;
    }
  }

  // Step 2: Group consecutive days with identical hours (same as above)
  const groups = [];
  let currentGroup = null;
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];

  for (const dayIdx of orderedDays) {
    const hours = dailyStrings[dayIdx];

    if (!currentGroup) {
      currentGroup = { startIdx: dayIdx, endIdx: dayIdx, hours };
    } else if (currentGroup.hours === hours) {
      currentGroup.endIdx = dayIdx;
    } else {
      groups.push(currentGroup);
      currentGroup = { startIdx: dayIdx, endIdx: dayIdx, hours };
    }
  }
  if (currentGroup) {
    groups.push(currentGroup);
  }

  // Step 3: Format groups
  const formatted = groups
    .filter(g => g.hours.toLowerCase() !== 'closed')
    .map(g => {
      const startDay = dayNames[g.startIdx];
      const endDay = dayNames[g.endIdx];
      const dayLabel = (g.startIdx === g.endIdx) ? startDay : `${startDay}-${endDay}`;
      return `${dayLabel}: ${g.hours}`;
    });

  if (formatted.length === 0) {
    return "Closed";
  }

  return formatted.join(', ');
}
