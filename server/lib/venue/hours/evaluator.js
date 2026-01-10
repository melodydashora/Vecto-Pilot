/**
 * Canonical Venue Hours Evaluator
 *
 * 2026-01-10: D-014 Phase 3
 * 2026-01-10: CRITICAL FIX - Overnight hours day rollover bug
 *
 * THE SINGLE SOURCE OF TRUTH for venue open/closed status.
 * All other modules MUST use this evaluator via the parsers.
 *
 * Design principles:
 * - Pure function: no DB reads, no network calls
 * - Deterministic: same inputs always produce same outputs
 * - No silent coercion: missing timezone = null (not guess)
 * - Rich output: includes next transition times and reasons
 *
 * OVERNIGHT LOGIC FIX (2026-01-10):
 * Previous logic incorrectly marked early AM times as "open" when checking
 * TODAY's overnight shift. Example: Friday 12:47 AM was marked "open" because
 * Friday's shift (11 AM - 2 AM Saturday) has a close_minute of 120, and 47 < 120.
 *
 * CORRECT LOGIC: Two separate checks:
 * 1. YESTERDAY'S SPILLOVER: Did yesterday's overnight shift extend into today?
 * 2. TODAY'S MAIN SHIFT: Are we currently past today's opening time?
 */

import {
  WEEKDAY_KEYS,
  minutesToTime,
  minutesToDisplay
} from './normalized-types.js';

/**
 * Get current time components in a timezone
 *
 * @param {string} timezone - IANA timezone
 * @param {Date} [now] - Current time (default: new Date())
 * @returns {{ dayIndex: number, dayName: string, currentMinutes: number, yesterdayName: string } | null}
 */
