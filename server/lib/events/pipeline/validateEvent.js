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
 * - At STORE time (sync-events.mjs) - PRIMARY, canonical location
 * - At READ time ONLY for legacy rows with schema_version < current
 *
 * @module server/lib/events/pipeline/validateEvent
 */

import { eventsLog, OP } from '../../../logger/workflow.js';

/**
 * Current schema version for validation tracking.
 * Increment when validation rules change.
 * Rows with version >= this do not need read-time revalidation.
 */
export const VALIDATION_SCHEMA_VERSION = 2; // 2026-01-09: Initial canonical version

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
 * @returns {ValidationResult} Validation result
 */
export function validateEvent(event) {
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

  // Rule 6: Must have event_time
  if (!event.event_time) {
    return { valid: false, reason: 'missing_time', field: 'event_time' };
  }

  // Rule 7: Time must not contain TBD/Unknown
  if (hasInvalidPattern(event.event_time)) {
    return { valid: false, reason: 'tbd_in_time', field: 'event_time' };
  }

  // Rule 8: Must have event_date
  if (!event.event_date) {
    return { valid: false, reason: 'missing_date', field: 'event_date' };
  }

  // Rule 9: Date must be valid format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.event_date)) {
    return { valid: false, reason: 'invalid_date_format', field: 'event_date' };
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
 * @returns {Object} { valid: ValidatedEvent[], invalid: { event, reason }[], stats }
 */
export function validateEventsHard(events, options = {}) {
  const { logRemovals = true, phase = 'VALIDATE' } = options;

  if (!events || !Array.isArray(events)) {
    return { valid: [], invalid: [], stats: { total: 0, valid: 0, invalid: 0 } };
  }

  const valid = [];
  const invalid = [];

  for (const event of events) {
    const result = validateEvent(event);

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
