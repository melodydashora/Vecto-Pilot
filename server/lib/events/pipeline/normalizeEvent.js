/**
 * server/lib/events/pipeline/normalizeEvent.js
 *
 * Canonical event normalization for the ETL pipeline.
 * Converts RawEvent (provider format) → NormalizedEvent (canonical format).
 *
 * INVARIANT: Normalization is deterministic - same input always produces same output.
 *
 * @module server/lib/events/pipeline/normalizeEvent
 */

/**
 * Normalize title - remove quotes, trim, collapse whitespace
 * @param {string|undefined} title - Raw title
 * @returns {string} Normalized title
 */
export function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/^["'"]+|["'"]+$/g, '') // Remove surrounding quotes
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim();
}

/**
 * Normalize venue name - extract venue from combined strings
 * @param {string|undefined} venue - Raw venue name
 * @returns {string} Normalized venue name
 */
export function cleanVenueName(venue) {
  if (!venue || typeof venue !== 'string') return '';
  // Remove address suffix if present (e.g., "Venue Name, 123 Main St")
  const parts = venue.split(',');
  return parts[0].trim();
}

/**
 * Alias for backward compatibility (tests expect normalizeVenueName)
 */
export const normalizeVenueName = cleanVenueName;

/**
 * Normalize date to YYYY-MM-DD format
 * Handles various input formats: YYYY-MM-DD, MM/DD/YYYY, Month DD YYYY, etc.
 * @param {string|undefined} dateStr - Raw date string
 * @returns {string|null} Normalized date in YYYY-MM-DD format, or null if invalid
 */
export function normalizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    if (trimmed.startsWith('0000-')) return null;
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
  }

  // Try MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return normalizeDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  }

  // Parse named calendar dates explicitly so JavaScript cannot silently roll
  // "February 30" into March. No locale/server-timezone round trip.
  const monthFirst = trimmed.match(/^([A-Za-z]+) (\d{1,2}),? (\d{4})$/);
  const dayFirst = trimmed.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (monthFirst || dayFirst) {
    const monthName = (monthFirst ? monthFirst[1] : dayFirst[2]).toLowerCase();
    const day = monthFirst ? monthFirst[2] : dayFirst[1];
    const year = monthFirst ? monthFirst[3] : dayFirst[3];
    const months = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const month = months.findIndex(name => name === monthName || name.slice(0, 3) === monthName) + 1;
    if (month) return normalizeDate(`${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`);
  }

  return null;
}

/**
 * Normalize time to HH:MM format (24-hour)
 * Handles: "7 PM", "7:30 PM", "19:00", "7:30pm", etc.
 * @param {string|undefined} timeStr - Raw time string
 * @returns {string|null} Normalized time in HH:MM format, or null if invalid
 */
export function normalizeTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;

  const trimmed = timeStr.trim().toUpperCase();

  // Parse "7 PM", "7:30 PM", "19:00", etc.
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] || '00';
  const period = (match[3] || '').toUpperCase();

  if (Number(minute) > 59 || (period && (hour < 1 || hour > 12))) return null;

  // Convert to 24-hour
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;

  // Validate hour range
  if (hour < 0 || hour > 23) return null;

  return `${hour.toString().padStart(2, '0')}:${minute}`;
}

// 2026-01-10: Removed normalizeCoordinate - geocoding happens in venue_catalog

/**
 * Normalize category to canonical values
 * @param {string|undefined} category - Raw category
 * @param {string|undefined} subtype - Raw subtype (fallback)
 * @returns {string} Normalized category
 */
export function normalizeCategory(category, subtype) {
  const raw = (category || subtype || 'other').toLowerCase();

  // Map to canonical categories
  if (raw.includes('concert') || raw.includes('music') || raw.includes('live')) {
    return 'concert';
  }
  if (raw.includes('sport') || raw.includes('game') || raw.includes('nba') || raw.includes('nfl') || raw.includes('nhl') || raw.includes('mlb')) {
    return 'sports';
  }
  if (raw.includes('comedy') || raw.includes('standup')) {
    return 'comedy';
  }
  if (raw.includes('theater') || raw.includes('theatre') || raw.includes('performance')) {
    return 'theater';
  }
  if (raw.includes('festival') || raw.includes('fair') || raw.includes('parade')) {
    return 'festival';
  }
  if (raw.includes('night') || raw.includes('club') || raw.includes('bar')) {
    return 'nightlife';
  }
  if (raw.includes('convention') || raw.includes('conference') || raw.includes('expo')) {
    return 'convention';
  }
  if (raw.includes('community') || raw.includes('charity') || raw.includes('fundraiser')) {
    return 'community';
  }

  return 'other';
}

/**
 * Normalize attendance/impact to high/medium/low
 * @param {string|undefined} attendance - Raw attendance value
 * @returns {string} Normalized attendance (high/medium/low)
 */
