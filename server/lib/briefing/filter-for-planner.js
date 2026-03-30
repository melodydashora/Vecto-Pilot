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
    // Get start and end dates (support multiple field names)
    const startDate = c.start_date || c.startDate || c.closure_date || c.date;
    const endDate = c.end_date || c.endDate || c.reopening_date || startDate;

    // If no dates at all, exclude
    if (!startDate) return false;

    // Check: TODAY >= start_date AND TODAY <= end_date (inclusive)
    return today >= startDate && today <= endDate;
  });
}

/**
 * Filter briefing data for venue planner consumption
 *
 * Reduces token usage by:
 * - Filtering events to today only (+ market-wide events from region)
 * - Summarizing traffic (briefing + top issues + avoid areas)
 * - Including only essential weather info
 * - Filtering school closures to today
 *
 * @param {Object} briefing - Full briefing row from database
 * @param {Object} snapshot - Snapshot with location context
 * @returns {Object} Filtered briefing for venue planner
 */
export function filterBriefingForPlanner(briefing, snapshot) {
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

  // Parse events - handle both array and {items: []} format
  const rawEvents = briefing.events;
  const eventItems = Array.isArray(rawEvents) ? rawEvents : (rawEvents?.items || []);

  // Filter events for planner
  const filteredEvents = filterEventsForPlanner(eventItems, {
    today,
    userCity,
    userState
  });

  // Log filtering results
  const totalEvents = eventItems.length;
  const keptEvents = filteredEvents.length;
  if (totalEvents > 0) {
    const largeEvents = filteredEvents.filter(e => isLargeEvent(e)).length;
    const localEvents = keptEvents - largeEvents;
    briefingLog.phase(2, `[Filter] Events: ${totalEvents} → ${keptEvents} (${largeEvents} large, ${localEvents} local for ${userCity})`);
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
  if (filteredBriefing.events && filteredBriefing.events.length > 0) {
    const eventLines = filteredBriefing.events.slice(0, 10).map(e => {
      const time = e.event_start_time || e.time || '';
      const venue = e.venue_name || e.venue || '';
      return `- ${e.title} at ${venue} (${time})`;
    });
    sections.push(`TODAY'S EVENTS (prioritize venues near these):\n${eventLines.join('\n')}`);
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
