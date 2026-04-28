/**
 * server/lib/events/pipeline/validateEvent.js
 *
 * Canonical event validation for the ETL pipeline.
 * Hard filters that remove incomplete/invalid events.
 *
 * INVARIANT: This is the ONLY place where TBD/Unknown filtering logic is defined.
 * All callers must use this module - no duplicate implementations allowed.
 *
 * WHEN TO CALL:
 * - At STORE time (briefing-service.js) - PRIMARY, canonical location
 * - At READ time ONLY for legacy rows with schema_version < current
 *
 * @module server/lib/events/pipeline/validateEvent
 */

import { eventsLog, OP } from '../../../logger/workflow.js';
// 2026-04-05: Import normalizeCategory for fuzzy rescue — if the AI returns an unmapped
// category value, remap it before rejecting. This makes the pipeline self-healing.
import { normalizeCategory } from './normalizeEvent.js';

/**
 * Current schema version for validation tracking.
 * Increment when validation rules change.
 * Rows with version >= this do not need read-time revalidation.
 */
// 2026-04-28: bumped to v5 — Rule 13 today-check is now timezone-aware via
// context.timezone (driver's snapshot timezone). Stored rows with schema_version=4
// pass needsReadTimeValidation correctly because v4<v5; new writes stamp v5.
export const VALIDATION_SCHEMA_VERSION = 5;

/**
 * Patterns that indicate incomplete/invalid data
 * These patterns are matched against critical fields.
 */
const INVALID_PATTERNS = [
  /\btbd\b/i,                    // "TBD" as word
  /\bunknown\b/i,                // "Unknown" as word
  /venue\s*tbd/i,                // "Venue TBD"
  /location\s*tbd/i,             // "Location TBD"
  /time\s*tbd/i,                 // "Time TBD"
  /\(tbd\)/i,                    // "(TBD)"
  /to\s*be\s*determined/i,       // "To Be Determined"
  /not\s*yet\s*announced/i,      // "Not Yet Announced"
  /coming\s*soon/i,              // "Coming Soon"
  /various\s*(locations?|venues?)/i, // "Various Locations"
];

/**
 * Check if a value contains invalid patterns
 * @param {string|undefined} value - Value to check
 * @returns {boolean} True if value contains invalid pattern
 */
function hasInvalidPattern(value) {
  if (!value || typeof value !== 'string') return false;
  return INVALID_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Validation result for a single event
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether event passed validation
 * @property {string|null} reason - Reason for failure if invalid
 * @property {string} field - Field that failed (if invalid)
 */

/**
 * Validate a single event against hard filter rules.
 * Returns validation result with reason for failure.
 *
 * @param {Object} event - NormalizedEvent to validate
 * @param {Object} [context={}] - Optional context for timezone-aware checks
 * @param {string} [context.timezone] - IANA timezone for Rule 13 today/yesterday check.
 *   When provided, today/yesterday are computed in the driver's local timezone instead
 *   of UTC. Required for global-app correctness — a Pacific/Honolulu driver at 11:30 PM
 *   local has UTC tomorrow, and the UTC-only check would reject all of today's events.
 *   Without context.timezone, falls back to UTC for backwards compatibility.
 * @returns {ValidationResult} Validation result
 */
export function validateEvent(event, context = {}) {
  // Rule 1: Must have title
  if (!event.title || event.title.trim() === '') {
    return { valid: false, reason: 'missing_title', field: 'title' };
  }

  // Rule 2: Title must not contain TBD/Unknown
  if (hasInvalidPattern(event.title)) {
    return { valid: false, reason: 'tbd_in_title', field: 'title' };
  }

  // Rule 3: Must have venue or address
  const hasLocation = event.venue_name || event.address;
  if (!hasLocation) {
    return { valid: false, reason: 'missing_location', field: 'venue_name/address' };
  }

  // Rule 4: Venue must not contain TBD/Unknown
  if (hasInvalidPattern(event.venue_name)) {
    return { valid: false, reason: 'tbd_in_venue', field: 'venue_name' };
  }

  // Rule 5: Address must not contain TBD/Unknown
  if (hasInvalidPattern(event.address)) {
    return { valid: false, reason: 'tbd_in_address', field: 'address' };
  }

  // Rule 6: Must have event_start_time (2026-01-10: renamed from event_time)
  if (!event.event_start_time) {
    return { valid: false, reason: 'missing_start_time', field: 'event_start_time' };
  }

  // Rule 7: Start time must not contain TBD/Unknown
  if (hasInvalidPattern(event.event_start_time)) {
    return { valid: false, reason: 'tbd_in_start_time', field: 'event_start_time' };
  }

  // Rule 8: Must have event_end_time
  // 2026-01-10: Added to enforce frontend contract (BriefingTab.tsx requires both times)
  // Events without end times are not useful for rideshare drivers (can't predict pickup surge)
  if (!event.event_end_time) {
    return { valid: false, reason: 'missing_end_time', field: 'event_end_time' };
  }

  // Rule 9: End time must not contain TBD/Unknown
  if (hasInvalidPattern(event.event_end_time)) {
    return { valid: false, reason: 'tbd_in_end_time', field: 'event_end_time' };
  }

  // Rule 10: Must have event_start_date (2026-01-10: renamed from event_date)
  if (!event.event_start_date) {
    return { valid: false, reason: 'missing_start_date', field: 'event_start_date' };
  }

  // Rule 11: Date must be valid format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.event_start_date)) {
    return { valid: false, reason: 'invalid_date_format', field: 'event_start_date' };
  }

  // Rule 12: Category is REQUIRED and must be from allowed list
  // 2026-02-26: Events without category are not useful for strategy or filtering
  // 2026-04-05: Added fuzzy rescue — if the AI returns an unmapped value (e.g., "live_music",
  // "game", "hockey"), try normalizeCategory() before rejecting. This handles cases where
  // events bypass normalizeEvent() or the AI returns unexpected category strings.
  const ALLOWED_CATEGORIES = ['concert', 'sports', 'comedy', 'theater', 'festival', 'nightlife', 'convention', 'community', 'other'];
  if (!event.category || !ALLOWED_CATEGORIES.includes(event.category)) {
    // Fuzzy rescue: try to remap the category before rejecting
    const remapped = normalizeCategory(event.category, event.subtype);
    if (ALLOWED_CATEGORIES.includes(remapped)) {
      event.category = remapped;  // Mutate in place — callers expect validated events to have valid categories
    } else {
      return { valid: false, reason: 'missing_or_invalid_category', field: 'category' };
    }
  }

  // Rule 13: Date must be today or yesterday in the driver's local timezone
  // 2026-02-26: We only ask Gemini for today's events. Future-dated events are noise.
  // Allow yesterday to handle events discovered before midnight that end after midnight.
  // 2026-04-28: tz-aware via context.timezone. UTC fallback preserved for legacy callers
  // (without context). Spec §9.2 — global-app correctness for far-east / Hawaii / etc.
  const tz = context.timezone;
  const today = tz
    ? new Date().toLocaleDateString('en-CA', { timeZone: tz })
    : new Date().toISOString().split('T')[0];
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = tz
    ? yesterdayDate.toLocaleDateString('en-CA', { timeZone: tz })
    : yesterdayDate.toISOString().split('T')[0];
  if (event.event_start_date !== today && event.event_start_date !== yesterday) {
    return { valid: false, reason: 'not_today', field: 'event_start_date' };
  }

  // All rules passed
  return { valid: true, reason: null, field: null };
}

