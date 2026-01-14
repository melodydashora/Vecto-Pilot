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
export function normalizeVenueName(venue) {
  if (!venue || typeof venue !== 'string') return '';
  // Remove address suffix if present (e.g., "Venue Name, 123 Main St")
  const parts = venue.split(',');
  return parts[0].trim();
}

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
    return trimmed;
  }

  // Try MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try Month DD, YYYY or DD Month YYYY
  try {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch {
    // Parsing failed
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

  // Already HH:MM format
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Parse "7 PM", "7:30 PM", "19:00", etc.
  const match = trimmed.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] || '00';
  const period = (match[3] || '').toUpperCase();

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
 * Normalize a raw event to canonical format
 * This is the ONLY function that should convert provider output to internal format.
 *
 * @param {Object} rawEvent - Raw event from provider
 * @param {Object} context - Location context { city, state }
 * @returns {Object} NormalizedEvent
 */
export function normalizeEvent(rawEvent, context = {}) {
  const { city, state } = context;

  return {
    // Title - prefer 'title', fallback to 'name'
    title: normalizeTitle(rawEvent.title || rawEvent.name),

    // Venue - prefer 'venue_name', fallback to 'venue'
    venue_name: normalizeVenueName(rawEvent.venue_name || rawEvent.venue),

    // Address
    address: (rawEvent.address || rawEvent.location || '').trim(),

    // Location context
    city: rawEvent.city || city || '',
    state: rawEvent.state || state || '',
    // 2026-01-10: Removed zip, lat, lng, source_url, raw_source_data
    // Geocoding (lat/lng) happens in venue_catalog, which is source of truth for coordinates

    // Date/Time (2026-01-10: Renamed to symmetric naming convention)
    // Input: rawEvent.event_date → Output: event_start_date
    // Input: rawEvent.event_time → Output: event_start_time
    // Also accepts already-normalized input (event_start_date/event_start_time) for idempotency
    event_start_date: normalizeDate(rawEvent.event_date || rawEvent.event_start_date || rawEvent.date),
    event_start_time: normalizeTime(rawEvent.event_time || rawEvent.event_start_time || rawEvent.time),
    event_end_time: normalizeTime(rawEvent.event_end_time || rawEvent.end_time),
    // 2026-01-10: Default event_end_date to event_start_date for single-day events
    // Most events (concerts, sports games, DJ nights) are single-day - only multi-day festivals need explicit end_date
    event_end_date: normalizeDate(rawEvent.event_end_date) || normalizeDate(rawEvent.event_date || rawEvent.event_start_date || rawEvent.date),

    // Classification
    category: normalizeCategory(rawEvent.category, rawEvent.subtype),
    expected_attendance: normalizeAttendance(rawEvent.expected_attendance || rawEvent.impact)
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
