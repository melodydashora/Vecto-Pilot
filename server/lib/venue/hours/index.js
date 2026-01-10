/**
 * Venue Hours Module - Canonical Open/Closed Evaluation
 *
 * 2026-01-10: D-014 - Consolidated isOpen Logic
 *
 * This module provides THE SINGLE SOURCE OF TRUTH for venue hours evaluation.
 *
 * Architecture:
 * 1. PARSERS convert various input formats to NormalizedSchedule
 * 2. EVALUATOR takes NormalizedSchedule + timezone and returns OpenStatus
 * 3. No direct use of Google openNow - always use canonical evaluation
 *
 * Usage:
 * ```js
 * import { parseGoogleWeekdayText, getOpenStatus } from './hours/index.js';
 *
 * // Parse Google Places weekday_text array
 * const parseResult = parseGoogleWeekdayText(weekdayTexts);
 * if (parseResult.ok) {
 *   const status = getOpenStatus(parseResult.schedule, timezone);
 *   console.log(status.is_open, status.reason);
 * }
 * ```
 *
 * IMPORTANT: Do not add new open/closed logic outside this module.
 * All venue hours evaluation MUST go through this canonical path.
 */

// Parsers
export { parseGoogleWeekdayText } from './parsers/google-weekday-text.js';
export { parseHoursTextMap } from './parsers/hours-text-map.js';
export { parseStructuredHoursFullWeek } from './parsers/structured-hours.js';

// Evaluator
export { getOpenStatus } from './evaluator.js';

// Types and utilities
export {
  WEEKDAY_KEYS,
  closedDay,
  twentyFourHourDay,
  dayWithIntervals,
  createInterval,
  emptySchedule,
  parseError,
  parseSuccess,
  timeToMinutes,
  minutesToTime,
  minutesToDisplay
} from './normalized-types.js';
