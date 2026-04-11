/**
 * server/lib/events/pipeline/deduplicateEventsSemantic.js
 *
 * Title-similarity event deduplication for the discovery pipeline.
 *
 * 2026-04-11: Created to fix duplicate events from parallel Gemini category searches.
 *
 * PROBLEM: Gemini returns the same event with slight title variations across categories:
 *   - "Jon Wolfe Concert" / "Jon Wolfe Live" / "Jon Wolfe" → 3 duplicates at Billy Bob's
 *   - "Fatboy Slim" / "Fatboy Slim, Coco & Breezy, Jay Pryor" → 2 at SILO Dallas
 *   - "Kathy Griffin Live" / "Kathy Griffin" → 2 at Majestic Theatre
 *
 * PROBLEM: Same event returned with both a correct small venue AND a wrong large stadium:
 *   - "Jon Wolfe" at Globe Life Field (wrong) + "Jon Wolfe" at Billy Bob's Texas (correct)
 *   - "Fatboy Slim" at Globe Life Field (wrong) + "Fatboy Slim" at SILO Dallas (correct)
 *
 * SOLUTION: Two-phase dedup:
 *   Phase 1 — Title containment: If normalized title A contains B (or vice versa),
 *             AND same date + same/close start time → group as duplicates.
 *   Phase 2 — Venue plausibility: When choosing which duplicate to keep, prefer
 *             specific venues over large stadiums/arenas (comedy at Globe Life = wrong).
 *
 * This module is ADDITIVE — it runs AFTER the existing hash-based dedup, not instead of it.
 * It catches duplicates that have different hashes due to title/venue variations.
 *
 * @module server/lib/events/pipeline/deduplicateEventsSemantic
 */

// ─────────────────────────────────────────────────────────────────────────────
// LARGE VENUE PATTERNS — venues where small events don't belong
// These are stadiums, arenas, and mega-venues. If an event with <5000 attendance
// or a comedy/small-band category is assigned here, it's probably a Gemini error.
// ─────────────────────────────────────────────────────────────────────────────
const LARGE_VENUE_PATTERNS = [
  /stadium/i, /\bfield\b/i, /ballpark/i, /coliseum/i, /colosseum/i,
  /\barena\b/i, /speedway/i, /raceway/i, /racetrack/i, /motor\s*speedway/i,
  /fairground/i, /fair\s*park/i, /convention\s*center/i, /expo\s*center/i
];

/**
 * Check if a venue name matches a large venue pattern.
 * @param {string} venueName
 * @returns {boolean}
 */
