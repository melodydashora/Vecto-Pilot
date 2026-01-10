// server/lib/strategy-utils.js
// Strategy-first gating utilities

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { triadLog, OP } from '../../logger/workflow.js';

/**
 * CRITICAL: Create strategy row with snapshot location data
 * This ensures providers have a row to write to
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<void>}
 */
export async function ensureStrategyRow(snapshotId) {
  try {
    // Check if strategy row already exists
    const [existing] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);
    
    if (existing) {
      return; // Row already exists
    }
    
    // Fetch snapshot to get location data
    const { snapshots } = await import('../../../shared/schema.js');
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);
    
    if (!snapshot) {
      triadLog.warn(1, `Snapshot ${snapshotId.slice(0, 8)} not found`);
      return;
    }

    // Create strategy row with location data from snapshot
    // CRITICAL: Explicitly set phase='starting' - don't rely on SQL defaults
    // PostgreSQL + Drizzle + onConflictDoNothing can leave phase as NULL otherwise
    await db.insert(strategies).values({
      snapshot_id: snapshotId,
      user_id: snapshot.user_id,
      lat: snapshot.lat,
      lng: snapshot.lng,
      city: snapshot.city,
      state: snapshot.state,
      user_address: snapshot.formatted_address,
      status: 'pending',
      phase: 'starting'
    }).onConflictDoNothing();

    triadLog.done(1, `Strategy row created: ${snapshot.city}, ${snapshot.state}`, OP.DB);
  } catch (error) {
    triadLog.error(1, `ensureStrategyRow failed`, error, OP.DB);
  }
}

/**
 * Check if consolidated strategy is ready for a snapshot
 * Used by blocks-fast to gate rendering until strategy exists
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{ready: boolean, strategy?: string}>}
 */
export async function isStrategyReady(snapshotId) {
  if (!snapshotId) {
    return { ready: false };
  }

  try {
    const [strategyRow] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    if (!strategyRow) {
      return { ready: false };
    }

    // Ready when strategy_for_now exists (immediate 1-hour tactical strategy)
    // NOTE: consolidated_strategy is the "daily" strategy generated on-demand
    // The pipeline generates strategy_for_now first, then blocks
    const ready = Boolean(strategyRow.strategy_for_now);

    return {
      ready,
      strategy: strategyRow.strategy_for_now,
      status: strategyRow.status
    };
  } catch (error) {
    console.error('[isStrategyReady] Error:', error);
    return { ready: false, error: error.message };
  }
}

/**
 * Get strategy context for venue/event planners
 * Returns all fields needed by planners
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{snapshot, strategy, ready: boolean}>}
 */
export async function getStrategyContext(snapshotId) {
  const { ready, strategy, status } = await isStrategyReady(snapshotId);
  
  if (!ready) {
    return { ready: false, strategy: null, snapshot: null };
  }

  // Fetch snapshot with full context
  const { snapshots } = await import('../../../shared/schema.js');
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId))
    .limit(1);

  return {
    ready: true,
    strategy,
    status,
    snapshot,
    // Planner inputs
    inputs: {
      snapshot_id: snapshotId,
      user_address: snapshot?.formatted_address,
      city: snapshot?.city,
      state: snapshot?.state,
      lat: snapshot?.lat,
      lng: snapshot?.lng,
      timezone: snapshot?.timezone,
      strategy_text: strategy
    }
  };
}

// NOTE: synthesizeFallback function REMOVED Dec 2025 - dead code
// The active pipeline uses runImmediateStrategy from consolidator.js which has its own error handling

/**
 * Compress text to fit within token limits
 * @param {string} text - Text to compress
 * @param {number} maxLength - Maximum character length
 * @returns {string} - Compressed text
 */
export function compressText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

/**
 * Check if briefing has renderable content (not just an empty object)
 * @param {Object} briefing - Briefing data {events, traffic_conditions, news, weather_current, school_closures}
 * @returns {boolean} - True if briefing has at least one populated field
 */
