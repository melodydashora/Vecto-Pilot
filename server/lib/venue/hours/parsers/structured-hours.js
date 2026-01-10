/**
 * Structured Hours Parser
 *
 * 2026-01-10: D-014 Gap Fix
 *
 * Parses structured hours_full_week JSON format used by venue_catalog:
 * {
 *   monday: { open: "16:00", close: "02:00", closes_next_day: true },
 *   tuesday: { open: "16:00", close: "02:00", closes_next_day: true },
 *   wednesday: { closed: true }
 * }
 *
 * This format is used by:
 * - venue-hours.js (legacy isOpenNow function)
 * - consolidator.js (strategy layer)
 * - venue_catalog.hours_full_week database column
 */

import {
  WEEKDAY_KEYS,
  closedDay,
  twentyFourHourDay,
  dayWithIntervals,
  parseError,
  parseSuccess,
  emptySchedule,
  timeToMinutes
} from '../normalized-types.js';

/**
 * Parse structured hours_full_week JSON into normalized schedule
 *
 * @param {Object} hoursFullWeek - Structured hours object from venue_catalog
 * @returns {{ ok: true, schedule: NormalizedSchedule } | { ok: false, error: string }}
 *
 * @example
 * parseStructuredHoursFullWeek({
 *   monday: { open: "16:00", close: "02:00", closes_next_day: true },
 *   tuesday: { open: "16:00", close: "02:00", closes_next_day: true },
 *   wednesday: { closed: true },
 *   thursday: { open: "16:00", close: "02:00", closes_next_day: true },
 *   friday: { open: "16:00", close: "03:00", closes_next_day: true },
 *   saturday: { open: "11:00", close: "03:00", closes_next_day: true },
 *   sunday: { open: "11:00", close: "00:00", closes_next_day: true }
 * });
 */
export function parseStructuredHoursFullWeek(hoursFullWeek) {
  if (!hoursFullWeek || typeof hoursFullWeek !== 'object') {
    return parseError('Invalid input: expected structured hours object');
  }

  const schedule = emptySchedule();
  let parsedDays = 0;

  for (const dayKey of WEEKDAY_KEYS) {
    const dayHours = hoursFullWeek[dayKey];

    if (!dayHours) {
      // No data for this day - leave as null (unknown)
      continue;
    }

    // Handle closed days
    if (dayHours.closed === true) {
      schedule[dayKey] = closedDay();
      parsedDays++;
      continue;
    }

    // Handle 24-hour days
    if (dayHours.open_24h === true || dayHours.is_24h === true) {
      schedule[dayKey] = twentyFourHourDay();
      parsedDays++;
      continue;
    }

    // Parse open/close times
    const { open, close, closes_next_day } = dayHours;

    if (!open || !close) {
      // Invalid day data - skip
      continue;
    }

    // Convert "HH:MM" to minutes since midnight
    const openMinutes = timeToMinutes(open);
    const closeMinutes = timeToMinutes(close);

    if (openMinutes === null || closeMinutes === null) {
      // Invalid time format - skip
      continue;
    }

    // Create interval with overnight flag
    // Note: closes_next_day might already be set, or we detect it from times
    const isOvernight = closes_next_day === true || closeMinutes <= openMinutes;

    schedule[dayKey] = dayWithIntervals([{
      open_minute: openMinutes,
      close_minute: closeMinutes,
      closes_next_day: isOvernight
    }]);

    parsedDays++;
  }

  if (parsedDays === 0) {
    return parseError('Could not parse any day hours from structured format');
  }

  return parseSuccess(schedule);
}

export default parseStructuredHoursFullWeek;
