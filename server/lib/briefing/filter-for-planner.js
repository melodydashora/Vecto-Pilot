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
// FILTERING RULES (2026-06-11: event city/state split removed — see below):
//   - Events: pass through the pre-fetched state-scoped todayEvents array as-is.
//       Scope (state-wide + active-today + multi-day window) is already applied by the
//       DB query (fetchTodayDiscoveredEventsWithVenue); this layer only buckets NEAR/FAR
//       (15-mile rule) at prompt-format time in formatBriefingForPrompt.
//   - Traffic: Summary only (briefing, keyIssues, avoidAreas)
//   - Weather: Current conditions and driver impact
//   - School closures: Today only
//
// CALLED BY: enhanced-smart-blocks.js before calling tactical-planner.js
//
// ============================================================================

import { briefingLog } from '../../logger/workflow.js';

// 2026-06-11: Removed LARGE_EVENT_INDICATORS / LARGE_EVENT_CATEGORIES — their only
// consumers were the now-deleted isLargeEvent + filterEventsForPlanner (memory #258).
// Large-event market-wide scoping lives in the DB query (state-scoped
// fetchTodayDiscoveredEventsWithVenue) per FR-PROD-002, not in this prompt-shaping layer.

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

// 2026-06-11: Removed isLargeEvent + filterEventsForPlanner (dead since 2026-04-28,
// memory #258). filterBriefingForPlanner now passes pre-fetched state-scoped todayEvents
// straight through (and throws TypeError if they are missing), so the city/state split
// these performed is unreachable. Confirmed zero importers by reading every caller
// (enhanced-smart-blocks.js, tactical-planner.js, schools.js) and grepping tests/.

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
 * - Passing through pre-fetched state-scoped events (the only event source path)
 * - Summarizing traffic (briefing + top issues + avoid areas)
 * - Including only essential weather info
 * - Filtering school closures to today
 *
 * 2026-04-11: Added `todayEvents` parameter. State-scoped events with venue_catalog
 * join are pre-fetched by the Smart Blocks pipeline (enhanced-smart-blocks.js ::
 * fetchTodayDiscoveredEventsWithVenue) before calling this function.
 *
 * 2026-04-28: `todayEvents` is now REQUIRED (must be an array). The legacy
 * fallback to briefing.events with a city/state split (the since-deleted
 * filterEventsForPlanner, removed 2026-06-11) was deleted. That fallback violated
 * FR-PROD-002 by silently substituting a
 * city filter for the spec's state-scoped event contract — it dropped metro-wide
 * events whose Google-Places-resolved city differed from the driver's snapshot
 * city. All live callers pre-fetch and pass todayEvents; this validation surfaces
 * any unmigrated caller as a clear TypeError instead of a silent narrower scope.
 *
 * @param {Object} briefing - Full briefing row from database
 * @param {Object} snapshot - Snapshot with location context
 * @param {Array} todayEvents - REQUIRED. Pre-fetched state-scoped events with
 *   venue_catalog join. Expected shape: array of objects with discovered_events
 *   fields + vc_* prefixed venue_catalog fields. Throws TypeError if not an array.
 * @returns {Object} Filtered briefing for venue planner
 */
export function filterBriefingForPlanner(briefing, snapshot, todayEvents) {
  if (!briefing || !snapshot) {
    return {
      events: [],
      traffic: null,
      weather: null,
      airport: null,
      schoolClosures: []
    };
  }

  // 2026-04-28: Hard contract — caller MUST supply todayEvents as an array. The
  // legacy fallback that silently re-derived events from briefing.events with a
  // city/state filter was deleted (it violated FR-PROD-002 by narrowing scope
  // from state-wide to city-only without notifying the caller). This throw makes
  // any unmigrated caller fail loudly at the contract boundary instead of
  // returning a silently narrower event set.
  if (!Array.isArray(todayEvents)) {
    throw new TypeError(
      `filterBriefingForPlanner: todayEvents must be an array (got ${typeof todayEvents}). ` +
      `Live callers pre-fetch state-scoped events via fetchTodayDiscoveredEventsWithVenue ` +
      `before calling this function. The legacy fallback was deleted on 2026-04-28; see ` +
      `docs/review-queue/PLAN_pr-review-master-fixes-2026-04-28.md §13-P1.`
    );
  }

  const today = getLocalDate(snapshot.timezone);
  const userCity = snapshot.city || '';
  const userState = snapshot.state || '';

  // 2026-04-11: Pre-fetched state-scoped events flow through without further
  // filtering — the DB query already applied state + active + multi-day window.
  // 2026-04-28: This is now the ONLY path; the legacy else branch that handled
  // !Array.isArray(todayEvents) was deleted, replaced by the throw above.
  const filteredEvents = todayEvents;
  if (filteredEvents.length > 0) {
    console.log(`[BRIEFING] [EVENTS] [DB] [discovered_events] [FILTER] caller pre-fetched events at state scope, passing through to planner without further filtering: ${filteredEvents.length} events`);
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
    temperature: weatherData.temperature ?? weatherData.temp ?? null,
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
  filterClosuresToToday,
  getLocalDate
};
