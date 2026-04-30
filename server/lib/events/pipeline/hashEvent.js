/**
 * server/lib/events/pipeline/hashEvent.js
 *
 * Canonical event hashing for deduplication.
 *
 * HASH CONTRACT (2026-04-30, v3 — Choice A normalization parity):
 * ═══════════════════════════════════════════════════════════════════════════
 * Hash input = normalize(title) | normalize(venue_name) | extract_street(address) | normalize(city) | date
 * Hash algorithm = MD5 (32-char hex)
 *
 * 2026-04-30 (v3): EXPANDED title normalization for parity with deduplicateEvents.
 * - Strip common content prefixes: "Live Music:", "Live Band:", "Concert:", "Show:",
 *   "Event:", "Performance:", "DJ Set:", "Acoustic:"
 * - Strip parentheticals: "(Shared Reality)", "(Special Edition)", etc.
 * - ADDED street_name extraction: catches "5776 Grandscape Blvd" === "5752 Grandscape Blvd"
 *   when same venue is reported with slight street-number variations.
 * Companion: claude_memory rows 268-271; PLAN_events-dedup-architectural-2026-04-30.md.
 *
 * 2026-04-10 (v2): CHANGED from v1 (title|venue_address|date|time).
 * - ADDED city: prevents "Fair Park, Dallas" and "Fair Park, Houston" from colliding.
 * - REMOVED time: "Bruno Mars 7:00 PM" and "Bruno Mars 7:30 PM" at same venue/date
 *   are the same event with a time correction — they should UPDATE, not create duplicates.
 * - CHANGED venue_address → venue_name: address varies across discovery runs but
 *   venue name is more stable for deduplication.
 *
 * CRITICAL: Title normalization MUST strip "at Venue" suffixes to prevent
 * duplicate events like "Cirque du Soleil at Cosm" vs "Cirque du Soleil"
 * from creating separate records.
 *
 * This hash is used for:
 * 1. Storage deduplication (ON CONFLICT event_hash DO UPDATE)
 * 2. Identifying same event across multiple discovery runs
 *
 * NOT used for:
 * - Semantic/runtime deduplication (use deduplicateEventsSemantic.js for that)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INVARIANT: Hash is deterministic - same event always produces same hash.
 * INVARIANT: Hash is consistent with normalization - uses normalizeEvent output.
 *
 * @module server/lib/events/pipeline/hashEvent
 */

import crypto from 'crypto';

/**
 * Strip "at Venue" suffixes from event titles.
 * This prevents duplicates like "Cirque du Soleil at Cosm" vs "Cirque du Soleil"
 *
 * Patterns removed:
 * - " at <Venue>" (e.g., "Concert at Madison Square Garden")
 * - " @ <Venue>" (e.g., "DJ Night @ The Club")
 * - " - <Venue>" (e.g., "Festival - City Park")
 *
 * @param {string} title - Event title
 * @returns {string} Title without venue suffix
 */