function getTimeInTimezone(timezone, now = new Date()) {
  try {
    // Validate timezone by creating formatter
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long'
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const dayName = dayFormatter.format(now).toLowerCase();
    const dayIndex = WEEKDAY_KEYS.indexOf(dayName);
    if (dayIndex === -1) return null;

    // 2026-01-10: Also get yesterday for spillover check
    const yesterdayIndex = (dayIndex + 6) % 7; // Go back 1 day (wrap around)
    const yesterdayName = WEEKDAY_KEYS[yesterdayIndex];

    const timeParts = timeFormatter.formatToParts(now);
    const hour = parseInt(timeParts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(timeParts.find(p => p.type === 'minute')?.value || '0', 10);
    const currentMinutes = hour * 60 + minute;

    return { dayIndex, dayName, currentMinutes, yesterdayName, yesterdayIndex };

  } catch (e) {
    // Invalid timezone
    return null;
  }
}

/**
 * Check if current time falls within TODAY's main shift
 * (Only the portion AFTER opening, not the next-day spillover)
 *
 * 2026-01-10: FIXED - For overnight shifts, only returns true if we're PAST the opening time.
 * The early AM portion (spillover) is handled by checkYesterdaySpillover instead.
 *
 * @param {number} currentMinutes - Minutes since midnight
 * @param {{ open_minute: number, close_minute: number, closes_next_day: boolean }} interval
 * @returns {boolean}
 */
function isWithinTodayInterval(currentMinutes, interval) {
  const { open_minute, close_minute, closes_next_day } = interval;

  if (closes_next_day) {
    // 2026-01-10 FIX: Overnight shift - only open if we're PAST opening time today
    // Example: Opens 11 PM (1380), closes 2 AM (120) next day
    // At 11:30 PM (1410): 1410 >= 1380 → TRUE (open)
    // At 1:00 AM (60): 60 >= 1380 → FALSE (NOT in today's shift - this is yesterday's spillover)
    return currentMinutes >= open_minute;
  } else {
    // Same day: open from open_minute until close_minute
    return currentMinutes >= open_minute && currentMinutes < close_minute;
  }
}

/**
 * Check if current time falls within YESTERDAY's overnight spillover
 *
 * 2026-01-10: NEW - Checks if yesterday's overnight shift extended past midnight into today.
 * Example: Yesterday opened 11 PM, closes 2 AM today. At 1 AM today, this returns true.
 *
 * @param {number} currentMinutes - Minutes since midnight (today)
 * @param {{ open_minute: number, close_minute: number, closes_next_day: boolean } | null} interval
 * @returns {{ inSpillover: boolean, close_minute: number }}
 */
function checkYesterdaySpillover(currentMinutes, interval) {
  if (!interval || !interval.closes_next_day) {
    return { inSpillover: false, close_minute: 0 };
  }

  const { close_minute } = interval;

  // Yesterday's shift spills into today if:
  // - Yesterday's shift was overnight (closes_next_day = true)
  // - Current time is before the close time
  // Example: Yesterday closed at 2 AM (120). Current time 1 AM (60). 60 < 120 → TRUE
  if (currentMinutes < close_minute) {
    return { inSpillover: true, close_minute };
  }

  return { inSpillover: false, close_minute: 0 };
}

/**
 * Calculate minutes until a target time, accounting for day wrap
 *
 * @param {number} currentMinutes - Current minutes since midnight
 * @param {number} targetMinutes - Target minutes since midnight
 * @param {boolean} isNextDay - Whether target is on next day
 * @returns {number}
 */
function minutesUntil(currentMinutes, targetMinutes, isNextDay = false) {
  if (isNextDay) {
    // Target is tomorrow
    return (24 * 60 - currentMinutes) + targetMinutes;
  } else if (targetMinutes > currentMinutes) {
    // Target is later today
    return targetMinutes - currentMinutes;
  } else {
    // Target is tomorrow (wrapped)
    return (24 * 60 - currentMinutes) + targetMinutes;
  }
}

/**
 * Evaluate venue open status from normalized schedule
 *
 * THE CANONICAL EVALUATOR - use this function for all open/closed checks.
 *
 * 2026-01-10: CRITICAL FIX - Properly handles overnight hours with day rollover.
 * Now checks:
 * 1. YESTERDAY'S SPILLOVER: Did yesterday's overnight shift extend into today?
 * 2. TODAY'S MAIN SHIFT: Are we currently past today's opening time?
 *
 * @param {NormalizedSchedule} schedule - Normalized schedule from a parser
 * @param {string} timezone - IANA timezone (REQUIRED - no fallbacks)
 * @param {Date} [now] - Time to check (default: new Date())
 * @returns {OpenStatus}
 *
 * @example
 * const result = getOpenStatus(schedule, "America/Chicago");
 * // {
 * //   is_open: true,
 * //   closes_at: "02:00",
 * //   opens_at: null,
 * //   closing_soon: false,
 * //   minutes_until_close: 180,
 * //   minutes_until_open: null,
 * //   reason: "Open until 2:00 AM"
 * // }
 */
export function getOpenStatus(schedule, timezone, now = new Date()) {
  // Null result for unknown/error cases
  const nullResult = (reason) => ({
    is_open: null,
    closes_at: null,
    opens_at: null,
    closing_soon: false,
    minutes_until_close: null,
    minutes_until_open: null,
    reason
  });

  // 1. Validate timezone (REQUIRED - no fallbacks per CLAUDE.md)
  if (!timezone) {
    return nullResult('Missing timezone - cannot determine open/closed status');
  }

  // 2. Validate schedule
  if (!schedule || typeof schedule !== 'object') {
    return nullResult('Missing or invalid schedule');
  }

  // 3. Get current time in venue timezone (now includes yesterday info)
  const timeInfo = getTimeInTimezone(timezone, now);
  if (!timeInfo) {
    return nullResult(`Invalid timezone: ${timezone}`);
  }

  const { dayIndex, dayName, currentMinutes, yesterdayName } = timeInfo;

  // 4. Get today's and yesterday's schedules
  const todaySchedule = schedule[dayName];
  const yesterdaySchedule = schedule[yesterdayName];

  // ================================================================
  // CHECK 1: YESTERDAY'S SPILLOVER (2026-01-10 FIX)
  // Did yesterday's overnight shift extend into today?
  // ================================================================
  if (yesterdaySchedule && !yesterdaySchedule.is_closed && !yesterdaySchedule.is_24h) {
    const yesterdayIntervals = yesterdaySchedule.intervals || [];

    for (const interval of yesterdayIntervals) {
      const spillover = checkYesterdaySpillover(currentMinutes, interval);

      if (spillover.inSpillover) {
        // We're in yesterday's overnight spillover!
        const minutesUntilClose = spillover.close_minute - currentMinutes;
        const closingSoon = minutesUntilClose <= 60;

        return {
          is_open: true,
          closes_at: minutesToTime(spillover.close_minute),
          opens_at: null,
          closing_soon: closingSoon,
          minutes_until_close: minutesUntilClose,
          minutes_until_open: null,
          reason: `Open until ${minutesToDisplay(spillover.close_minute)} (from ${yesterdayName}'s shift)`
        };
      }
    }
  }

  // ================================================================
  // CHECK 2: TODAY'S MAIN SHIFT
  // Are we currently past today's opening time?
  // ================================================================

  // Handle missing day schedule
  if (!todaySchedule) {
    return nullResult(`No schedule for ${dayName}`);
  }

  // 5. Handle special cases
  if (todaySchedule.is_closed) {
    // Find next open time
    const nextOpen = findNextOpenTime(schedule, dayIndex, currentMinutes);
    return {
      is_open: false,
      closes_at: null,
      opens_at: nextOpen?.time || null,
      closing_soon: false,
      minutes_until_close: null,
      minutes_until_open: nextOpen?.minutes || null,
      reason: `Closed on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`
    };
  }

  if (todaySchedule.is_24h) {
    return {
      is_open: true,
      closes_at: null,
      opens_at: null,
      closing_soon: false,
      minutes_until_close: null,
      minutes_until_open: null,
      reason: 'Open 24 hours'
    };
  }

  // 6. Check today's intervals (using fixed isWithinTodayInterval)
  const intervals = todaySchedule.intervals || [];
  for (const interval of intervals) {
    if (isWithinTodayInterval(currentMinutes, interval)) {
      // Currently open in today's main shift
      const { close_minute, closes_next_day } = interval;

      // 2026-01-10 FIX: For overnight shifts that close next day,
      // calculate minutes until close correctly
      let minutesUntilClose;
      if (closes_next_day) {
        // Closing is tomorrow, so add remaining minutes today + close time tomorrow
        minutesUntilClose = (24 * 60 - currentMinutes) + close_minute;
      } else {
        minutesUntilClose = close_minute - currentMinutes;
      }
      const closingSoon = minutesUntilClose <= 60;

      return {
        is_open: true,
        closes_at: minutesToTime(close_minute),
        opens_at: null,
        closing_soon: closingSoon,
        minutes_until_close: minutesUntilClose,
        minutes_until_open: null,
        reason: `Open until ${minutesToDisplay(close_minute)}${closes_next_day ? ' (next day)' : ''}`
      };
    }
  }

  // 7. Currently closed - find next open time
  const nextOpen = findNextOpenTime(schedule, dayIndex, currentMinutes);

  // Check if there's a later interval today
  for (const interval of intervals) {
    if (interval.open_minute > currentMinutes) {
      // Opens later today
      const minutesUntilOpen = interval.open_minute - currentMinutes;
      return {
        is_open: false,
        closes_at: null,
        opens_at: minutesToTime(interval.open_minute),
        closing_soon: false,
        minutes_until_close: null,
        minutes_until_open: minutesUntilOpen,
        reason: `Opens at ${minutesToDisplay(interval.open_minute)}`
      };
    }
  }

  return {
    is_open: false,
    closes_at: null,
    opens_at: nextOpen?.time || null,
    closing_soon: false,
    minutes_until_close: null,
    minutes_until_open: nextOpen?.minutes || null,
    reason: nextOpen?.time ? `Opens at ${nextOpen.time}` : 'Currently closed'
  };
}

/**
 * Find the next time venue opens
 *
 * @param {NormalizedSchedule} schedule
 * @param {number} startDayIndex - Day index to start searching from
 * @param {number} currentMinutes - Current minutes since midnight
 * @returns {{ time: string, minutes: number } | null}
 */
function findNextOpenTime(schedule, startDayIndex, currentMinutes) {
  // Search up to 7 days ahead
  for (let offset = 0; offset < 7; offset++) {
    const dayIndex = (startDayIndex + offset) % 7;
    const dayName = WEEKDAY_KEYS[dayIndex];
    const daySchedule = schedule[dayName];

    if (!daySchedule || daySchedule.is_closed) continue;

    if (daySchedule.is_24h) {
      // Opens at midnight of this day
      const minutes = offset === 0 ? 0 : (offset * 24 * 60);
      return { time: '00:00', minutes };
    }

    const intervals = daySchedule.intervals || [];
    for (const interval of intervals) {
      // On current day, only consider intervals that haven't started yet
      if (offset === 0 && interval.open_minute <= currentMinutes) continue;

      // Calculate minutes until this opening
      const minutesUntilOpen = offset === 0
        ? interval.open_minute - currentMinutes
        : (offset * 24 * 60) - currentMinutes + interval.open_minute;

      return {
        time: minutesToDisplay(interval.open_minute),
        minutes: minutesUntilOpen
      };
    }
  }

  return null;
}

export default getOpenStatus;
