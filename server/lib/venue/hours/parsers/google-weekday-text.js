/**
 * Google Places weekday_text Parser
 *
 * 2026-01-10: D-014 Phase 2.1
 *
 * Parses Google Places API weekday_text array format:
 * ["Monday: 6:00 AM – 11:00 PM", "Tuesday: 6:00 AM – 11:00 PM", ...]
 *
 * Handles:
 * - 12-hour AM/PM format (most common)
 * - 24-hour format (some locales)
 * - "Closed"
 * - "Open 24 hours"
 * - Overnight hours (e.g., "4:00 PM – 2:00 AM")
 * - Multiple ranges per day (split shifts)
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
 * Map weekday names to canonical keys
 * Handles full names and common abbreviations
 */
const WEEKDAY_MAP = {
  'sunday': 'sunday', 'sun': 'sunday',
  'monday': 'monday', 'mon': 'monday',
  'tuesday': 'tuesday', 'tue': 'tuesday', 'tues': 'tuesday',
  'wednesday': 'wednesday', 'wed': 'wednesday',
  'thursday': 'thursday', 'thu': 'thursday', 'thur': 'thursday', 'thurs': 'thursday',
  'friday': 'friday', 'fri': 'friday',
  'saturday': 'saturday', 'sat': 'saturday'
};

/**
 * Parse a time string into hours and minutes
 *
 * Handles:
 * - "6:00 AM" → { hour: 6, minute: 0 }
 * - "11:30 PM" → { hour: 23, minute: 30 }
 * - "14:30" → { hour: 14, minute: 30 }
 * - "24:00" → { hour: 0, minute: 0 } (midnight)
 *
 * @param {string} timeStr - Time string
 * @returns {{ hour: number, minute: number } | null}
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();

  // Try 12-hour format: "6:00 AM", "11:30 PM"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = parseInt(match12[2], 10);
    const period = match12[3].toUpperCase();

    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return { hour, minute };
  }

  // Try 24-hour format: "14:30", "06:00", "24:00"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    let hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);

    // Handle "24:00" as midnight
    if (hour === 24) hour = 0;

    return { hour, minute };
  }

  return null;
}

/**
 * Parse a time range string into an interval
 *
 * Handles:
 * - "6:00 AM – 11:00 PM"
 * - "4:00 PM – 2:00 AM" (overnight)
 * - "11:00 AM - 10:00 PM" (dash variant)
 * - "06:00–23:00" (24-hour)
 *
 * @param {string} rangeStr - Time range string
 * @returns {{ open_minute: number, close_minute: number, closes_next_day: boolean } | null}
 */
function parseTimeRange(rangeStr) {
  if (!rangeStr) return null;

  // Split on various dash characters: – (en-dash), - (hyphen), — (em-dash)
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
 * Parse a single weekday description line
 *
 * @param {string} line - e.g., "Monday: 6:00 AM – 11:00 PM"
 * @returns {{ day: string, schedule: DaySchedule } | null}
 */
function parseWeekdayLine(line) {
  if (!line || typeof line !== 'string') return null;

  // Split on first colon
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const dayPart = line.slice(0, colonIdx).trim().toLowerCase();
  const hoursPart = line.slice(colonIdx + 1).trim();

  // Map day name to canonical key
  const day = WEEKDAY_MAP[dayPart];
  if (!day) return null;

  // Check for special cases
  const hoursLower = hoursPart.toLowerCase();

  if (hoursLower === 'closed') {
    return { day, schedule: closedDay() };
  }

  if (hoursLower === 'open 24 hours' || hoursLower === '24 hours') {
    return { day, schedule: twentyFourHourDay() };
  }

  // Parse time ranges (may have multiple, comma-separated for split shifts)
  const rangeStrings = hoursPart.split(/,\s*/);
  const intervals = [];

  for (const rangeStr of rangeStrings) {
    const interval = parseTimeRange(rangeStr.trim());
    if (interval) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) {
    // Couldn't parse any intervals
    return null;
  }

  return { day, schedule: dayWithIntervals(intervals) };
}

/**
 * Parse Google Places weekday_text array into normalized schedule
 *
 * @param {string[]} weekdayTexts - Array of weekday descriptions
 * @returns {{ ok: true, schedule: NormalizedSchedule } | { ok: false, error: string, raw?: string }}
 *
 * @example
 * parseGoogleWeekdayText([
 *   "Monday: 6:00 AM – 11:00 PM",
 *   "Tuesday: 6:00 AM – 11:00 PM",
 *   "Wednesday: Closed",
 *   "Thursday: 4:00 PM – 2:00 AM",
 *   "Friday: Open 24 hours",
 *   "Saturday: 11:00 AM – 3:00 PM, 5:00 PM – 11:00 PM",
 *   "Sunday: Closed"
 * ]);
 */
export function parseGoogleWeekdayText(weekdayTexts) {
  if (!weekdayTexts || !Array.isArray(weekdayTexts)) {
    return parseError('Invalid input: expected array of weekday strings');
  }

  if (weekdayTexts.length === 0) {
    return parseError('Empty weekday_text array');
  }

  const schedule = emptySchedule();
  const parseFailures = [];

  for (const line of weekdayTexts) {
    const result = parseWeekdayLine(line);
    if (result) {
      schedule[result.day] = result.schedule;
    } else {
      parseFailures.push(line);
    }
  }

  // Check if we parsed anything useful
  const parsedDays = WEEKDAY_KEYS.filter(day => schedule[day] !== null);
  if (parsedDays.length === 0) {
    return parseError('Could not parse any weekday lines', weekdayTexts.join('; '));
  }

  // Log parse failures for debugging but don't fail entirely
  if (parseFailures.length > 0) {
    console.warn(`[parseGoogleWeekdayText] Could not parse ${parseFailures.length} lines:`, parseFailures);
  }

  return parseSuccess(schedule);
}

export default parseGoogleWeekdayText;
