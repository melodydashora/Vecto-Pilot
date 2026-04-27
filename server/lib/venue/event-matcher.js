// server/lib/venue/event-matcher.js
// ============================================================================
// EVENT MATCHER — Venue ↔ Discovered Events Alignment
// ============================================================================
//
// 2026-04-27 (Commit 3 of CLEAR_CONSOLE_WORKFLOW spec): per-match lines demoted
// to debug. Set LOG_VERBOSE_COMPONENTS=VENUES to see them again.
import { createWorkflowLogger } from '../../logger/workflow.js';
const matcherLog = createWorkflowLogger('VENUES');
//
// PURPOSE: Given a list of venues (from enrichVenues) and a list of today's
//          discovered events (pre-fetched by caller with venue_catalog join),
//          produce a Map<venueName, matchedEvents> using strong identity keys.
//
// 2026-04-11: Rewrote matching logic to use strong identity keys
//   (place_id → venue_id → name fallback) and removed the internal DB query.
//
//   The previous implementation (address string matching + per-call DB fetch)
//   had three stacked bugs:
//     1. Fragile address matching: addressesMatchStrictly required exact street-
//        number + street-name equality across two independently-sourced Google
//        address strings. Formatting drift (e.g., "...TX 76011" vs
//        "...TX 76011, USA") caused false negatives.
//     2. City-scoped DB query dropped metro-wide events — same bug we fixed in
//        briefing-service.js and briefing.js during the 2026-04-11 address
//        correctness work. A Dallas driver would never see a match for an
//        event at Globe Life Field in Arlington.
//     3. Pipeline ordering made the strong venue_id key unusable: matching ran
//        before catalog promotion, so neither side had a shared venue_id.
//
//   The fix uses place_id as the primary key (both sides call the same Google
//   Places API (New), so place_id is a stable identity), falls back to
//   venue_id (available after catalog promotion), and finally to substantial
//   name matching for venues without Google identity. DB fetching is moved
//   up to the caller (enhanced-smart-blocks.js :: fetchTodayDiscoveredEventsWithVenue),
//   which uses a state-scoped query with a venue_catalog left-join.
//
// CALLED BY: enhanced-smart-blocks.js (after enrichVenues, before catalog promotion)
//
// INPUT:
//   - venues:      Array of enriched venues from enrichVenues().
//                  Each has .name, .placeId, .lat, .lng (plus other enrichment fields).
//                  venue_id is NOT yet available at this call site — it's assigned
//                  in the subsequent promoteToVenueCatalog step. Primary match is place_id.
//   - todayEvents: Array of state-scoped discovered_events with venue_catalog
//                  left-join, produced by fetchTodayDiscoveredEventsWithVenue in
//                  enhanced-smart-blocks.js. Each row has discovered_events fields
//                  PLUS vc_* prefixed venue_catalog fields (vc_place_id, vc_venue_name,
//                  vc_address, vc_city, vc_lat, vc_lng).
//
// OUTPUT:
//   - Map<string venueName, Array<EventMatch>>
//     where EventMatch = { title, venue_name, event_start_time,
//                          event_end_time, category, expected_attendance }
//   The shape is preserved from the old API so enhanced-smart-blocks.js's
//   candidate-assembly code (which reads venue_events[0].title for badges)
//   does not need to change.
//
// ============================================================================

/**
 * Normalize a venue name for fuzzy matching.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Substantial name match. Exact equality, or containment where the contained
 * side is at least 50% of the container length. This prevents "Majestic"
 * (8 chars) from matching "Majestic Theatre" (16 chars) as a substring
 * — that would be too loose — while still matching "The Majestic Theatre"
 * against "Majestic Theatre" (contained side is ~80% of container).
 *
 * @param {string} name1
 * @param {string} name2
 * @returns {boolean}
 */
function venueNamesMatch(name1, name2) {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  if (n1.includes(n2) && n2.length >= n1.length * 0.5) return true;
  if (n2.includes(n1) && n1.length >= n2.length * 0.5) return true;
  return false;
}

/**
 * Build an EventMatch object from a discovered_events row. Preserves the
 * shape that enhanced-smart-blocks.js expects for ranking_candidates.venue_events[].
 *
 * Prefers venue_catalog canonical name (vc_venue_name) when joined, since
 * the catalog name is the authoritative display form after Places API
 * resolution. Falls back to discovered_events.venue_name for orphan events
 * (null venue_id, no join row).
 *
 * @param {Object} event - Row from fetchTodayDiscoveredEventsWithVenue
 * @returns {Object} EventMatch
 */
function toEventMatch(event) {
  return {
    title: event.title,
    venue_name: event.vc_venue_name || event.venue_name,
    event_start_time: event.event_start_time,
    event_end_time: event.event_end_time,
    category: event.category,
    expected_attendance: event.expected_attendance
  };
}

/**
 * Match enriched venues against pre-fetched discovered events using strong
 * identity keys.
 *
 * Match priority (highest → lowest):
 *   1. place_id: venue.placeId === event.vc_place_id
 *      Both sides Google-sourced — most reliable. This is the primary key at
 *      the current call site because venue.placeId is set by enrichVenues
 *      and event.vc_place_id is set by the venue_catalog join.
 *
 *   2. venue_id: venue.venue_id === event.venue_id
 *      Available only after catalog promotion. At the current call site this
 *      branch is dormant (venue.venue_id not yet set) but kept as a defensive
 *      check for any future callers that match post-promotion.
 *
 *   3. name match: venueNamesMatch(venue.name, event.vc_venue_name || event.venue_name)
 *      Tertiary fallback for venues lacking a Google place_id (rare) or for
 *      legacy rows where place_id was never populated.
 *
 * @param {Array<Object>} venues - Enriched venues from enrichVenues()
 * @param {Array<Object>} todayEvents - State-scoped discovered_events with venue_catalog join
 * @returns {Map<string, Array<Object>>} Map keyed by venue.name
 */
export function matchVenuesToEvents(venues, todayEvents) {
  if (!venues?.length || !todayEvents?.length) {
    return new Map();
  }

  const matchMap = new Map();

  for (const venue of venues) {
    const matches = [];

    for (const event of todayEvents) {
      let matchType = null;

      // Primary: place_id (Google Places API identity on both sides)
      if (venue.placeId && event.vc_place_id && venue.placeId === event.vc_place_id) {
        matchType = 'place_id';
      }
      // Secondary: venue_id (both in venue_catalog — dormant at current call site)
      else if (venue.venue_id && event.venue_id && venue.venue_id === event.venue_id) {
        matchType = 'venue_id';
      }
      // Tertiary: substantial name match against catalog name or discovered name
      else if (venueNamesMatch(venue.name, event.vc_venue_name || event.venue_name)) {
        matchType = 'name';
      }

      if (matchType) {
        matches.push(toEventMatch(event));
        matcherLog.debug(`MATCH (${matchType}): "${venue.name}" <-> "${event.title}"`);
      }
    }

    if (matches.length > 0) {
      matchMap.set(venue.name, matches);
    }
  }

  if (matchMap.size === 0) {
    matcherLog.debug(`No matches for ${venues.length} venues against ${todayEvents.length} events`);
  } else {
    matcherLog.debug(`Matched ${matchMap.size}/${venues.length} venues to events`);
  }

  return matchMap;
}