export function normalizeAttendance(attendance) {
  const raw = (attendance || 'medium').toLowerCase();

  if (raw === 'high' || raw.includes('large') || raw.includes('major')) {
    return 'high';
  }
  if (raw === 'low' || raw.includes('small') || raw.includes('minor')) {
    return 'low';
  }
  return 'medium';
}

/**
 * 2026-05-05: P0-2 fix per events_e2e_audit.md.
 * Decide event_end_date for a normalized event, accounting for overnight rollover.
 *
 * An explicit event_end_date must normalize successfully; invalid input stays empty for validation.
 * Otherwise, if event_end_time is at or before event_start_time (e.g. nightlife
 * 20:00 → 02:00), the event crosses midnight; end_date = start_date + 1 day.
 * Else end_date = start_date (single-day event).
 *
 * Without this rollover, cleanup and freshness logic treat overnight events as
 * ending earlier on the same date — deactivating them prematurely.
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} startTime - HH:MM (24-hour)
 * @param {string} endTime - HH:MM (24-hour)
 * @param {string|undefined} providerEndDate - Raw provider event_end_date (if any)
 * @returns {string} YYYY-MM-DD
 */
function inferEndDate(startDate, startTime, endTime, providerEndDate) {
  if (providerEndDate) return normalizeDate(providerEndDate) || '';
  if (!startDate) return '';
  if (!startTime || !endTime) return startDate;
  // String comparison works because both are HH:MM 24-hour
  if (endTime <= startTime) {
    // Cross-midnight: bump to next calendar day
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
  }
  return startDate;
}

/**
 * Normalize a raw event to canonical format
 * This is the ONLY function that should convert provider output to internal format.
 *
 * @param {Object} rawEvent - Raw event from provider
 * @param {Object} context - Location context { city, state }
 * @returns {Object} NormalizedEvent
 */
export function normalizeEvent(rawEvent, context = {}) {
  const { city, state } = context;

  // Classification
  const category = normalizeCategory(rawEvent.category, rawEvent.subtype);
  const expected_attendance = normalizeAttendance(rawEvent.expected_attendance || rawEvent.impact);

  // Date/Time Normalization
  const event_start_date = normalizeDate(rawEvent.event_date || rawEvent.event_start_date || rawEvent.date);

  // 2026-09-13: Preserve unknown timing for the validation boundary. The prior
  // category defaults and duration estimates turned TBD/All Day into invented
  // pickup windows that were stored as verified schedule facts.
  const event_start_time = normalizeTime(rawEvent.event_time || rawEvent.event_start_time || rawEvent.time);
  const event_end_time = normalizeTime(rawEvent.event_end_time || rawEvent.end_time);

  // Preserve bounded opaque provider-ID hints without assuming a Google prefix.
  // This is untrusted model input; MAIN/Concierge still resolve provider identity.
  const rawPlaceId = typeof rawEvent.place_id === 'string' ? rawEvent.place_id.trim() : '';
  const place_id = rawPlaceId && rawPlaceId.length <= 255 &&
    !/^(unknown|n\/a|null|none)$/i.test(rawPlaceId) &&
    !Array.from(rawPlaceId).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
    ? rawPlaceId : null;

  return {
    // Title - prefer 'title', fallback to 'name'
    title: normalizeTitle(rawEvent.title || rawEvent.name),

    // Venue - prefer 'venue_name', fallback to 'venue'
    venue_name: cleanVenueName(rawEvent.venue_name || rawEvent.venue),

    // Address
    address: (rawEvent.address || rawEvent.location || '').trim(),

    // 2026-02-26: Google Places ID from Gemini — primary key for venue_catalog linking
    place_id,

    // Location context
    city: rawEvent.city || city || '',
    state: rawEvent.state || state || '',
    // 2026-01-10: Removed zip, lat, lng, source_url, raw_source_data
    // Geocoding (lat/lng) happens in venue_catalog, which is source of truth for coordinates

    // Date/Time (2026-01-10: Renamed to symmetric naming convention)
    event_start_date,
    event_start_time,
    event_end_time,
    // 2026-05-05: P0-2 fix — use inferEndDate() to detect cross-midnight rollover.
    // Replaces the old "default end_date to start_date" logic that broke nightlife events.
    event_end_date: inferEndDate(event_start_date, event_start_time, event_end_time, rawEvent.event_end_date),

    // Classification
    category,
    expected_attendance
    // 2026-01-10: Removed source_model - not needed, all events come from Gemini discovery
  };
}

/**
 * Normalize an array of raw events
 * @param {Array<Object>} rawEvents - Array of raw events
 * @param {Object} context - Location context { city, state }
 * @returns {Array<Object>} Array of NormalizedEvents
 */
export function normalizeEvents(rawEvents, context = {}) {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents.map(e => normalizeEvent(e, context));
}
