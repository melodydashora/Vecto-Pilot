// server/lib/strategy-utils.js
// Strategy-first gating utilities

import { db } from '../../db/drizzle.js';
import { withCurrentMainRun, MainRunAdmissionError } from '../main-run-admission.js';
import { strategies, rankings, main_run_admissions } from '../../../shared/schema.js';
import { assertCurrentStrategySource } from './strategy-source-store.js';
import { eq, sql } from 'drizzle-orm';
import { triadLog, OP, tagLog } from '../../logger/workflow.js';
// Shared IANA-aware wall-clock conversion; never interpret event times in the server zone.
import { fromZonedTime } from 'date-fns-tz';
import { getLocalDateString } from '../../../shared/dayparts.js';
import { normalizeDate, normalizeTime } from '../events/pipeline/normalizeEvent.js';

/**
 * CRITICAL: Create strategy row with snapshot location data
 * This ensures providers have a row to write to
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<void>}
 */
export async function ensureStrategyRow(snapshotId) {
  try {
    return await withCurrentMainRun(snapshotId, async tx => {
    // Check if strategy row already exists
    const [existing] = await tx.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);
    
    if (existing) {
      return; // Row already exists
    }
    
    // Fetch snapshot to get location data
    const { snapshots } = await import('../../../shared/schema.js');
    const [snapshot] = await tx.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);
    
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId.slice(0, 8)} not found while creating Strategy`);
    }

    // Create strategy row with location data from snapshot
    // CRITICAL: Explicitly set phase='starting' - don't rely on SQL defaults
    // PostgreSQL + Drizzle + onConflictDoNothing can leave phase as NULL otherwise
    await tx.insert(strategies).values({
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
    });
  } catch (error) {
    if (error instanceof MainRunAdmissionError) throw error;
    triadLog.error(1, `ensureStrategyRow failed`, error, OP.DB);
    throw error;
  }
}

/**
 * Check if the immediate strategy (strategy_for_now) is ready for a snapshot.
 * Used by blocks-fast to gate rendering until strategy exists.
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

    const ready = Boolean(strategyRow.strategy_for_now);

    return {
      ready,
      strategy: strategyRow.strategy_for_now,
      status: strategyRow.status
    };
  } catch (error) {
    console.error('[STRATEGY] Error:', error);
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
 *
 * 2026-01-14: Removed holidays (column dropped in 20251209_drop_unused_briefing_columns.sql)
 * Holiday info now lives in briefings.holiday (jsonb section, errorMarker on failure)
 *
 * @param {any} briefing - Raw briefing data
 * @returns {Object} - Normalized briefing with guaranteed shape
 */
export function normalizeBriefingShape(briefing) {
  return {
    events: Array.isArray(briefing?.events) ? briefing.events : [],
    news: Array.isArray(briefing?.news) ? briefing.news : [],
    traffic: Array.isArray(briefing?.traffic) ? briefing.traffic : [],
    school_closures: Array.isArray(briefing?.school_closures) ? briefing.school_closures : []
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

// 2026-04-28: Canonical pipeline phase order, used by updatePhase for monotonic
// ordering enforcement. Strategy phases come first (starting → immediate), then
// the SmartBlocks tail (venues → complete). Any updatePhase() call attempting to
// move BACKWARD in this list is refused with a WARN log — that's how silent
// duplicate emits (4 'complete' writers, 2 'venues' writers — see audit §10.1)
// stop being a problem: the second write idempotently no-ops instead of
// re-emitting an SSE phase_change event the client has already processed.
const PIPELINE_PHASE_ORDER = [
  'starting',
  'resolving',
  'analyzing',
  'immediate',
  'venues',
  'routing',
  'places',
  'verifying',
  'enriching',
  'complete',
];

/**
 * Update pipeline phase for a snapshot's strategy with timing metadata
 * Strategy phases: starting → resolving → analyzing → immediate
 * SmartBlocks phases: venues → routing → places → verifying → complete
 *
 * 2026-04-28: Idempotent + monotonic. If the strategy row's phase already equals
 * the requested phase, this is a no-op — no DB write, no SSE emit. If the
 * requested phase is BEFORE the current phase in PIPELINE_PHASE_ORDER, the
 * call is refused with a WARN log (prevents accidental phase regression). Both
 * checks address the duplicate-writer pattern documented in audit §10.1
 * (`enhanced-smart-blocks.js:414` + `blocks-fast.js:839` both write 'venues';
 * four sites write 'complete'). The auto-correct path at content-blocks.js:208
 * remains effective because moving forward to 'complete' from any earlier phase
 * is a valid monotonic transition.
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {string} phase - Phase name
 * @param {Object} options - Optional parameters
 * @param {EventEmitter} options.phaseEmitter - Optional emitter for SSE phase_change events
 * @returns {Promise<void>}
 */
export async function updatePhase(snapshotId, phase, options = {}) {
  try {
    const changedAt = await withCurrentMainRun(snapshotId, async (tx, admission) => {
    const now = new Date();

    // 2026-04-28: Read current row to enforce idempotency + monotonic ordering.
    // A missing Strategy cannot publish progress; row creation must succeed first.
    const [currentRow] = await tx.select({ phase: strategies.phase })
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);
    if (!currentRow) throw new Error('Cannot publish a phase without a persisted Strategy');
    const currentPhase = currentRow.phase;

    if (currentPhase === phase) {
      // Idempotency: same phase, no-op. Caller may be the 2nd of N duplicate
      // writers (audit §10.1) or the auto-correct path (content-blocks.js:210)
      // hitting an already-complete row. Either way: no DB write, no SSE emit.
      return;
    }

    if (currentPhase) {
      const currentIdx = PIPELINE_PHASE_ORDER.indexOf(currentPhase);
      const targetIdx = PIPELINE_PHASE_ORDER.indexOf(phase);
      // Both must be known phases for the comparison to be meaningful. If
      // either is unknown, fall through to the write — defensive, doesn't
      // refuse a transition we can't reason about.
      if (currentIdx >= 0 && targetIdx >= 0 && targetIdx < currentIdx) {
        triadLog.warn(1, `Refusing backward phase transition: ${currentPhase} → ${phase} for ${snapshotId.slice(0, 8)} (monotonic ordering)`);
        return;
      }
    }

    // 2026-01-15: FIX - When phase='complete', also update status to 'ok'
    // This was missing, causing strategies to stay in 'pending_blocks' status forever
    // The status flow is: pending → pending_blocks → ok (see status-constants.js)
    const updateData = {
      phase,
      phase_started_at: now,  // Track when this phase started
      updated_at: now
    };

    // When pipeline completes, finalize the status
    let completedRanking = null;
    if (phase === 'complete') {
      await assertCurrentStrategySource(snapshotId, tx);
      const [ranking] = await tx.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      if (!ranking) throw new Error('Cannot complete a run before its venue ranking is persisted');
      completedRanking = ranking;
      updateData.status = 'ok';
    }

    await tx.update(strategies)
      .set(updateData)
      .where(eq(strategies.snapshot_id, snapshotId));

    // 2026-01-15: Also mark triad_jobs as complete when phase='complete'
    if (phase === 'complete') {
      const { triad_jobs } = await import('../../../shared/schema.js');
      await tx.update(triad_jobs)
        .set({ status: 'ok' })
        .where(eq(triad_jobs.snapshot_id, snapshotId));
      await tx.update(main_run_admissions).set({ status: 'complete', updated_at: now })
        .where(eq(main_run_admissions.run_id, admission.run_id));
      // PostgreSQL delivers this only after the entire completion transaction
      // commits. Same-phase calls above cannot emit a duplicate readiness event.
      const payload = JSON.stringify({ snapshot_id: snapshotId,
        ranking_id: completedRanking.ranking_id, timestamp: now.toISOString() });
      await tx.execute(sql`SELECT pg_notify('blocks_ready', ${payload})`);
    }

    return now;
    });
    if (!changedAt) return;

    // 2026-04-27 (Commit 7 of CLEAR_CONSOLE_WORKFLOW): collapsed three lines
    // (caller [PHASE], updatePhase [PHASE-UPDATE], [strategy-utils] file-tag)
    // into ONE canonical emission per phase transition. Caller no longer pre-logs.
    const statusNote = phase === 'complete' ? ' (status->ok)' : '';
    const main = ['immediate', 'resolving', 'analyzing'].includes(phase) ? 'STRATEGY' :
                 ['venues', 'routing', 'places', 'verifying', 'enriching'].includes(phase) ? 'VENUE' : 'WATERFALL';
    tagLog([main, 'PHASE-UPDATE'], `${snapshotId.slice(0, 8)} -> ${phase}${statusNote} (updated at ${changedAt.toISOString()})`);

    // Emit phase_change SSE event if emitter provided
    if (options.phaseEmitter) {
      options.phaseEmitter.emit('change', {
        snapshot_id: snapshotId,
        phase,
        phase_started_at: changedAt.toISOString(),
        expected_duration_ms: PHASE_EXPECTED_DURATIONS[phase] || 5000
      });
    }
  } catch (error) {
    triadLog.error(1, `Phase update failed`, error, OP.DB);
    throw error;
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

// One read-time conversion for Briefing active windows and freshness. Offset ISO
// strings already identify an instant; local clocks require the snapshot IANA
// timezone. A malformed time never falls through to an invented all-day span.
function calendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && normalizeDate(value) === value ? value : null;
}
function shiftCalendarDate(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function localInstant(date, clock, timezone) {
  getLocalDateString(new Date(), timezone); // shared fail-loud timezone validation
  const result = fromZonedTime(`${date}T${clock}`, timezone);
  return Number.isFinite(result.getTime()) ? result : null;
}
function timestampInstant(value, timezone) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match || !calendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return null;
  const result = match[5] ? new Date(value) : localInstant(match[1], value.split('T')[1], timezone);
  return result && Number.isFinite(result.getTime()) ? result : null;
}
function explicitAllDay(event) {
  return event?.all_day === true || event?.is_all_day === true || event?.allDay === true ||
    (typeof (event?.event_start_time ?? event?.event_time) === 'string' &&
      /^all[ -]?day$/i.test((event.event_start_time ?? event.event_time).trim()));
}
const START_TIMESTAMPS = ['start_time_iso', 'startsAt', 'starts_at', 'start_time', 'startTime'];
const END_TIMESTAMPS = ['end_time_iso', 'endsAt', 'ends_at', 'end_time', 'endTime'];
function suppliedTimestamp(event, fields, timezone) {
  for (const field of fields) if (event[field] != null) return { supplied: true, value: timestampInstant(event[field], timezone) };
  return { supplied: false, value: null };
}
export function getEventStartTime(event, timezone = null) {
  if (!event) return null;
  const timestamp = suppliedTimestamp(event, START_TIMESTAMPS, timezone);
  if (timestamp.supplied) return timestamp.value;
  const date = calendarDate(event.event_start_date || event.event_date || event.startDate || event.start_date || event.date);
  if (!date) return null;
  if (explicitAllDay(event)) return localInstant(date, '00:00:00', timezone);
  const time = normalizeTime(event.event_start_time ?? event.event_time);
  return time ? localInstant(date, `${time}:00`, timezone) : null;
}
export function getEventEndTime(event, timezone = null) {
  if (!event) return null;
  const timestamp = suppliedTimestamp(event, END_TIMESTAMPS, timezone);
  if (timestamp.supplied) return timestamp.value;
  const startDate = calendarDate(event.event_start_date || event.event_date || event.startDate || event.start_date || event.date);
  let date = event.event_end_date != null ? calendarDate(event.event_end_date) : startDate;
  if (!date || (startDate && date < startDate)) return null;
  if (explicitAllDay(event)) return localInstant(date, '23:59:59.999', timezone);
  const time = normalizeTime(event.event_end_time);
  if (!time) return null;
  const startTime = normalizeTime(event.event_start_time ?? event.event_time);
  // Matches ingestion's existing overnight rule for older rows without end_date.
  if (event.event_end_date == null && startTime && time <= startTime) date = shiftCalendarDate(date, 1);
  return localInstant(date, `${time}:00`, timezone);
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

  // 2026-04-10: FIX — Post-event surge window. Rideshare drivers benefit from knowing about
  // events for ~2 hours AFTER they end (pickup surge from attendees leaving). Previously,
  // events were removed the instant they ended, which is too aggressive for driver utility.
  // 2026-05-02: Workstream 6 commit 8.5 — extended from 1h to 2h based on observed
  // post-event ride patterns (large-venue dispersion + transit congestion delays).
  // Must match the cleanup buffer in server/lib/briefing/cleanup-events.js so the
  // read-side fresh window and the write-side deactivation window stay synchronized.
  const POST_EVENT_SURGE_MS = 2 * 60 * 60 * 1000; // 2 hour post-event surge window

  // 2026-01-06: Pass timezone to getEventEndTime for proper parsing of discovered_events format
  const endTime = getEventEndTime(event, timezone);

  // If we have an end time, keep event visible until end + 2hr (post-surge)
  if (endTime) {
    return new Date(endTime.getTime() + POST_EVENT_SURGE_MS) > now;
  }

  const suppliedEndClock = [event.event_end_time, ...END_TIMESTAMPS.map(key => event[key])]
    .some(value => value != null);
  if (suppliedEndClock) return false;

  // If no end time, use start time + default duration (3 hours) + post-surge
  const startTime = getEventStartTime(event, timezone);
  if (startTime) {
    const inferredEnd = new Date(startTime.getTime() + 3 * 60 * 60 * 1000 + POST_EVENT_SURGE_MS);
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
    console.log(`[BRIEFING] [EVENTS] [FRESHNESS] [filterFreshEvents] Filtered: ${staleCount} stale, ${noDateCount} missing dates (kept ${freshEvents.length}/${events.length}) tz=${timezone || 'local'}`);
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
function getNewsPublicationDate(newsItem, timezone) {
  if (!newsItem) return null;
  for (const field of ['published_date', 'publishedDate', 'pubDate', 'pub_date', 'publication_date', 'date', 'created_at', 'createdAt']) {
    if (newsItem[field] == null) continue;
    const date = calendarDate(newsItem[field]);
    return date ? localInstant(date, '00:00:00', timezone) : timestampInstant(newsItem[field], timezone);
  }
  return null;
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
export function isNewsFresh(newsItem, now = new Date(), timezone) {
  if (!newsItem || !Number.isFinite(now.getTime())) return false;
  const today = getLocalDateString(now, timezone);
  const pubDate = getNewsPublicationDate(newsItem, timezone);
  if (!pubDate || pubDate > now) return false;
  const cutoff = localInstant(shiftCalendarDate(today, -NEWS_FRESHNESS_DAYS), '00:00:00', timezone);
  return pubDate >= cutoff;
}

/**
 * @deprecated Use isNewsFresh instead - renamed for clarity
 */
export function isNewsFromToday(newsItem, now = new Date(), timezone) {
  return isNewsFresh(newsItem, now, timezone);
}

/**
 * Filter news to only include fresh news (last 3 days) with valid publication dates
 * 2026-01-05: Changed from "today only" to "last 3 days" - roadwork/traffic news stays relevant
 * CRITICAL: Rejects news without publication date entirely
 *
 * @param {Array} newsItems - Array of news item objects
 * @param {Date} now - Reference time for comparison (default: current time)
 * @param {string} timezone - Snapshot IANA timezone (required)
 * @returns {Array} - Filtered array of fresh news (last 3 days with valid dates)
 */
export function filterFreshNews(newsItems, now = new Date(), timezone) {
  if (!Array.isArray(newsItems)) {
    return [];
  }

  const freshNews = [];
  let staleCount = 0;
  let noDateCount = 0;

  for (const item of newsItems) {
    // Check for valid publication date first - REQUIRED
    if (!getNewsPublicationDate(item, timezone)) {
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
