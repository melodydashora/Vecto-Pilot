// server/lib/briefing/filter-for-planner.js
// ============================================================================
// BRIEFING FILTER FOR VENUE PLANNER
// ============================================================================
//
// PURPOSE: Reduce token usage in venue planner by filtering briefing data
// to only include relevant information for venue recommendations.
//
// 2026-01-31: Created as part of data pipeline restructure
// Problem: Venue Planner receives ALL briefing data (stale events, full traffic)
// Solution: Filter to today's events + summarized traffic + weather + airport
//
// FILTERING RULES:
//   - Large market-wide events (stadiums, arenas): Keep from entire market
//   - Small local events (bars, clubs): Only if in user's city
//   - Traffic: Summary only (briefing, keyIssues, avoidAreas)
//   - Weather: Current conditions and driver impact
//   - School closures: Today only
//
// CALLED BY: enhanced-smart-blocks.js before calling tactical-planner.js
//
// ============================================================================

import { briefingLog } from '../../logger/workflow.js';

/**
 * Large event indicators - venues/keywords that suggest market-wide impact
 * These events affect traffic and demand across the entire metro area
 */
const LARGE_EVENT_INDICATORS = [
  'stadium', 'arena', 'coliseum', 'amphitheater', 'amphitheatre',
  'convention center', 'convention centre', 'expo center',
  'nfl', 'nba', 'mlb', 'nhl', 'mls', 'college football',
  'concert tour', 'world tour', 'national tour'
];

/**
 * Categories that are typically large market-wide events
 */
const LARGE_EVENT_CATEGORIES = ['sports', 'concert'];

/**
 * Get today's date in the snapshot's timezone (YYYY-MM-DD format)
 *
 * @param {string} timezone - IANA timezone string
 * @returns {string} Date in YYYY-MM-DD format
 */
function getLocalDate(timezone) {
  if (!timezone) {
    // Fallback to UTC if no timezone - should not happen in production
    return new Date().toISOString().split('T')[0];
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * Check if an event is a "large" market-wide event that affects the entire metro
 *
 * Large events include:
 * - Stadium/arena events (concerts, sports)
 * - Convention center events
 * - Major league sports (NFL, NBA, MLB, etc.)
 * - Large concert tours
 *
 * @param {Object} event - Event object with title, venue_name, category, expected_crowd
 * @returns {boolean} True if this is a large market-wide event
 */
function isLargeEvent(event) {
  const venueName = (event.venue_name || event.venue || '').toLowerCase();
  const title = (event.title || '').toLowerCase();
  const category = (event.category || event.event_type || '').toLowerCase();
  const expectedCrowd = (event.expected_crowd || '').toLowerCase();

  // Check if category indicates large event
  if (LARGE_EVENT_CATEGORIES.includes(category)) {
    return true;
  }

  // Check if venue name contains large venue indicators
  if (LARGE_EVENT_INDICATORS.some(indicator => venueName.includes(indicator))) {
    return true;
  }

  // Check if title contains large event indicators
  if (LARGE_EVENT_INDICATORS.some(indicator => title.includes(indicator))) {
    return true;
  }

  // Check if expected crowd is high
  if (expectedCrowd === 'high') {
    return true;
  }

  return false;
}

/**
 * Filter events for venue planner:
 * - KEEP: Large events (stadiums, arenas, major concerts) from entire market (same state)
 * - FILTER: Small events to user's city only
 * - FILTER: Only today's events
 *
 * @param {Array} events - Array of event objects
 * @param {Object} options - Filter options
 * @param {string} options.today - Today's date in YYYY-MM-DD format
 * @param {string} options.userCity - User's current city
 * @param {string} options.userState - User's current state
 * @returns {Array} Filtered events for venue planner
 */
function filterEventsForPlanner(events, { today, userCity, userState }) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return [];
  }

  const filtered = events.filter(event => {
    // Get event date - support multiple field names
    const eventDate = event.event_start_date || event.event_date || event.date;

    // Must be today
    if (eventDate !== today) {
      return false;
    }

    // Check if this is a large market-wide event
    const isLarge = isLargeEvent(event);

    // Large events: keep from entire market (same state)
    if (isLarge) {
      const eventState = event.state || '';
      // Keep if same state (market-wide relevance)
      return eventState.toLowerCase() === (userState || '').toLowerCase();
    }

    // Small events: only keep if in user's city
    const eventCity = event.city || '';
    return eventCity.toLowerCase() === (userCity || '').toLowerCase();
  });

  return filtered;
}

