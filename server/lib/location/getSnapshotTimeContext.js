/**
 * server/lib/location/getSnapshotTimeContext.js
 *
 * Canonical timezone and date utility for the ETL pipeline.
 *
 * INVARIANT: This is the ONLY place where "today's date" and timezone should be resolved.
 * NO FALLBACKS - missing timezone is a bug that should surface immediately.
 *
 * @module server/lib/location/getSnapshotTimeContext
 */

/**
 * Custom error for missing timezone - should never be caught silently
 */
export class MissingTimezoneError extends Error {
  constructor(snapshotId) {
    super(`Snapshot ${snapshotId || 'unknown'} is missing required timezone data. This is a data integrity bug.`);
    this.name = 'MissingTimezoneError';
    this.code = 'MISSING_TIMEZONE';
  }
}

/**
 * Custom error for missing location data
 */
export class MissingLocationError extends Error {
  constructor(snapshotId, missingFields) {
    super(`Snapshot ${snapshotId || 'unknown'} is missing required location data: ${missingFields.join(', ')}`);
    this.name = 'MissingLocationError';
    this.code = 'MISSING_LOCATION';
    this.missingFields = missingFields;
  }
}

/**
 * Get time context from snapshot with strict validation.
 * This is the ONLY function that should resolve "today's date" for pipeline operations.
 *
 * @param {Object} snapshot - Snapshot row from database
 * @returns {Object} Time context object
 * @throws {MissingTimezoneError} If snapshot.timezone is missing
 * @throws {MissingLocationError} If snapshot.city or snapshot.state is missing
 */
export function getSnapshotTimeContext(snapshot) {
  if (!snapshot) {
    throw new Error('Snapshot is required for time context');
  }

  // Validate required fields - NO FALLBACKS
  if (!snapshot.timezone) {
    throw new MissingTimezoneError(snapshot.snapshot_id);
  }

  const missingLocation = [];
  if (!snapshot.city) missingLocation.push('city');
  if (!snapshot.state) missingLocation.push('state');
  if (missingLocation.length > 0) {
    throw new MissingLocationError(snapshot.snapshot_id, missingLocation);
  }

  // Get today's date in snapshot's timezone
  const now = new Date();
  const localISODate = now.toLocaleDateString('en-CA', { timeZone: snapshot.timezone });

  // Get day of week (0=Sunday, 6=Saturday) — already resolved in snapshot
  const dayOfWeek = snapshot.dow;

  // Hour and day part — already resolved in snapshot
  const hour = snapshot.hour;
  const dayPart = snapshot.day_part_key || 'night';

  // Weekend check
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    // Core time context (from validation)
    timeZone: snapshot.timezone,
    localISODate,  // YYYY-MM-DD in snapshot's timezone

    // Derived time values
    dayOfWeek,
    hour,
    dayPart,
    isWeekend,

    // Location context (validated)
    city: snapshot.city,
    state: snapshot.state,
    country: snapshot.country || 'US',

    // Coordinates (may be null for some operations)
    lat: snapshot.lat,
    lng: snapshot.lng,

    // Holiday status (from snapshot)
    isHoliday: snapshot.is_holiday || false,
    holiday: snapshot.holiday || null,

    // Raw snapshot reference
    snapshotId: snapshot.snapshot_id
  };
}

/**
 * Get date range for event queries (today to N days out).
 * Uses getSnapshotTimeContext internally - no fallbacks.
 *
 * @param {Object} snapshot - Snapshot row
 * @param {number} [daysAhead=7] - Number of days to look ahead
 * @returns {Object} { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * @throws {MissingTimezoneError} If snapshot.timezone is missing
 */
export function getEventDateRange(snapshot, daysAhead = 7) {
  const context = getSnapshotTimeContext(snapshot);

  const startDate = context.localISODate;

  // Calculate end date
  const endDateObj = new Date(startDate);
  endDateObj.setDate(endDateObj.getDate() + daysAhead);
  const endDate = endDateObj.toISOString().split('T')[0];

  return { startDate, endDate };
}

/**
 * Format a human-readable local time string from snapshot.
 * Uses getSnapshotTimeContext internally - no fallbacks.
 *
 * @param {Object} snapshot - Snapshot row
 * @returns {string} Formatted local time (e.g., "Friday, January 10, 2026, 3:30 PM")
 * @throws {MissingTimezoneError} If snapshot.timezone is missing
 */
export function formatLocalTime(snapshot) {
  const context = getSnapshotTimeContext(snapshot);

  // Use local_iso if available for precision
  // 2026-02-17: FIX - local_iso stores wall-clock time as fake UTC (timestamp without timezone).
  // Use timeZone: 'UTC' to prevent double-conversion.
  const baseTime = snapshot.local_iso ? new Date(snapshot.local_iso) : new Date();

  return baseTime.toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Check if a date is "today" in the snapshot's timezone.
 *
 * @param {string} dateStr - Date string (YYYY-MM-DD or parseable format)
 * @param {Object} snapshot - Snapshot row
 * @returns {boolean} True if date matches today in snapshot's timezone
 * @throws {MissingTimezoneError} If snapshot.timezone is missing
 */
export function isToday(dateStr, snapshot) {
  const context = getSnapshotTimeContext(snapshot);

  // Normalize input date to YYYY-MM-DD
  let normalizedDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    normalizedDate = dateStr;
  } else {
    try {
      normalizedDate = new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return false;
    }
  }

  return normalizedDate === context.localISODate;
}

/**
 * 2026-02-17: Convert a UTC ISO timestamp to a local time string.
 * Used when briefing data (weather observedAt, traffic fetchedAt, etc.) has
 * UTC timestamps that need to be shown in the driver's local time for LLM prompts.
 *
 * NOTE: This is for REAL UTC timestamps (e.g., from Google Weather API).
 * Do NOT use this for local_iso values — those are already local time stored as fake UTC.
 * For local_iso, use formatLocalTime() instead.
 *
 * @param {string} isoString - UTC ISO timestamp (e.g., "2026-02-17T09:08:36.565Z")
 * @param {string} timezone - IANA timezone (e.g., "America/Chicago")
 * @returns {string} Local time string (e.g., "3:08 AM CST")
 */
export function toLocalTimeString(isoString, timezone) {
  if (!isoString || !timezone) return isoString;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
  } catch {
    return isoString;
  }
}
