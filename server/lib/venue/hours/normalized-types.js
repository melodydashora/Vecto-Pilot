/**
 * Normalized Schedule Types for Venue Hours
 *
 * 2026-01-10: D-014 Phase 1 - Define canonical schedule model
 *
 * This module defines the contract for normalized venue schedules.
 * All parsers MUST produce this format. The evaluator ONLY accepts this format.
 *
 * Design principles:
 * - Minutes since midnight (0-1439) for consistent math
 * - Explicit closes_next_day flag for overnight handling
 * - Multiple intervals per day (split shifts)
 * - No silent coercion - parse failures return ParseError
 */

/**
 * Canonical weekday keys (0-6, Sunday-Saturday)
 * Using lowercase full names for human readability
 */
export const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Time interval within a single day
 *
 * @typedef {Object} TimeInterval
 * @property {number} open_minute - Minutes since midnight (0-1439) when venue opens
 * @property {number} close_minute - Minutes since midnight (0-1439) when venue closes
 * @property {boolean} closes_next_day - True if close_minute is on the following calendar day
 *
 * @example
 * // 4:00 PM - 2:00 AM (overnight)
 * { open_minute: 960, close_minute: 120, closes_next_day: true }
 *
 * @example
 * // 11:00 AM - 10:00 PM (same day)
 * { open_minute: 660, close_minute: 1320, closes_next_day: false }
 */

/**
 * Day schedule - can be closed, 24h, or have intervals
 *
 * @typedef {Object} DaySchedule
 * @property {boolean} is_closed - True if closed all day
 * @property {boolean} is_24h - True if open 24 hours
 * @property {TimeInterval[]} intervals - Array of open intervals (empty if closed or 24h)
 */

/**
 * Normalized weekly schedule
 *
 * @typedef {Object} NormalizedSchedule
 * @property {DaySchedule} sunday
 * @property {DaySchedule} monday
 * @property {DaySchedule} tuesday
 * @property {DaySchedule} wednesday
 * @property {DaySchedule} thursday
 * @property {DaySchedule} friday
 * @property {DaySchedule} saturday
 */

/**
 * Parse error returned when hours can't be parsed
 *
 * @typedef {Object} ParseError
 * @property {boolean} ok - Always false
 * @property {string} error - Error message
 * @property {string} [raw] - Original raw input that failed to parse
 */

/**
 * Open status result from evaluator
 *
 * @typedef {Object} OpenStatus
 * @property {boolean|null} is_open - true if open, false if closed, null if unknown
 * @property {string|null} closes_at - Time venue closes (HH:MM format in venue timezone)
 * @property {string|null} opens_at - Time venue opens next (HH:MM format in venue timezone)
 * @property {boolean} closing_soon - True if closing within 60 minutes
 * @property {number|null} minutes_until_close - Minutes until close (if open)
 * @property {number|null} minutes_until_open - Minutes until open (if closed)
 * @property {string|null} reason - Human-readable explanation
 */

/**
 * Create a closed day schedule
 * @returns {DaySchedule}
 */
export function closedDay() {
  return { is_closed: true, is_24h: false, intervals: [] };
}

/**
 * Create a 24-hour day schedule
 * @returns {DaySchedule}
 */
export function twentyFourHourDay() {
  return { is_closed: false, is_24h: true, intervals: [] };
}

/**
 * Create a day schedule with specific intervals
 * @param {TimeInterval[]} intervals
 * @returns {DaySchedule}
 */
export function dayWithIntervals(intervals) {
  return { is_closed: false, is_24h: false, intervals };
}

/**
 * Create a time interval
 * @param {number} openHour - Hour (0-23)
 * @param {number} openMinute - Minute (0-59)
 * @param {number} closeHour - Hour (0-23)
 * @param {number} closeMinute - Minute (0-59)
 * @returns {TimeInterval}
 */
export function createInterval(openHour, openMinute, closeHour, closeMinute) {
  const open_minute = openHour * 60 + openMinute;
  const close_minute = closeHour * 60 + closeMinute;
  const closes_next_day = close_minute <= open_minute;

  return { open_minute, close_minute, closes_next_day };
}

/**
 * Create an empty/unknown schedule (all days null)
 * @returns {NormalizedSchedule}
 */
export function emptySchedule() {
  const schedule = {};
  for (const day of WEEKDAY_KEYS) {
    schedule[day] = null;
  }
  return schedule;
}

/**
 * Create a parse error result
 * @param {string} error - Error message
 * @param {string} [raw] - Original raw input
 * @returns {ParseError}
 */
export function parseError(error, raw) {
  return { ok: false, error, raw };
}

/**
 * Create a successful parse result
 * @param {NormalizedSchedule} schedule
 * @returns {{ ok: true, schedule: NormalizedSchedule }}
 */
export function parseSuccess(schedule) {
  return { ok: true, schedule };
}

/**
 * Convert 24-hour time string to minutes since midnight
 * @param {string} time24 - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
export function timeToMinutes(time24) {
  const [h, m] = time24.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes since midnight to 24-hour time string
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in HH:MM format
 */
export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Convert minutes since midnight to 12-hour display format
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in "H:MM AM/PM" format
 */
export function minutesToDisplay(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return m === 0 ? `${h12} ${period}` : `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}