export function hasRenderableBriefing(briefing) {
  if (!briefing || typeof briefing !== 'object') return false;

  const { events, traffic_conditions, news, weather_current, school_closures } = briefing;

  // Check if any field has meaningful content
  const hasEvents = Array.isArray(events) ? events.length > 0 : (events?.items?.length > 0);
  const hasNews = news?.items?.length > 0;
  const hasTraffic = traffic_conditions && typeof traffic_conditions === 'object' && Object.keys(traffic_conditions).length > 0;
  const hasWeather = weather_current && typeof weather_current === 'object' && Object.keys(weather_current).length > 0;
  const hasClosures = Array.isArray(school_closures) ? school_closures.length > 0 : (school_closures?.items?.length > 0);

  return hasEvents || hasNews || hasTraffic || hasWeather || hasClosures;
}

/**
 * Normalize briefing to ensure consistent shape
 * Guarantees all fields are arrays/objects even if input is malformed
 * @param {any} briefing - Raw briefing data
 * @returns {Object} - Normalized briefing with guaranteed shape
 */
export function normalizeBriefingShape(briefing) {
  return {
    events: Array.isArray(briefing?.events) ? briefing.events : [],
    holidays: Array.isArray(briefing?.holidays) ? briefing.holidays : [],
    news: Array.isArray(briefing?.news) ? briefing.news : [],
    traffic: Array.isArray(briefing?.traffic) ? briefing.traffic : []
  };
}

// Expected duration for each phase (in milliseconds) based on actual pipeline timing (Dec 2025)
// These are used for progress calculation on the frontend
// SmartBlocks phases: venues → routing → places → verifying → complete
// Note: Overestimate slightly to avoid progress stalling at 95% within a phase
export const PHASE_EXPECTED_DURATIONS = {
  starting: 500,      // Nearly instant
  resolving: 2000,    // Location resolution
  analyzing: 25000,   // Briefing (STRATEGY_CONTEXT role + traffic analysis) - can take 20-45s
  immediate: 8000,    // STRATEGY_TACTICAL role immediate strategy (5-10s)
  venues: 90000,      // VENUE_SCORER role tactical planner - SLOWEST (~60-90s with medium reasoning)
  routing: 2000,      // Google Routes API batch (fast)
  places: 2000,       // Event matching + Places lookup (fast)
  verifying: 1000,    // Event verification (fast when no events)
  enriching: 20000,   // Legacy fallback - all Google APIs combined
  complete: 0         // Done
};

// Total expected pipeline duration (sum of all phases)
export const TOTAL_EXPECTED_DURATION = Object.values(PHASE_EXPECTED_DURATIONS).reduce((a, b) => a + b, 0);

/**
 * Update pipeline phase for a snapshot's strategy with timing metadata
 * Strategy phases: starting → resolving → analyzing → immediate
 * SmartBlocks phases: venues → routing → places → verifying → complete
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {string} phase - Phase name
 * @param {Object} options - Optional parameters
 * @param {EventEmitter} options.phaseEmitter - Optional emitter for SSE phase_change events
 * @returns {Promise<void>}
 */
export async function updatePhase(snapshotId, phase, options = {}) {
  try {
    const now = new Date();

    const result = await db.update(strategies)
      .set({
        phase,
        phase_started_at: now  // Track when this phase started
      })
      .where(eq(strategies.snapshot_id, snapshotId));

    // Log phase transition with confirmation
    console.log(`[PHASE-UPDATE] ${snapshotId.slice(0, 8)} → ${phase} (updated at ${now.toISOString()})`);

    // Map phase to TRIAD type for clearer logging
    const triadType = ['immediate', 'resolving', 'analyzing'].includes(phase) ? 'Strategy' :
                      ['venues', 'routing', 'places', 'verifying', 'enriching'].includes(phase) ? 'Venue' : 'Pipeline';
    triadLog.info(`[strategy-utils] ${triadType}|${snapshotId.slice(0, 8)} → ${phase}`, OP.DB);

    // Emit phase_change SSE event if emitter provided
    if (options.phaseEmitter) {
      options.phaseEmitter.emit('change', {
        snapshot_id: snapshotId,
        phase,
        phase_started_at: now.toISOString(),
        expected_duration_ms: PHASE_EXPECTED_DURATIONS[phase] || 5000
      });
    }
  } catch (error) {
    triadLog.error(1, `Phase update failed`, error, OP.DB);
  }
}