/**
 * Filter school closures to only those active today
 * Reuses logic from consolidator.js filterClosuresActiveToday
 *
 * @param {Array} closures - Array of closure objects
 * @param {string} today - Today's date in YYYY-MM-DD format
 * @returns {Array} Closures active today
 */
function filterClosuresToToday(closures, today) {
  if (!closures || !Array.isArray(closures) || closures.length === 0) {
    return [];
  }

  return closures.filter(c => {
    // 2026-04-16: Support both snake_case (normalized) and camelCase (legacy DB rows).
    // New data is normalized at ingestion in fetchSchoolClosures(); this covers older rows.
    const startDate = c.start_date || c.closureStart || c.startDate || c.closure_date || c.date;
    const endDate = c.end_date || c.reopeningDate || c.endDate || c.reopening_date || startDate;

    if (!startDate) return false;

    // Check: TODAY >= start_date AND TODAY <= end_date (inclusive)
    return today >= startDate && today <= endDate;
  });
}

/**
 * Filter briefing data for venue planner consumption
 *
 * Reduces token usage by:
 * - Using pre-fetched state-scoped events (preferred) or falling back to briefing.events
 * - Summarizing traffic (briefing + top issues + avoid areas)
 * - Including only essential weather info
 * - Filtering school closures to today
 *
 * 2026-04-11: Added `todayEvents` parameter. When provided, it is used directly
 * as the event set (no further filtering). This is the source of truth for the
 * Smart Blocks pipeline, which fetches state-scoped discovered_events with a
 * venue_catalog join *before* calling this function. The legacy `briefing.events`
 * fallback is kept for callers that haven't been migrated.
 *
 * The 2026-01-31 city/state split (`isLargeEvent` branching) is deprecated. After
 * the 2026-04-11 venue address correctness work, events carry their *venue's*
 * city (Arlington, Fort Worth, Frisco) rather than the driver's snapshot city, so
 * the city-match branch dropped metro-wide events that were legitimately driver-
 * relevant. The Smart Blocks pipeline now state-scopes at the DB query level
 * instead — see enhanced-smart-blocks.js :: fetchTodayDiscoveredEventsWithVenue.
 *
 * @param {Object} briefing - Full briefing row from database
 * @param {Object} snapshot - Snapshot with location context
 * @param {Array} [todayEvents] - Pre-fetched state-scoped events with venue_catalog join.
 *   When provided, replaces briefing.events as the event source. Expected shape: array of
 *   objects with discovered_events fields + vc_* prefixed venue_catalog fields.
 * @returns {Object} Filtered briefing for venue planner
 */
export function filterBriefingForPlanner(briefing, snapshot, todayEvents = null) {
  if (!briefing || !snapshot) {
    return {
      events: [],
      traffic: null,
      weather: null,
      airport: null,
      schoolClosures: []
    };
  }

  const today = getLocalDate(snapshot.timezone);
  const userCity = snapshot.city || '';
  const userState = snapshot.state || '';

  // 2026-04-11: Prefer pre-fetched state-scoped events when caller provides them.
  // Legacy path: fall back to briefing.events (city-scoped filter kept only for
  // the unmigrated call path — no known live callers remain).
  let filteredEvents;
  if (Array.isArray(todayEvents)) {
    filteredEvents = todayEvents;
    if (filteredEvents.length > 0) {
      briefingLog.phase(2, `[EVENTS] [FILTER] State-scoped: ${filteredEvents.length} pre-fetched`);
    }
  } else {
    // Legacy path — kept for backward compatibility. See filterEventsForPlanner for the
    // deprecated city/state split logic.
    const rawEvents = briefing.events;
    const eventItems = Array.isArray(rawEvents) ? rawEvents : (rawEvents?.items || []);
    filteredEvents = filterEventsForPlanner(eventItems, { today, userCity, userState });

    const totalEvents = eventItems.length;
    const keptEvents = filteredEvents.length;
    if (totalEvents > 0) {
      const largeEvents = filteredEvents.filter(e => isLargeEvent(e)).length;
      const localEvents = keptEvents - largeEvents;
      briefingLog.phase(2, `[EVENTS] [FILTER] Legacy: ${totalEvents} → ${keptEvents} events (${largeEvents} large, ${localEvents} local for ${userCity})`);
    }
  }

  // Extract traffic summary - only essential fields
  const trafficData = briefing.traffic_conditions;
  const trafficSummary = trafficData ? {
    summary: trafficData.briefing || trafficData.summary || null,
    keyIssues: (trafficData.keyIssues || []).slice(0, 3),
    avoidAreas: (trafficData.avoidAreas || []).slice(0, 2),
    driverImpact: trafficData.driverImpact || null
  } : null;

  // Extract weather summary - only essential fields
  const weatherData = briefing.weather_current;
  const weatherSummary = weatherData ? {
    condition: weatherData.condition || weatherData.conditions || null,
    temperature: weatherData.temperature || weatherData.temp || null,
    impact: weatherData.driverImpact || weatherData.impact || null
  } : null;

  // Airport conditions - pass through (already summarized)
  const airport = briefing.airport_conditions || null;

  // Filter school closures to today
  const rawClosures = briefing.school_closures;
  const closuresArray = Array.isArray(rawClosures) ? rawClosures : (rawClosures?.items || []);
  const todayClosures = filterClosuresToToday(closuresArray, today);

  return {
    events: filteredEvents,
    traffic: trafficSummary,
    weather: weatherSummary,
    airport,
    schoolClosures: todayClosures
  };
}