/**
 * Validate an array of events with hard filters.
 * This is the canonical validation function - use this, not duplicates.
 *
 * @param {Array<Object>} events - Array of NormalizedEvents
 * @param {Object} options - Options
 * @param {boolean} [options.logRemovals=true] - Whether to log removed events
 * @param {string} [options.phase='VALIDATE'] - Phase label for logging
 * @param {Object} [options.context={}] - Threaded to validateEvent for tz-aware Rule 13.
 *   Pass `{ timezone: snapshot.timezone }` from briefing-service callers (2026-04-28).
 * @returns {Object} { valid: ValidatedEvent[], invalid: { event, reason }[], stats }
 */
export function validateEventsHard(events, options = {}) {
  const { logRemovals = true, phase = 'VALIDATE', context = {} } = options;

  if (!events || !Array.isArray(events)) {
    return { valid: [], invalid: [], stats: { total: 0, valid: 0, invalid: 0 } };
  }

  const valid = [];
  const invalid = [];

  for (const event of events) {
    const result = validateEvent(event, context);

    if (result.valid) {
      valid.push(event);
    } else {
      invalid.push({
        event,
        reason: result.reason,
        field: result.field
      });

      if (logRemovals) {
        eventsLog.phase(2, `Removed (${result.reason}): "${event.title?.slice(0, 40) || '(no title)'}"`, OP.VALIDATE);
      }
    }
  }

  const stats = {
    total: events.length,
    valid: valid.length,
    invalid: invalid.length
  };

  if (invalid.length > 0) {
    eventsLog.done(2, `Validation: ${stats.total} → ${stats.valid} (${stats.invalid} invalid removed)`, OP.VALIDATE);
  }

  return { valid, invalid, stats };
}

/**
 * Check if events need read-time validation based on schema version.
 * Use this to avoid redundant filtering of already-validated data.
 *
 * @param {number|undefined} schemaVersion - Schema version from DB row
 * @returns {boolean} True if read-time validation is needed
 */
export function needsReadTimeValidation(schemaVersion) {
  // If no schema version recorded, assume legacy data needs validation
  if (schemaVersion === undefined || schemaVersion === null) {
    return true;
  }
  // If version is older than current, needs validation
  return schemaVersion < VALIDATION_SCHEMA_VERSION;
}

/**
 * Backwards-compatible wrapper that matches the old filterInvalidEvents signature.
 * Use this ONLY for migration - new code should use validateEventsHard directly.
 *
 * @deprecated Use validateEventsHard instead
 * @param {Array<Object>} events - Events to filter
 * @returns {Array<Object>} Valid events only
 */
export function filterInvalidEventsLegacy(events) {
  const result = validateEventsHard(events, { logRemovals: true, phase: 'LEGACY_FILTER' });
  return result.valid;
}