/**
 * Get phase timing info for a snapshot
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{phase: string, phase_started_at: Date|null, pipeline_started_at: Date|null}>}
 */
export async function getPhaseTimingInfo(snapshotId) {
  try {
    const [row] = await db.select({
      phase: strategies.phase,
      phase_started_at: strategies.phase_started_at,
      created_at: strategies.created_at
    }).from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    return {
      phase: row?.phase || 'starting',
      phase_started_at: row?.phase_started_at || null,
      pipeline_started_at: row?.created_at || null
    };
  } catch (error) {
    triadLog.error(1, `getPhaseTimingInfo failed`, error);
    return { phase: 'starting', phase_started_at: null, pipeline_started_at: null };
  }
}

// ============================================================================
// EVENT FRESHNESS FILTERING
// Added 2026-01-05: Filter stale events from briefing data
// Events must have date/time info and must not have ended yet
// ============================================================================

/**
 * Extract end time from event object (handles multiple field naming conventions)
 *
 * 2026-01-06: Fixed timezone handling for discovered_events format.
 * Events store event_end_date ("2026-01-06") + event_end_time ("10:00 PM") separately.
 * Must combine and parse with timezone, otherwise "2026-01-06" becomes midnight UTC
 * which is 6PM previous day in Central Time - marking events as stale incorrectly.
 *
 * @param {Object} event - Event object
 * @param {string} timezone - IANA timezone like "America/Chicago" (optional)
 * @returns {Date|null} - Parsed end time or null if not available
 */
function getEventEndTime(event, timezone = null) {
  if (!event) return null;

  // PRIORITY 1: Try ISO datetime fields first (already include time)
  const isoFields = [
    'end_time_iso',
    'endsAt',
    'ends_at',
    'end_time',
    'endTime'
  ];

  for (const field of isoFields) {
    if (event[field]) {
      const parsed = new Date(event[field]);
      if (!isNaN(parsed.getTime())) {
        // Verify it's a full datetime, not just a date (has time component)
        const str = String(event[field]);
        if (str.includes('T') || str.includes(':')) {
          return parsed;
        }
      }
    }
  }

  // PRIORITY 2: Combine event_end_date + event_end_time (discovered_events pattern)
  // event_end_date: "2026-01-06", event_end_time: "10:00 PM"
  if (event.event_end_date && event.event_end_time) {
    const timeParts = parseTimeString(event.event_end_time);
    if (timeParts) {
      const dateStr = event.event_end_date; // "2026-01-06"
      const [year, month, day] = dateStr.split('-').map(Number);

      // If timezone provided, use it for proper UTC conversion
      if (timezone) {
        try {
          return createDateInTimezone(year, month, day, timeParts.hours, timeParts.minutes, timezone);
        } catch (e) {
          // Fall back to server local time if timezone conversion fails
        }
      }

      // No timezone - use server local time
      const combined = new Date(year, month - 1, day, timeParts.hours, timeParts.minutes);
      if (!isNaN(combined.getTime())) {
        return combined;
      }
    }
  }

  // PRIORITY 3: event_end_date only (multi-day events) - use end of day in timezone
  // For multi-day events like "Holiday Lights Dec 1 - Jan 4", the end date means the event
  // ends at the END of that day, not at midnight (which would be start of day)
  if (event.event_end_date) {
    const dateStr = String(event.event_end_date);
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = dateStr.split('-').map(Number);

      // Use 11:59 PM in the specified timezone (end of day)
      if (timezone) {
        try {
          return createDateInTimezone(year, month, day, 23, 59, timezone);
        } catch (e) {
          // Fall back to server local time
        }
      }

      // No timezone - use server local time end of day
      const parsed = new Date(year, month - 1, day, 23, 59, 59);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  // PRIORITY 4: Single-day event - use event_start_date + event_end_time
  // Some events have event_start_date + event_start_time (start) + event_end_time (end) but no event_end_date
  // 2026-01-10: Use canonical field name only - no fallbacks
  if (event.event_start_date && event.event_end_time && !event.event_end_date) {
    const timeParts = parseTimeString(event.event_end_time);
    if (timeParts) {
      const dateStr = event.event_start_date;
      const [year, month, day] = dateStr.split('-').map(Number);

      if (timezone) {
        try {
          return createDateInTimezone(year, month, day, timeParts.hours, timeParts.minutes, timezone);
        } catch (e) {
          // Fall back
        }
      }

      const combined = new Date(year, month - 1, day, timeParts.hours, timeParts.minutes);
      if (!isNaN(combined.getTime())) {
        return combined;
      }
    }
  }

  return null;
}

/**
 * Parse a human-readable time string like "3:30 PM" into hours and minutes
 * @param {string} timeStr - Time string like "3:30 PM", "15:30", "9:00 AM"
 * @returns {{hours: number, minutes: number}|null} - Parsed time or null
 */
function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;

  const time = timeStr.trim().toUpperCase();

  // Handle 12-hour format: "3:30 PM", "9:00 AM"
  const match12 = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const isPM = match12[3] === 'PM';

    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    return { hours, minutes };
  }

  // Handle 24-hour format: "15:30", "09:00"
  const match24 = time.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return {
      hours: parseInt(match24[1], 10),
      minutes: parseInt(match24[2], 10)
    };
  }

  return null;
}