/**
 * Format filtered briefing for LLM prompt inclusion
 * Creates a concise, token-efficient string representation
 *
 * @param {Object} filteredBriefing - Output from filterBriefingForPlanner
 * @returns {string} Formatted string for LLM prompt
 */
export function formatBriefingForPrompt(filteredBriefing) {
  if (!filteredBriefing) {
    return 'No briefing data available.';
  }

  const sections = [];

  // Events section
  // 2026-04-11 (REVERT — owner direction): Events are now bucketed into two lists
  // based on distance from the driver. The 15-mile rule is the supreme constraint
  // for venue recommendations — VENUE_SCORER must never recommend a venue >15mi
  // away, even if that venue has a high-impact event. But events >15mi still
  // contain valuable information about where demand surges will originate, so
  // they're kept in the prompt as SURGE FLOW INTELLIGENCE rather than discarded.
  //
  //   NEAR EVENTS (≤15mi): Candidate venues. VENUE_SCORER SHOULD recommend the
  //     event venue directly with event-specific pro_tips if the event is high
  //     impact and happening in the next 2 hours.
  //
  //   FAR EVENTS (>15mi): Surge flow intelligence. VENUE_SCORER MUST NOT recommend
  //     these as destinations. Instead, use them to reason about demand
  //     ORIGINATION: fans travel FROM hotels/residential/dining near the driver TO
  //     the far venue. Recommend venues within 15mi of driver that will benefit
  //     from that outflow (e.g., hotels near freeway on-ramps).
  //
  // Rich event format (venue name/address/coords/end time/category/attendance) is
  // preserved so the LLM has enough context for both reasoning tasks. Prefers
  // venue_catalog joined fields (vc_*) when available, falling back to
  // discovered_events fields for orphan events (null venue_id).
  if (filteredBriefing.events && filteredBriefing.events.length > 0) {
    const NEAR_EVENT_RADIUS_MILES = 15;

    const formatEvent = (e) => {
      const startTime = e.event_start_time || e.time || '';
      const endTime = e.event_end_time ? ` - ${e.event_end_time}` : '';
      // Prefer venue_catalog canonical name/address when joined, else discovered_events fields
      const venueName = e.vc_venue_name || e.venue_name || e.venue || '';
      const address = e.vc_address || e.vc_formatted_address || e.address || '';
      // Coordinates: only from venue_catalog join (discovered_events has no lat/lng)
      const hasCoords = e.vc_lat != null && e.vc_lng != null;
      const coords = hasCoords ? ` [${Number(e.vc_lat).toFixed(6)}, ${Number(e.vc_lng).toFixed(6)}]` : '';
      const category = e.category ? ` (${e.category})` : '';
      const attendance = e.expected_attendance && e.expected_attendance !== 'medium'
        ? ` [${e.expected_attendance} attendance]`
        : '';
      // Distance from driver, if attached by fetchTodayDiscoveredEventsWithVenue
      const distance = e._distanceMiles != null && Number.isFinite(e._distanceMiles)
        ? ` — ${e._distanceMiles.toFixed(1)} mi from driver`
        : '';

      // Multi-line format so VENUE_SCORER can parse the structure reliably
      return [
        `- ${e.title}${category}${attendance}${distance}`,
        `  Venue: ${venueName}${coords}`,
        address ? `  Address: ${address}` : null,
        `  Time: ${startTime}${endTime}`
      ].filter(Boolean).join('\n');
    };

    // Bucket by distance. Events without _distanceMiles (no driver coords passed)
    // fall into an "unbucketed" list and render with a neutral header.
    const eventsWithDistance = filteredBriefing.events.filter(
      e => e._distanceMiles != null && Number.isFinite(e._distanceMiles)
    );
    const eventsWithoutDistance = filteredBriefing.events.filter(
      e => e._distanceMiles == null || !Number.isFinite(e._distanceMiles)
    );
    const nearEvents = eventsWithDistance.filter(
      e => e._distanceMiles <= NEAR_EVENT_RADIUS_MILES
    );
    const farEvents = eventsWithDistance.filter(
      e => e._distanceMiles > NEAR_EVENT_RADIUS_MILES
    );

    const eventBlocks = [];

    if (nearEvents.length > 0) {
      const nearLines = nearEvents.slice(0, 6).map(formatEvent).join('\n');
      eventBlocks.push(
        `NEAR EVENTS (within ${NEAR_EVENT_RADIUS_MILES} mi of driver — CANDIDATE VENUES):\n` +
        `If an event below is high-impact and starting/ending within the next 2 hours, ` +
        `recommend the event venue directly with event-specific pro_tips (pickup surge ` +
        `timing, post-show staging). Use the exact coordinates shown.\n${nearLines}`
      );
    }

    if (farEvents.length > 0) {
      const farLines = farEvents.slice(0, 8).map(formatEvent).join('\n');
      eventBlocks.push(
        `FAR EVENTS (beyond ${NEAR_EVENT_RADIUS_MILES} mi — SURGE FLOW INTELLIGENCE, NOT destinations):\n` +
        `DO NOT recommend these venues — they violate the 15-mile rule. Instead, use them to ` +
        `reason about where demand will ORIGINATE: fans travel FROM hotels, residential ` +
        `areas, and dining clusters NEAR the driver TO these far venues. That outflow creates ` +
        `pickup demand within 15 mi of the driver, not at the event. Recommend the closest ` +
        `high-impact venues within 15 mi (hotels near freeway on-ramps, dining hubs, residential ` +
        `centers) that fans would depart from on their way to the event.\n${farLines}`
      );
    }

    if (eventsWithoutDistance.length > 0) {
      // Unbucketed fallback — caller did not annotate _distanceMiles. Render flat
      // with a neutral header; VENUE_SCORER's 15-mile rule still applies.
      const unbucketedLines = eventsWithoutDistance.slice(0, 8).map(formatEvent).join('\n');
      eventBlocks.push(
        `TODAY'S EVENTS (distance not annotated — 15-mile rule still applies):\n${unbucketedLines}`
      );
    }

    if (eventBlocks.length > 0) {
      sections.push(eventBlocks.join('\n\n'));
    } else {
      sections.push('TODAY\'S EVENTS: None with driver impact');
    }
  } else {
    sections.push('TODAY\'S EVENTS: None with driver impact');
  }

  // Traffic section
  if (filteredBriefing.traffic) {
    const trafficParts = [];
    if (filteredBriefing.traffic.summary) {
      trafficParts.push(filteredBriefing.traffic.summary);
    }
    if (filteredBriefing.traffic.avoidAreas && filteredBriefing.traffic.avoidAreas.length > 0) {
      trafficParts.push(`Avoid: ${filteredBriefing.traffic.avoidAreas.join(', ')}`);
    }
    sections.push(`TRAFFIC:\n${trafficParts.join('\n') || 'Normal conditions'}`);
  }

  // Weather section
  if (filteredBriefing.weather && filteredBriefing.weather.condition) {
    const weatherInfo = `${filteredBriefing.weather.condition}${filteredBriefing.weather.temperature ? `, ${filteredBriefing.weather.temperature}` : ''}`;
    sections.push(`WEATHER: ${weatherInfo}`);
  }

  // Airport section
  if (filteredBriefing.airport) {
    const airportInfo = typeof filteredBriefing.airport === 'string'
      ? filteredBriefing.airport
      : (filteredBriefing.airport.summary || 'Normal operations');
    sections.push(`AIRPORT: ${airportInfo}`);
  }

  // School closures section
  if (filteredBriefing.schoolClosures && filteredBriefing.schoolClosures.length > 0) {
    const closureNames = filteredBriefing.schoolClosures.slice(0, 5).map(c =>
      c.schoolName || c.name || c.district || 'School'
    );
    sections.push(`SCHOOL CLOSURES TODAY: ${closureNames.join(', ')}`);
  }

  return sections.join('\n\n');
}

export default {
  filterBriefingForPlanner,
  formatBriefingForPrompt,
  // Export for testing
  filterEventsForPlanner,
  filterClosuresToToday,
  isLargeEvent,
  getLocalDate
};
