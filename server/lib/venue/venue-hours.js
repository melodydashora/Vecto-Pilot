/**
 * Venue Hours Utility Functions
 *
 * Provides programmatic open/closed checks using hours_full_week JSON
 * No LLM calls required - pure date/time logic
 *
 * 2026-01-08: Created for venue hours standardization
 * 2026-01-10: D-014 Gap Fix - Now uses canonical hours module internally
 */

// 2026-01-10: D-014 Gap Fix - Use canonical hours module
import { parseStructuredHoursFullWeek, getOpenStatus } from './hours/index.js';

/**
 * Check if venue is open at a specific time
 *
 * 2026-01-10: D-014 Gap Fix - Now uses canonical hours module internally.
 * This wrapper maintains backward compatibility for consolidator.js and other callers.
 *
 * @param {Object} hoursFullWeek - Structured hours JSON from venue_catalog.hours_full_week
 * @param {string} timezone - IANA timezone (e.g., "America/Chicago")
 * @param {Date} checkTime - Time to check (defaults to now)
 * @returns {Object} { isOpen: boolean|null, nextChange: string|null, reason: string }
 *
 * @example
 * const result = isOpenNow(venue.hours_full_week, "America/Chicago");
 * // { isOpen: true, nextChange: "02:00", reason: "Open until 2:00 AM" }
 */
export function isOpenNow(hoursFullWeek, timezone, checkTime = new Date()) {
  if (!hoursFullWeek || typeof hoursFullWeek !== 'object') {
    return { isOpen: null, nextChange: null, reason: 'No hours data' };
  }

  // 2026-01-10: D-014 Gap Fix - Require timezone (no fallbacks per CLAUDE.md)
  if (!timezone) {
    return { isOpen: null, nextChange: null, reason: 'Missing timezone' };
  }

  // 2026-01-10: D-014 Gap Fix - Use canonical parser + evaluator
  const parseResult = parseStructuredHoursFullWeek(hoursFullWeek);

  if (!parseResult.ok) {
    return { isOpen: null, nextChange: null, reason: parseResult.error || 'Parse failed' };
  }

  const status = getOpenStatus(parseResult.schedule, timezone, checkTime);

  // Map canonical OpenStatus to legacy return format for backward compatibility
  return {
    isOpen: status.is_open,
    nextChange: status.is_open ? status.closes_at : status.opens_at,
    reason: status.reason
  };
}

/**
 * Get hours summary for display
 *
 * @param {Object} hoursFullWeek - Structured hours JSON
 * @returns {string} Human-readable summary
 *
 * @example
 * getHoursSummary(venue.hours_full_week);
 * // "Mon-Thu: 4 PM - 2 AM, Fri-Sat: 11 AM - 2 AM"
 */
export function getHoursSummary(hoursFullWeek) {
  if (!hoursFullWeek) return 'Hours unknown';

  const formatTime = (time24) => {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${hour12} ${period}` : `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  };

  // Group days with same hours
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < 7; i++) {
    const day = DAY_NAMES[i];
    const hours = hoursFullWeek[day];

    if (!hours || hours.closed) {
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
      continue;
    }

    const key = `${hours.open}-${hours.close}`;

    if (currentGroup && currentGroup.key === key) {
      currentGroup.endDay = day;
    } else {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        startDay: day,
        endDay: day,
        key,
        open: hours.open,
        close: hours.close
      };
    }
  }

  if (currentGroup) groups.push(currentGroup);

  // Format output
  const dayAbbrev = (day) => day.charAt(0).toUpperCase() + day.slice(1, 3);

  return groups.map(g => {
    const dayRange = g.startDay === g.endDay
      ? dayAbbrev(g.startDay)
      : `${dayAbbrev(g.startDay)}-${dayAbbrev(g.endDay)}`;
    return `${dayRange}: ${formatTime(g.open)} - ${formatTime(g.close)}`;
  }).join(', ') || 'Hours unknown';
}

/**
 * Validate hours_full_week structure
 *
 * @param {Object} hoursFullWeek - Hours object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateHoursFullWeek(hoursFullWeek) {
  const errors = [];

  if (!hoursFullWeek || typeof hoursFullWeek !== 'object') {
    return { valid: false, errors: ['hours_full_week must be an object'] };
  }

  const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;

  for (const day of DAY_NAMES) {
    const hours = hoursFullWeek[day];
    if (!hours) continue;

    if (hours.closed === true) continue;

    if (!hours.open || !timeRegex.test(hours.open)) {
      errors.push(`${day}: invalid open time "${hours.open}"`);
    }
    if (!hours.close || !timeRegex.test(hours.close)) {
      errors.push(`${day}: invalid close time "${hours.close}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Standardize coordinates to 6 decimal places
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Object} { lat: string, lng: string, coord_key: string }
 */
export function standardizeCoords(lat, lng) {
  if (lat == null || lng == null) return null;

  const latFixed = parseFloat(lat).toFixed(6);
  const lngFixed = parseFloat(lng).toFixed(6);

  return {
    lat: latFixed,
    lng: lngFixed,
    coord_key: `${latFixed}_${lngFixed}`
  };
}