/**
 * Convert a date/time in a specific timezone to UTC Date object
 * Handles the case where server runs in UTC but events are in local timezone
 *
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 * @param {number} day - Day
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes
 * @param {string} timezone - IANA timezone like "America/Chicago"
 * @returns {Date} - Date object in UTC
 */
function createDateInTimezone(year, month, day, hours, minutes, timezone) {
  // Create ISO string with the time we want
  const pad = (n) => String(n).padStart(2, '0');
  const isoBase = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;

  // Use Intl.DateTimeFormat to figure out the UTC offset for this timezone at this date/time
  // Create a reference date to get the timezone offset
  const refDate = new Date(`${isoBase}Z`); // Start with UTC interpretation
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // Get what time it would be in the target timezone if refDate was UTC
  // Then calculate the offset
  const parts = formatter.formatToParts(refDate);
  const getPart = (type) => parts.find(p => p.type === type)?.value;

  const tzYear = parseInt(getPart('year'));
  const tzMonth = parseInt(getPart('month'));
  const tzDay = parseInt(getPart('day'));
  const tzHour = parseInt(getPart('hour'));
  const tzMinute = parseInt(getPart('minute'));

  // Calculate the offset in minutes between UTC and target timezone
  // We want: localTime = UTC + offset, so offset = localTime - UTC
  const utcMinutes = refDate.getUTCHours() * 60 + refDate.getUTCMinutes();
  const tzMinutes = tzHour * 60 + tzMinute;

  // Handle day boundary (timezone might be different day)
  let offsetMinutes = tzMinutes - utcMinutes;
  if (tzDay > refDate.getUTCDate() || (tzDay === 1 && refDate.getUTCDate() > 27)) {
    offsetMinutes += 24 * 60; // Next day in timezone
  } else if (tzDay < refDate.getUTCDate() || (refDate.getUTCDate() === 1 && tzDay > 27)) {
    offsetMinutes -= 24 * 60; // Previous day in timezone
  }

  // Now create the correct UTC time
  // We have the LOCAL time (hours, minutes) and need to convert to UTC
  // UTC = local - offset
  const localMs = new Date(year, month - 1, day, hours, minutes).getTime();
  const utcMs = localMs - (offsetMinutes * 60 * 1000);

  return new Date(utcMs);
}

/**
 * Extract start time from event object (handles multiple field naming conventions)
 *
 * 2026-01-05: Fixed critical bug where event_date "2026-01-05" was parsed as midnight UTC,
 * causing Central Time events to appear as 6 PM previous day. Now combines event_date + event_time
 * with proper timezone handling.
 *
 * @param {Object} event - Event object
 * @param {string} timezone - IANA timezone like "America/Chicago" (default: server local)
 * @returns {Date|null} - Parsed start time or null if not available
 */