function isLargeVenue(venueName) {
  if (!venueName) return false;
  return LARGE_VENUE_PATTERNS.some(pattern => pattern.test(venueName));
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE NORMALIZATION — strip common suffixes/prefixes to find "core" artist/event name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common title suffixes that don't change the identity of the event.
 * "Jon Wolfe Concert" → "Jon Wolfe", "Kathy Griffin Live" → "Kathy Griffin"
 */
const TITLE_SUFFIX_WORDS = new Set([
  'concert', 'live', 'show', 'tour', 'performance', 'experience',
  'presents', 'featuring', 'feat', 'ft', 'special', 'event',
  'night', 'stand-up', 'standup', 'comedy', 'acoustic', 'unplugged',
  'in concert', 'live in concert'
]);

/**
 * Normalize an event title to its "core" identity for comparison.
 * Strips common suffixes, prefixes, featured artists, and venue references.
 *
 * @param {string} title - Raw event title
 * @returns {string} Normalized core title
 *
 * @example
 * normalizeTitleForComparison("Jon Wolfe Concert") → "jon wolfe"
 * normalizeTitleForComparison("Jon Wolfe Live") → "jon wolfe"
 * normalizeTitleForComparison("Fatboy Slim, Coco & Breezy, Jay Pryor") → "fatboy slim"
 * normalizeTitleForComparison("Dinastia Tour by Peso Pluma, Tito Double P & Friends") → "dinastia tour peso pluma tito double p friends"
 */
export function normalizeTitleForComparison(title) {
  if (!title) return '';

  let t = title
    .toLowerCase()
    .replace(/["'"']/g, '')                              // Remove quotes
    .replace(/\s*\([^)]*\)\s*/g, ' ')                   // Remove (parenthetical)
    .replace(/\s+(at|in|@)\s+.+$/i, '')                 // Remove "at Venue" suffix
    .replace(/\s*[-–—]\s+[A-Z][A-Za-z\s&']+$/i, '')    // Remove " - Venue Name" suffix
    .replace(/^(live music|live band|dj set|acoustic):\s*/i, '') // Remove prefixes
    .replace(/[^a-z0-9\s]/g, ' ')                       // Remove special chars
    .replace(/\s+/g, ' ')                               // Collapse spaces
    .trim();

  // Strip trailing suffix words: "jon wolfe concert" → "jon wolfe"
  const words = t.split(' ');
  while (words.length > 1 && TITLE_SUFFIX_WORDS.has(words[words.length - 1])) {
    words.pop();
  }

  return words.join(' ');
}

/**
 * Extract the "primary artist" from a title that lists multiple performers.
 * "Fatboy Slim, Coco & Breezy, Jay Pryor" → "fatboy slim"
 * "Peso Pluma & Tito Double P" → "peso pluma"
 *
 * @param {string} normalizedTitle - Already normalized title
 * @returns {string} Primary artist name (first segment before comma or &)
 */
function extractPrimaryArtist(normalizedTitle) {
  if (!normalizedTitle) return '';

  // Split on comma first (higher priority separator)
  const commaSegments = normalizedTitle.split(/\s*,\s*/);
  if (commaSegments.length > 1) {
    return commaSegments[0].trim();
  }

  // Split on " & " or " and " (but not "Tito & Tarantula" which is one act)
  // Only split if both sides are 2+ words (single-word sides likely part of one name)
  const ampMatch = normalizedTitle.match(/^(.+?)\s+(?:&|and)\s+(.+)$/);
  if (ampMatch) {
    const left = ampMatch[1].trim();
    const right = ampMatch[2].trim();
    // Only split if right side has multiple words (suggests separate act)
    if (right.split(/\s+/).length >= 2 && left.split(/\s+/).length >= 1) {
      return left;
    }
  }

  return normalizedTitle;
}

/**
 * Normalize start time to minutes since midnight for comparison.
 * "7:00 PM" → 1140, "9 PM" → 1260, "19:00" → 1140
 *
 * @param {string} timeStr
 * @returns {number|null} Minutes since midnight, or null if unparseable
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;

  const trimmed = timeStr.trim().toUpperCase();

  // 24-hour: "19:00"
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(':').map(Number);
    return h * 60 + m;
  }

  // 12-hour: "7 PM", "7:30 PM", "9:00PM"
  const match = trimmed.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const min = parseInt(match[2] || '0', 10);
  const period = (match[3] || '').toUpperCase();

  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;

  return hour * 60 + min;
}

/**
 * Check if two titles refer to the same event using containment matching.
 *
 * Rules:
 * 1. If normalized titles are identical → match
 * 2. If one normalized title contains the other → match
 * 3. If primary artists are the same → match (handles "Fatboy Slim" vs "Fatboy Slim, Coco & Breezy")
 *
 * @param {string} titleA - First event title (raw)
 * @param {string} titleB - Second event title (raw)
 * @returns {boolean}
 */
export function titlesMatch(titleA, titleB) {
  const normA = normalizeTitleForComparison(titleA);
  const normB = normalizeTitleForComparison(titleB);

  if (!normA || !normB) return false;

  // Exact match after normalization
  if (normA === normB) return true;

  // Containment: "jon wolfe" is contained in "jon wolfe live" (after normalization)
  if (normA.includes(normB) || normB.includes(normA)) return true;

  // Primary artist match: "fatboy slim" from "fatboy slim coco breezy jay pryor"
  const artistA = extractPrimaryArtist(normA);
  const artistB = extractPrimaryArtist(normB);

  if (artistA && artistB && artistA.length >= 3 && artistB.length >= 3) {
    if (artistA === artistB) return true;
    if (artistA.includes(artistB) || artistB.includes(artistA)) return true;
  }

  return false;
}

/**
 * Check if two events are on the same date with overlapping/close start times.
 *
 * @param {Object} eventA
 * @param {Object} eventB
 * @param {number} [timeThresholdMinutes=120] - Max time difference to consider "same slot"
 * @returns {boolean}
 */
function sameTimeSlot(eventA, eventB, timeThresholdMinutes = 120) {
  // Must be same date
  const dateA = eventA.event_start_date;
  const dateB = eventB.event_start_date;
  if (!dateA || !dateB || dateA !== dateB) return false;

  // If both have start times, check proximity
  const minA = timeToMinutes(eventA.event_start_time);
  const minB = timeToMinutes(eventB.event_start_time);

  if (minA != null && minB != null) {
    return Math.abs(minA - minB) <= timeThresholdMinutes;
  }

  // If one or both are missing time, same date is enough (conservative — prefer false positive)
  return true;
}

/**
 * Score an event for "which duplicate to keep" preference.
 * Higher score = more likely to be the correct/best version.
 *
 * Scoring:
 * - Specific venue (not a stadium) = +10
 * - Has venue_name = +5
 * - Has address = +3
 * - Longer title (more descriptive) = +2
 * - Has place_id = +2
 * - Has start time = +1
 *
 * @param {Object} event
 * @returns {number} Preference score
 */
function scoreEventPreference(event) {
  let score = 0;

  // Heavily prefer specific venues over large stadiums
  if (event.venue_name || event.venue) {
    score += 5;
    if (!isLargeVenue(event.venue_name || event.venue)) {
      score += 10; // Big bonus for non-stadium venue
    }
  }

  if (event.address) score += 3;
  if (event.place_id) score += 2;
  if (event.event_start_time) score += 1;

  // Prefer longer titles (more descriptive, usually from more specific search)
  const titleLen = (event.title || '').length;
  if (titleLen > 20) score += 2;
  if (titleLen > 40) score += 1;

  return score;
}

/**
 * Deduplicate events using title-similarity matching.
 *
 * Two-phase approach:
 * 1. Group events by same date + close start time + similar title
 * 2. From each group, keep the event with the highest preference score
 *    (specific venue > stadium, has address > no address)
 *
 * @param {Array<Object>} events - Array of events (normalized or raw)
 * @param {Object} [options]
 * @param {number} [options.timeThresholdMinutes=120] - Max time gap for same-slot
 * @param {boolean} [options.log=true] - Whether to log dedup actions
 * @returns {{ deduplicated: Array<Object>, removed: Array<Object>, mergeLog: string[] }}
 */
export function deduplicateEventsSemantic(events, options = {}) {
  const { timeThresholdMinutes = 120, log = true } = options;
  const mergeLog = [];

  if (!events || events.length === 0) {
    return { deduplicated: [], removed: [], mergeLog };
  }

  // Build groups using a union-find approach:
  // For each pair of events, if they match (same date+time, similar title),
  // merge them into the same group.
  //
  // O(n²) but n is small (typically 20-60 events per discovery run).
  const groups = []; // Array of arrays
  const assigned = new Set(); // Indices already in a group

  for (let i = 0; i < events.length; i++) {
    if (assigned.has(i)) continue;

    const group = [events[i]];
    assigned.add(i);

    for (let j = i + 1; j < events.length; j++) {
      if (assigned.has(j)) continue;

      if (sameTimeSlot(events[i], events[j], timeThresholdMinutes) &&
          titlesMatch(events[i].title, events[j].title)) {
        group.push(events[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  // From each group, pick the best event
  const deduplicated = [];
  const removed = [];

  for (const group of groups) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
      continue;
    }

    // Sort by preference score (highest first)
    group.sort((a, b) => scoreEventPreference(b) - scoreEventPreference(a));

    const best = group[0];
    deduplicated.push(best);

    // Track removed events
    for (let k = 1; k < group.length; k++) {
      removed.push(group[k]);
    }

    if (log) {
      const kept = `"${best.title?.slice(0, 50)}" @ ${best.venue_name || best.venue || '?'}`;
      const dropped = group.slice(1).map(e =>
        `"${e.title?.slice(0, 50)}" @ ${e.venue_name || e.venue || '?'}`
      ).join(', ');
      const msg = `[DEDUP] Merged ${group.length} variants → kept ${kept} | dropped ${dropped}`;
      mergeLog.push(msg);
      console.log(msg);
    }
  }

  return { deduplicated, removed, mergeLog };
}