function stripVenueSuffix(title) {
  if (!title) return '';

  // Patterns: " at Venue", " @ Venue", " - Venue" at end of string
  // Must be careful not to strip legitimate title parts like "Night at the Museum"
  // Only strip when followed by venue-like words (capitalized, venue keywords)
  return title
    // " at <capitalized words>" at end (e.g., "Show at The Venue Name")
    .replace(/\s+at\s+([A-Z][^,]+)$/i, '')
    // " @ <anything>" at end
    .replace(/\s+@\s+.+$/i, '')
    // " - <capitalized venue>" at end (common format)
    .replace(/\s+-\s+([A-Z][A-Za-z\s&']+)$/i, '')
    .trim();
}

function stripPrefixes(title) {
  if (!title) return '';
  return title
    .replace(/^(live music|live band|concert|show|event|performance|dj set|acoustic):\s*/i, '')
    .trim();
}

function stripParentheticals(title) {
  if (!title) return '';
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStreetName(address) {
  if (!address) return '';
  const lower = address.toLowerCase();
  const streetMatch = lower.match(/\d+\s+(.+?)(?:,|$)/);
  const streetName = streetMatch ? streetMatch[1].split(/[,#]/)[0].trim() : lower;
  return streetName.split(/\s+/).slice(0, 2).join(' ');
}

/**
 * Normalize a string for hash input.
 * - Lowercase
 * - Remove quotes and special characters
 * - Collapse whitespace
 * - Trim
 *
 * @param {string|undefined} str - String to normalize
 * @returns {string} Normalized string
 */
function normalizeForHash(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/["'"]/g, '')           // Remove quotes
    .replace(/[^a-z0-9\s]/g, '')     // Remove special chars
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim();
}

/**
 * Normalize time to HH:MM format for consistent hashing.
 * Handles: "7 PM", "7:30 PM", "19:00", etc.
 *
 * @param {string|undefined} timeStr - Time string
 * @returns {string} Normalized time or empty string
 */
function normalizeTimeForHash(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';

  const trimmed = timeStr.trim().toUpperCase();

  // Already HH:MM format
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Parse "7 PM", "7:30 PM", etc.
  const match = trimmed.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (!match) return '';

  let hour = parseInt(match[1], 10);
  const minute = match[2] || '00';
  const period = (match[3] || '').toUpperCase();

  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return '';

  return `${hour.toString().padStart(2, '0')}:${minute}`;
}

/**
 * Build the canonical hash input string.
 * Format: "normalized_title | normalized_venue_name | street_name | normalized_city | date"
 *
 * 2026-04-30 (v3): Expanded title normalization (strip prefixes + parentheticals)
 *   and added street_name extraction for full parity with deduplicateEvents.
 *
 * @param {Object} event - NormalizedEvent or object with required fields
 * @returns {string} Hash input string
 */
export function buildHashInput(event) {
  let titleClean = stripVenueSuffix(event.title);
  titleClean = stripPrefixes(titleClean);
  titleClean = stripParentheticals(titleClean);
  const title = normalizeForHash(titleClean);

  const venue = normalizeForHash(event.venue_name || event.venue);
  const street = extractStreetName(event.address);
  const city = normalizeForHash(event.city);
  const date = event.event_start_date || '';

  return `${title}|${venue}|${street}|${city}|${date}`;
}

/**
 * Generate the canonical MD5 hash for an event.
 * This hash is stored in discovered_events.event_hash for deduplication.
 *
 * @param {Object} event - NormalizedEvent or object with required fields
 * @returns {string} 32-character MD5 hex hash
 */
export function generateEventHash(event) {
  const input = buildHashInput(event);
  return crypto.createHash('md5').update(input).digest('hex');
}

/**
 * Check if two events have the same hash (are duplicates by hash criteria)
 *
 * @param {Object} event1 - First event
 * @param {Object} event2 - Second event
 * @returns {boolean} True if events have same hash
 */
export function eventsHaveSameHash(event1, event2) {
  return generateEventHash(event1) === generateEventHash(event2);
}

/**
 * Group events by their hash for analysis/debugging
 *
 * @param {Array<Object>} events - Array of events
 * @returns {Map<string, Array<Object>>} Map of hash -> events with that hash
 */
export function groupEventsByHash(events) {
  if (!Array.isArray(events)) return new Map();

  const groups = new Map();
  for (const event of events) {
    const hash = generateEventHash(event);
    if (!groups.has(hash)) {
      groups.set(hash, []);
    }
    groups.get(hash).push(event);
  }
  return groups;
}

/**
 * Find duplicate events (events with same hash) for reporting
 *
 * @param {Array<Object>} events - Array of events
 * @returns {Array<{ hash: string, count: number, events: Array<Object> }>}
 */
export function findDuplicatesByHash(events) {
  const groups = groupEventsByHash(events);
  const duplicates = [];

  for (const [hash, groupEvents] of groups) {
    if (groupEvents.length > 1) {
      duplicates.push({
        hash,
        count: groupEvents.length,
        events: groupEvents
      });
    }
  }

  return duplicates;
}