function getEventStartTime(event, timezone = null) {
  if (!event) return null;

  // PRIORITY 1: Try ISO datetime fields first (already include time)
  const isoFields = [
    'start_time_iso',
    'startsAt',
    'starts_at',
    'start_time',
    'startTime'
  ];

  for (const field of isoFields) {
    if (event[field]) {
      const parsed = new Date(event[field]);
      if (!isNaN(parsed.getTime())) {
        // Verify it's a full datetime, not just a date (has time component)
        const str = String(event[field]);
        if (str.includes('T') || str.includes(':')) {
          return parsed;
        }
      }
    }
  }

  // PRIORITY 2: Combine event_start_date + event_start_time (canonical field names)
  // 2026-01-10: Use canonical field names only - no fallbacks
  if (event.event_start_date && event.event_start_time) {
    const timeParts = parseTimeString(event.event_start_time);
    if (timeParts) {
      const dateStr = event.event_start_date; // "2026-01-05"
      const [year, month, day] = dateStr.split('-').map(Number);

      // If timezone provided, use it for proper UTC conversion
      if (timezone) {
        try {
          return createDateInTimezone(year, month, day, timeParts.hours, timeParts.minutes, timezone);
        } catch (e) {
          // Fall back to server local time if timezone conversion fails
        }
      }

      // No timezone - use server local time (will be UTC on most servers)
      const combined = new Date(year, month - 1, day, timeParts.hours, timeParts.minutes);
      if (!isNaN(combined.getTime())) {
        return combined;
      }
    }
  }

  // PRIORITY 3: Fall back to date-only fields (use noon in timezone or local time)
  // 2026-01-10: Use canonical field name only - no fallbacks
  const dateFields = [
    'event_start_date',  // Canonical DB column name
    'startDate',         // ISO-style alternative
    'start_date',        // Snake case alternative
    'date'               // Generic fallback
  ];

  for (const field of dateFields) {
    if (event[field]) {
      const dateStr = String(event[field]);
      // Only use if it looks like a date (not datetime)
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateStr.split('-').map(Number);

        // Use noon in the specified timezone to avoid edge cases
        if (timezone) {
          try {
            return createDateInTimezone(year, month, day, 12, 0, timezone);
          } catch (e) {
            // Fall back to server local time
          }
        }

        const parsed = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }

  return null;
}

/**
 * Check if an event has valid date/time information
 * @param {Object} event - Event object
 * @param {string} timezone - IANA timezone (optional)
 * @returns {boolean} - True if event has at least start time
 */
function hasValidDateInfo(event, timezone = null) {
  const startTime = getEventStartTime(event, timezone);
  // Require at least a start time - we can infer end from start + duration
  return startTime !== null;
}

/**
 * Check if an event is still fresh (not yet ended)
 *
 * 2026-01-05: Added timezone parameter to properly handle events in local timezones
 * when server runs in UTC.
 *
 * @param {Object} event - Event object
 * @param {Date} now - Reference time for comparison
 * @param {string} timezone - IANA timezone like "America/Chicago" for parsing event times
 * @returns {boolean} - True if event is still active/upcoming
 */
export function isEventFresh(event, now = new Date(), timezone = null) {
  if (!event) return false;

  // 2026-01-06: Pass timezone to getEventEndTime for proper parsing of discovered_events format
  const endTime = getEventEndTime(event, timezone);

  // If we have an end time, check if event has ended
  if (endTime) {
    return endTime > now;
  }

  // If no end time, use start time + default duration (4 hours)
  const startTime = getEventStartTime(event, timezone);
  if (startTime) {
    const inferredEnd = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
    return inferredEnd > now;
  }

  // No date info at all - not fresh (reject per user requirement)
  return false;
}

/**
 * Filter events to only include fresh (not-yet-ended) events with valid dates
 * CRITICAL: Rejects events without date/time info entirely (2026-01-05)
 *
 * 2026-01-05: Added timezone parameter to properly handle events stored with local
 * times (e.g., "3:30 PM") when server runs in UTC. Pass snapshot.timezone for correct filtering.
 *
 * @param {Array} events - Array of event objects
 * @param {Date} now - Reference time for comparison (default: current time)
 * @param {string} timezone - IANA timezone like "America/Chicago" for parsing event times
 * @returns {Array} - Filtered array of fresh events
 */
export function filterFreshEvents(events, now = new Date(), timezone = null) {
  if (!Array.isArray(events)) {
    return [];
  }

  const freshEvents = [];
  let staleCount = 0;
  let noDateCount = 0;

  for (const event of events) {
    // Check for valid date info first
    if (!hasValidDateInfo(event, timezone)) {
      noDateCount++;
      continue;
    }

    // Check if event is still fresh
    if (isEventFresh(event, now, timezone)) {
      freshEvents.push(event);
    } else {
      staleCount++;
    }
  }

  // Log filtering stats if we removed events
  if (staleCount > 0 || noDateCount > 0) {
    console.log(`[filterFreshEvents] Filtered: ${staleCount} stale, ${noDateCount} missing dates (kept ${freshEvents.length}/${events.length}) tz=${timezone || 'local'}`);
  }

  return freshEvents;
}

// ============================================================================
// NEWS FRESHNESS FILTERING
// Added 2026-01-05: Filter stale news from briefing data
// News must have publication date and must be from today only
// ============================================================================

/**
 * Extract publication date from news item (handles multiple field naming conventions)
 * @param {Object} newsItem - News item object
 * @returns {Date|null} - Parsed publication date or null if not available
 */
function getNewsPublicationDate(newsItem) {
  if (!newsItem) return null;

  // Try various field names used for news publication dates
  const dateFields = [
    'published_date',
    'publishedDate',
    'pubDate',
    'pub_date',
    'publication_date',
    'date',
    'created_at',
    'createdAt'
  ];

  for (const field of dateFields) {
    if (newsItem[field]) {
      const parsed = new Date(newsItem[field]);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  return null;
}

/**
 * Check if a news item has a valid publication date
 * @param {Object} newsItem - News item object
 * @returns {boolean} - True if news item has a publication date
 */
function hasValidPublicationDate(newsItem) {
  return getNewsPublicationDate(newsItem) !== null;
}

// 2026-01-05: Changed from "today only" to "last 3 days" - yesterday's roadwork is still relevant
const NEWS_FRESHNESS_DAYS = 3;

/**
 * Check if a news item is fresh (within the last NEWS_FRESHNESS_DAYS days)
 * @param {Object} newsItem - News item object
 * @param {Date} now - Reference time for comparison
 * @param {string} timezone - Timezone for date comparison (e.g., 'America/Chicago')
 * @returns {boolean} - True if news is within freshness window
 */
export function isNewsFresh(newsItem, now = new Date(), timezone = 'UTC') {
  if (!newsItem) return false;

  const pubDate = getNewsPublicationDate(newsItem);
  if (!pubDate) return false;

  // Calculate the cutoff date (NEWS_FRESHNESS_DAYS days ago at midnight)
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - NEWS_FRESHNESS_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  return pubDate >= cutoff;
}

/**
 * @deprecated Use isNewsFresh instead - renamed for clarity
 */
export function isNewsFromToday(newsItem, now = new Date(), timezone = 'UTC') {
  return isNewsFresh(newsItem, now, timezone);
}

/**
 * Filter news to only include fresh news (last 3 days) with valid publication dates
 * 2026-01-05: Changed from "today only" to "last 3 days" - roadwork/traffic news stays relevant
 * CRITICAL: Rejects news without publication date entirely
 *
 * @param {Array} newsItems - Array of news item objects
 * @param {Date} now - Reference time for comparison (default: current time)
 * @param {string} timezone - Timezone for date comparison (default: 'UTC')
 * @returns {Array} - Filtered array of fresh news (last 3 days with valid dates)
 */
export function filterFreshNews(newsItems, now = new Date(), timezone = 'UTC') {
  if (!Array.isArray(newsItems)) {
    return [];
  }

  const freshNews = [];
  let staleCount = 0;
  let noDateCount = 0;

  for (const item of newsItems) {
    // Check for valid publication date first - REQUIRED
    if (!hasValidPublicationDate(item)) {
      noDateCount++;
      continue;
    }

    // Check if news is fresh (within last 3 days)
    if (isNewsFresh(item, now, timezone)) {
      freshNews.push(item);
    } else {
      staleCount++;
    }
  }

  // Log filtering stats if we removed news items
  if (staleCount > 0 || noDateCount > 0) {
    console.log(`[filterFreshNews] Filtered: ${staleCount} stale, ${noDateCount} missing dates (kept ${freshNews.length}/${newsItems.length})`);
  }

  return freshNews;
}
