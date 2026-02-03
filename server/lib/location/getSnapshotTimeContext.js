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

  // Get day of week (0=Sunday, 6=Saturday)
  const dayOfWeek = parseInt(
    now.toLocaleDateString('en-US', { timeZone: snapshot.timezone, weekday: 'numeric' })
      .replace(/\D/g, ''),
    10
  ) || snapshot.dow;

  // Get hour (0-23)
  const hour = parseInt(
    now.toLocaleTimeString('en-US', { timeZone: snapshot.timezone, hour: 'numeric', hour12: false }),
    10
  ) || snapshot.hour;

  // Day part calculation
  let dayPart;
  if (hour >= 5 && hour < 12) dayPart = 'morning';
  else if (hour >= 12 && hour < 17) dayPart = 'afternoon';
  else if (hour >= 17 && hour < 21) dayPart = 'evening';
  else dayPart = 'night';

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
  const baseTime = snapshot.local_iso ? new Date(snapshot.local_iso) : new Date();

  return baseTime.toLocaleString('en-US', {
    timeZone: context.timeZone,
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
