/**
 * Hours Text Map Parser
 *
 * 2026-01-10: D-014 Phase 2.2
 *
 * Parses object with day names as keys and time range strings as values:
 * { monday: "4:00 PM - 2:00 AM", tuesday: "11:00 AM - 10:00 PM", ... }
 *
 * This format is commonly used in DB storage and legacy code.
 *
 * Handles:
 * - Full weekday names (Monday, Tuesday, etc.)
 * - Lowercase weekday names (monday, tuesday, etc.)
 * - "Closed" or "closed"
 * - "Open 24 hours" or "24 hours"
 * - Overnight hours
 * - 12-hour and 24-hour formats
 */

import {
  WEEKDAY_KEYS,
  closedDay,
  twentyFourHourDay,
  dayWithIntervals,
  parseError,
  parseSuccess,
  emptySchedule
} from '../normalized-types.js';

/**
 * Map weekday name variants to canonical keys
 */
const WEEKDAY_MAP = {
  'sunday': 'sunday', 'Sun': 'sunday', 'SUNDAY': 'sunday',
  'monday': 'monday', 'Mon': 'monday', 'MONDAY': 'monday',
  'tuesday': 'tuesday', 'Tue': 'tuesday', 'TUESDAY': 'tuesday',
  'wednesday': 'wednesday', 'Wed': 'wednesday', 'WEDNESDAY': 'wednesday',
  'thursday': 'thursday', 'Thu': 'thursday', 'THURSDAY': 'thursday',
  'friday': 'friday', 'Fri': 'friday', 'FRIDAY': 'friday',
  'saturday': 'saturday', 'Sat': 'saturday', 'SATURDAY': 'saturday'
};

/**
 * Parse a time string into hours and minutes
 *
 * @param {string} timeStr - Time string like "4:00 PM", "16:00"
 * @returns {{ hour: number, minute: number } | null}
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();

  // Try 12-hour format: "4:00 PM", "11:30 AM"
  const match12 = trimmed.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = parseInt(match12[2] || '0', 10);
    const period = match12[3].toUpperCase();

    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return { hour, minute };
  }

  // Try 24-hour format: "16:00", "23:30"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    let hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);

    if (hour === 24) hour = 0;

    return { hour, minute };
  }

  return null;
}

/**
 * Parse a time range string like "4:00 PM - 2:00 AM"
 *
 * @param {string} rangeStr - Time range string
 * @returns {{ open_minute: number, close_minute: number, closes_next_day: boolean } | null}
 */
function parseTimeRange(rangeStr) {
  if (!rangeStr) return null;

  // Split on various dash characters
  const parts = rangeStr.split(/\s*[–\-—]\s*/);
  if (parts.length !== 2) return null;

  const openTime = parseTime(parts[0]);
  const closeTime = parseTime(parts[1]);

  if (!openTime || !closeTime) return null;

  const open_minute = openTime.hour * 60 + openTime.minute;
  const close_minute = closeTime.hour * 60 + closeTime.minute;

  // Detect overnight: if close is before or equal to open, it's next day
  const closes_next_day = close_minute <= open_minute;

  return { open_minute, close_minute, closes_next_day };
}

/**
 * Parse a day's hours value
 *
 * @param {string} hoursValue - e.g., "4:00 PM - 2:00 AM", "Closed", "Open 24 hours"
 * @returns {DaySchedule | null}
 */
function parseDayHours(hoursValue) {
  if (!hoursValue || typeof hoursValue !== 'string') return null;

  const trimmed = hoursValue.trim();
  const lower = trimmed.toLowerCase();

  // Check for special cases
  if (lower === 'closed') {
    return closedDay();
  }

  if (lower === 'open 24 hours' || lower === '24 hours' || lower.includes('24 hours')) {
    return twentyFourHourDay();
  }

  // Parse time range(s)
  const rangeStrings = trimmed.split(/,\s*/);
  const intervals = [];

  for (const rangeStr of rangeStrings) {
    const interval = parseTimeRange(rangeStr.trim());
    if (interval) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) return null;

  return dayWithIntervals(intervals);
}

/**
 * Parse hours text map into normalized schedule
 *
 * @param {Object.<string, string>} hoursMap - Map of day names to hours strings
 * @returns {{ ok: true, schedule: NormalizedSchedule } | { ok: false, error: string, raw?: string }}
 *
 * @example
 * parseHoursTextMap({
 *   monday: "4:00 PM - 2:00 AM",
 *   tuesday: "4:00 PM - 2:00 AM",
 *   wednesday: "Closed",
 *   thursday: "4:00 PM - 2:00 AM",
 *   friday: "4:00 PM - 3:00 AM",
 *   saturday: "11:00 AM - 3:00 AM",
 *   sunday: "11:00 AM - 12:00 AM"
 * });
 */
export function parseHoursTextMap(hoursMap) {
  if (!hoursMap || typeof hoursMap !== 'object') {
    return parseError('Invalid input: expected object with day keys');
  }

  const schedule = emptySchedule();
  const parseFailures = [];

  for (const [key, value] of Object.entries(hoursMap)) {
    // Normalize day key
    const dayKey = key.toLowerCase();
    const canonicalDay = WEEKDAY_MAP[dayKey] || WEEKDAY_MAP[key];

    if (!canonicalDay) {
      // Not a valid day key, skip
      continue;
    }

    const daySchedule = parseDayHours(value);
    if (daySchedule) {
      schedule[canonicalDay] = daySchedule;
    } else {
      parseFailures.push({ day: key, value });
    }
  }

  // Check if we parsed anything useful
  const parsedDays = WEEKDAY_KEYS.filter(day => schedule[day] !== null);
  if (parsedDays.length === 0) {
    return parseError('Could not parse any day hours', JSON.stringify(hoursMap));
  }

  // Log parse failures for debugging
  if (parseFailures.length > 0) {
    console.warn(`[parseHoursTextMap] Could not parse ${parseFailures.length} entries:`, parseFailures);
  }

  return parseSuccess(schedule);
}

export default parseHoursTextMap;
