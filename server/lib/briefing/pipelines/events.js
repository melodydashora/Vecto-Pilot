// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 8/11).
// Owns: events section of the briefings row + briefing_events_ready pg_notify channel.
// Plus the discovered_events DB table writes (post-discovery, post-validation, post-dedup).
//
// Live path (verified via call-graph recon — see claude_memory #297):
//   fetchEventsForBriefing → fetchEventsWithGemini3ProPreview → fetchEventCategory (parallel x N)
//                          → validateEventsHard → deduplicateEvents (HASH, Rule 16)
//                          → deduplicateEventsSemantic → venue resolution → discovered_events INSERT
//                          → canonical country/metro read + venue-local instants → return
//
// 2026-09-29: a candidate that cannot be verified is rejected ALONE (see
// "Candidate rejection" below). The section fails only when discovery itself,
// a write, or the saved read failed.
//
// 2026-05-02: 4 dead code paths deleted in this commit (Option A precedent — see
// claude_memory #294 + #295 + #296):
//   - fetchEventsWithClaudeWebSearch (Claude WebSearch fallback) — zero callers
//   - _fetchEventsWithGemini3ProPreviewLegacy (legacy single-search Gemini) — zero callers
//   - mapGeminiEventsToLocalEvents (event-shape mapper) — zero callers
//   - LocalEventSchema (Zod schema paired with mapGemini) — zero .parse()/.safeParse() callers
//
// SURVIVAL GUARDRAILS (Master Architect directive — distinct from sibling modules):
//   - deduplicateEvents (HASH dedup, Rule 16) — distinct from deduplicateEventsSemantic.js
//     (semantic title-similarity dedup). Both coexist; both are LIVE; both run in sequence
//     inside fetchEventsForBriefing (hash-first then semantic).
//   - filterInvalidEvents (LIVE compatibility shim) — distinct from validateEventsHard
//     (canonical validation module). filterInvalidEvents is exported from this file (and
//     re-exported from briefing-service.js) for API read paths (briefing.js,
//     dump-last-briefing.js).
//
// Logging tag: [BRIEFING][EVENTS] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { getMarketForLocation } from '../shared/get-market-for-location.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
import { discovered_events } from '../../../../shared/schema.js';
import { sql } from 'drizzle-orm';
import { validateEventsHard, VALIDATION_SCHEMA_VERSION } from '../../events/pipeline/validateEvent.js';
import { normalizeEvent, normalizeTime } from '../../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../../events/pipeline/hashEvent.js';
import { deduplicateEventsSemantic } from '../../events/pipeline/deduplicateEventsSemantic.js';
import { findOrCreateVenue, lookupVenue } from '../../venue/venue-cache.js';
import { geocodeEventAddress } from '../../events/pipeline/geocodeEvent.js';
import { searchPlaceWithTextSearch } from '../../venue/venue-address-resolver.js';
import { parseAddressComponents } from '../../venue/venue-utils.js';
import { normalizeCoordinates } from '../../../../shared/coordinates.js';
import { readMarketEvents, toBriefingEvent, eventOverlapsDisplayDays, venueInSnapshotMarket } from '../../events/market-event-reader.js';
import { prioritizeBriefingEvents } from '../../events/briefing-event-priority.js';
import { deactivatePastEvents, collapseDuplicateEventSpans, clearOrphanedEventVenueTags, mergeIntoOverlappingActiveSpan, withEventVenueLock, resolveEventWriteHash, discoveryReactivationFields } from '../cleanup-events.js';

// Per-category Gemini search timeout. Each category runs in parallel; total fan-out
// time is bounded by max(category_timeouts), not sum, since they're Promise.all'd.
// 2026-10-05: The former 90-second deadline cancelled live HIGH-thinking search
// after the token cap was corrected. The first increase matched the router's
// 120-second default. Melody then requested three minutes; the Events role's
// router budget matches this caller deadline, which still cancels transport
// and rejects late output.
const EVENT_SEARCH_TIMEOUT_MS = 180000;
const EVENT_VENUE_TIMEOUT_MS = 15000; // One budget for cache/Places/geocode resolution

/**
 * Start work only after its cancellation scope exists. The deadline reaches the
 * transport, while the race also bounds adapters that do not honor cancellation.
 * Awaited response boundaries below reject late results before fallback/writes.
 */
async function withTimeout(operation, timeoutMs, operationName = 'Operation', signal) {
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  requestSignal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(requestSignal.reason || new Error(`${operationName} cancelled`));
    requestSignal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => {
    const error = new Error(`${operationName} timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    briefingLog.warn(2, error.message, OP.AI);
    controller.abort(error);
  }, timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => { requestSignal.throwIfAborted(); return operation(requestSignal); }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener('abort', onAbort);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-29: Candidate rejection.
// Melody's rule: "Missing required data -> throw with a descriptive reason.
// Missing optional data -> omit the feature/field, never substitute a guess."
// Each discovered candidate is optional evidence. One that cannot be verified is
// rejected ALONE, logged with its stage and cause, and counted in the section's
// candidate summary. Nothing about it is repaired, inferred or defaulted.
//
//   stage             reason
//   discovery         missing_required_fields (the source omitted a required fact)
//   validation        the validator's own reason code (invalid_end_time, tbd_in_title, ...)
//   schedule          schedule_inconsistent
//   venue_resolution  venue_unverified | venue_lookup_timeout | venue_lookup_failed
//
// Section failures remain: discovery (a category failed, timed out or returned a
// malformed response), persistence (a write failed) and saved_read (the read failed).
// ─────────────────────────────────────────────────────────────────────────────
class EventCandidateRejection extends Error {
  constructor(stage, reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = 'EventCandidateRejection';
    this.stage = stage;
    this.reason = reason;
    this.detail = detail;
  }
}

// Server-log text only. Driver-facing text is produced by briefingFailureReason.
function describeCause(error) {
  const chain = [];
  for (let current = error; current != null && chain.length < 4; current = current.cause) {
    const code = current.code ? ` [${current.code}]` : '';
    chain.push(`${current.name || 'Error'}${code}: ${String(current.message ?? current).slice(0, 300)}`);
  }
  return chain.join(' <- ');
}

// A failure is logged once, at the stage that knows the most about it.
const reportedFailures = new WeakSet();
function reportStageFailure(stage, error, subject = '') {
  briefingLog.error(2, `[EVENTS] [stage=${stage}] ${subject}failed: ${describeCause(error)}`, error, OP.DB);
  if (error !== null && typeof error === 'object') reportedFailures.add(error);
  return error;
}

const label = value => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null);

function createCandidateLedger() {
  const counts = { discovered: 0, duplicates: 0, accepted: 0, outside_window: 0, saved_excluded: 0, saved_invalid: 0 };
  const rejected = [];
  return {
    counts,
    // `detail` is stored with the section, so it is always text written here.
    // A provider or database message is passed as `cause` and reaches the log only.
    reject(candidate, { stage, reason, detail, cause = null }) {
      const entry = { title: label(candidate?.title), venue: label(candidate?.venue_name ?? candidate?.venue), stage, reason, detail };
      rejected.push(entry);
      briefingLog.warn(2, `[EVENTS] [stage=${stage}] Candidate rejected alone (${reason}): "${entry.title}" at "${entry.venue}" - ${detail}` +
        (cause ? ` | cause: ${describeCause(cause)}` : ''), OP.AI);
    },
    summary() {
      const byReason = new Map();
      for (const { reason } of rejected) byReason.set(reason, (byReason.get(reason) || 0) + 1);
      return {
        ...counts,
        rejected: rejected.length,
        rejections: [...byReason].map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        rejected_candidates: rejected,
      };
    },
  };
}

function candidateNote({ discovered, rejected, rejections, saved_excluded }) {
  const notes = [];
  if (rejected) {
    notes.push(`${rejected} of ${discovered} discovered event candidates ${rejected === 1 ? 'was' : 'were'} rejected (` +
      rejections.map(entry => `${entry.reason}: ${entry.count}`).join(', ') + ')');
  }
  if (saved_excluded) {
    notes.push(saved_excluded === 1
      ? '1 saved event was excluded because its venue-local schedule could not be resolved'
      : `${saved_excluded} saved events were excluded because their venue-local schedules could not be resolved`);
  }
  return notes.join('. ');
}

// The source facts Briefing requires before normalization may run.
function missingSourceFields(candidate) {
  const missing = [];
  if (!candidate.title) missing.push('title');
  if (!(candidate.venue || candidate.venue_name)) missing.push('venue');
  if (!(candidate.event_start_date || candidate.event_date || candidate.date)) missing.push('event_start_date');
  if (!candidate.event_end_date) missing.push('event_end_date');
  if (!(candidate.event_start_time || candidate.event_time || candidate.time)) missing.push('event_start_time');
  if (!(candidate.event_end_time || candidate.end_time)) missing.push('event_end_time');
  return missing;
}

// An interval whose end precedes its start cannot be placed on a calendar. The
// usual source is an overnight event that repeats its start date as its end date
// (21:00 to 01:00, same date). The end date is never moved here: the candidate is
// rejected, and the discovery request states what a consistent schedule looks like.
function scheduleInconsistency(event) {
  const start = normalizeTime(event.event_start_time);
  const end = normalizeTime(event.event_end_time);
  if (!start || !end || !event.event_start_date || event.event_end_date !== event.event_start_date || end >= start) return null;
  return `ends ${end} before it starts ${start} on the same date ${event.event_start_date}; ` +
    'an event that ends after midnight must carry the next calendar day as its end date';
}

/**
 * HYBRID EVENT CATEGORIES - 2 focused searches instead of 5 for better cost/quality balance
 * 2026-02-01: Consolidated from 5 categories to 2 (60% cost reduction, same quality)
 * 2026-02-01: Now uses MARKET (not city) for broader event coverage
 *
 * Split rationale:
 * - high_impact: Big venues that generate surge demand (stadiums, arenas, concert halls)
 * - local_entertainment: Smaller venues, local events (bars, comedy clubs, community)
 * 2026-10-05: Melody narrowed this to valuable nearby gatherings and only major
 * wider-market crowd draws. Routine local listings are not a demand signal.
 *
 * 2026-02-26: FIX - Removed hardcoded US league names (NBA, NFL, etc.) and DFW-specific references.
 * Search terms are now market-agnostic so Gemini discovers whatever events exist in any global market.
 * 2026-04-05: FIX — eventTypes now use ONLY values from ALLOWED_CATEGORIES in validateEvent.js.
 * Previously used 'game' and 'live_music' which don't exist in the allowed list.
 */
const EVENT_CATEGORIES = [
  {
    name: 'high_impact',
    description: 'Major events at large venues (stadiums, arenas, concert halls, convention centers)',
    searchTerms: (market, state, date) => `concerts sports games festivals ${market} metro ${state} ${date} stadium arena theater convention center major events tonight`,
    eventTypes: ['concert', 'sports', 'festival', 'convention'],
    maxEvents: 8
  },
  {
    name: 'local_entertainment',
    description: 'High-value nearby entertainment and community gatherings with evidence of a meaningful crowd',
    searchTerms: (market, state, date) => `ticketed comedy shows live music major community gatherings ${market} ${state} ${date} popular local entertainment crowd`,
    eventTypes: ['concert', 'comedy', 'nightlife', 'community'],
    maxEvents: 8
  }
];

/**
 * Deduplicate events based on normalized name, address, and time (HASH dedup, Rule 16).
 *
 * Problem: LLMs discover the same event multiple times with slight name variations:
 * - "O" by Cirque du Soleil in Shared Reality
 * - O by Cirque du Soleil at Cosm (Shared Reality)
 * - "O" by Cirque du Soleil (Shared Reality) at Cosm
 *
 * All at same venue (5776 Grandscape Blvd) with same time (3:30 PM - 5:30 PM)
 *
 * Solution: Normalize and group by (name_key + address_base + start_time)
 * Keep highest impact event from each group.
 *
 * SURVIVAL GUARDRAIL: distinct from deduplicateEventsSemantic.js (semantic title-similarity).
 * Both coexist and run in sequence inside fetchEventsForBriefing — hash dedup first, then
 * semantic dedup. Re-exported from briefing-service.js to preserve external API surface.
 *
 * @param {Array} events - Array of normalized events
 * @returns {Array} Deduplicated events
 */
// 2026-01-05: Exported for use in briefing.js events endpoint
export function deduplicateEvents(events) {
  if (!events || events.length === 0) return events;

  /**
   * Normalize event name for comparison:
   * - Remove quotes and special chars
   * - Remove parenthetical content like "(Shared Reality)"
   * - Remove common PREFIXES like "Live Music:", "Concert:", "Live Band:" (2026-01-31)
   * - Remove common suffixes like "at Cosm", "in Shared Reality"
   * - Lowercase and trim
   */
  function normalizeEventName(name) {
    if (!name) return '';
    return name
      .normalize('NFC')
      .toLowerCase()
      .replace(/["'"]/g, '')                          // Remove quotes
      // 2026-01-31: Strip common event prefixes that create duplicates
      .replace(/^(live music|live band|concert|show|event|performance|dj set|acoustic):\s*/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')              // Remove (parenthetical content)
      .replace(/\s+(at|in|from|@)\s+.+$/i, '')       // Remove "at Cosm", "in Shared Reality" suffixes
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')                  // Remove special chars (Unicode-safe, 2026-09-13)
      .replace(/\s+/g, ' ')                          // Collapse spaces
      .trim();
  }

  /**
   * Extract base address for comparison:
   * - Get first number sequence (street number)
   * - Get street name words
   * - Allows matching "5776 Grandscape Blvd" with "5752 Grandscape Blvd" (same venue block)
   */
  function normalizeAddress(address) {
    if (!address) return '';
    const lower = address.toLowerCase();
    // Extract street name (after street number)
    const streetMatch = lower.match(/\d+\s+(.+?)(?:,|$)/);
    const streetName = streetMatch ? streetMatch[1].split(/[,#]/)[0].trim() : lower;
    // Get first few significant words
    const words = streetName.split(/\s+/).slice(0, 2).join(' ');
    return words;
  }

  /**
   * Normalize time to comparable format (e.g., "3:30 PM" -> "1530")
   */
  function normalizeTime(timeStr) {
    if (!timeStr) return '';
    const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (!match) return timeStr.toLowerCase();
    let hour = parseInt(match[1]);
    const min = match[2] || '00';
    const period = (match[3] || '').toLowerCase();
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}${min}`;
  }

  // Create deduplication key
  function getDedupeKey(event) {
    const name = normalizeEventName(event.title);
    const addr = normalizeAddress(event.address);
    // 2026-01-10: Support both old (event_time) and new (event_start_time) field names during migration
    const time = normalizeTime(event.event_start_time || event.event_time);
    return JSON.stringify([name, event.venue_name || event.venue, addr, event.city, event.state, event.event_start_date, event.event_end_date, time, normalizeTime(event.event_end_time)]);
  }

  // Group events by dedupe key
  const groups = new Map();
  for (const event of events) {
    const key = getDedupeKey(event);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(event);
  }

  // From each group, keep the best event (highest impact, or first if same)
  const impactOrder = { high: 3, medium: 2, low: 1 };
  const deduplicated = [];

  for (const [key, group] of groups) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
    } else {
      // Sort by impact (high first), then by title length (shorter = cleaner)
      group.sort((a, b) => {
        const impactDiff = (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
        if (impactDiff !== 0) return impactDiff;
        return (a.title?.length || 0) - (b.title?.length || 0);
      });
      deduplicated.push(group[0]);

      // 2026-04-28: per-variant dedup debug — demoted to debug since the
      // summary at line 275 reports the count (memory 236 — duplicate emits).
      if (group.length > 1 && String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
        briefingLog.info(`[EVENTS] [DEDUP] Merged ${group.length} variants of "${group[0].title?.slice(0, 40)}..."`);
      }
    }
  }

  const removed = events.length - deduplicated.length;
  if (removed > 0) {
    briefingLog.done(2, `[EVENTS] [DEDUP] Hash dedup: ${events.length} → ${deduplicated.length} (${removed} duplicates removed)`, OP.DB);
  }

  return deduplicated;
}

/**
 * 2026-01-08: HARD FILTER - Remove events with TBD/Unknown in critical fields
 * 2026-01-09: DEPRECATED - Delegates to canonical validateEventsHard module
 * 2026-04-28: Now accepts { timezone } so Rule 13 (today-or-yesterday window) runs in
 *   the driver's local timezone instead of UTC. Without this, AHEAD-timezone drivers
 *   (HST/JST/AEST/Pacific/Kiritimati) saw today's stored events stripped on every read
 *   during the 9-14h UTC window where local-today equals UTC-tomorrow. Closes the
 *   read-path gap that commit 5cecd113 left open (write path was already tz-aware).
 *
 * This function is kept for backwards compatibility. New code should use:
 * import { validateEventsHard } from '../../events/pipeline/validateEvent.js';
 *
 * @deprecated Compatibility shim — use validateEventsHard() directly.
 * Scheduled for removal after all callers are migrated.
 *
 * SURVIVAL GUARDRAIL: distinct from validateEventsHard. This is a shim, but it IS
 * exported and re-exported from briefing-service.js because external API callers
 * still import the legacy name.
 *
 * Active callers (verified via call-graph recon 2026-05-02):
 *   1. server/api/briefing/briefing.js (POST /filter-invalid-events) — imported at line 4
 *   2026-09-29: MAIN and diagnostic reads now use canonical country/metro projections;
 *   those historical internal callers no longer use this calendar-only shim.
 *
 * @param {Array} events - Array of events to filter
 * @param {Object} [options={}] - Options
 * @param {string} [options.timezone] - IANA timezone for Rule 13. When omitted,
 *   missing timezone throws at Rule 13. Pass the authoritative context timezone.
 * @returns {Array} Clean events with no TBD/Unknown values
 */
export function filterInvalidEvents(events, { timezone } = {}) {
  if (!events || events.length === 0) return events;

  // 2026-01-09: Delegate to canonical validateEventsHard module
  // This ensures consistent validation rules across the entire pipeline
  // 2026-04-28: Forward timezone via context so validateEvent's Rule 13 today-check
  // honors the driver's local timezone (spec §9.2 — global-app correctness).
  const result = validateEventsHard(events, {
    logRemovals: true,
    phase: 'BRIEFING_SERVICE_COMPAT',  // Indicates legacy caller for debugging
    context: { timezone }
  });

  return result.valid;
}

/**
 * Fetch events for a single category - used in parallel.
 * 2026-02-01: Updated for hybrid 2-category approach + market-wide search.
 *
 * Private helper — single caller is fetchEventsWithGemini3ProPreview.
 */
async function fetchEventCategory({ category, city, state, market, country, lat, lng, date, timezone, signal }) {
  const maxEvents = category.maxEvents || 8;
  // 2026-04-16: market is authoritative; placeholder surfaces unresolved markets in prompts
  const searchArea = market || '[unknown-market]';

  // 2026-02-26: Simplified prompt — today only, strict required fields, place_id for venue linking.
  // Search discovers published schedules; Google resolution verifies venue identity separately.
  // 2026-04-14: Inject driver GPS for proximity-biased discovery (Memory #107). Previously
  // the search was metro-wide with no proximity bias, so drivers in suburbs got events
  // 30-60mi away in the far corners of the metro. lat/lng were already parameters but
  // never reached the prompt.
  const prompt = `Find ${category.description || category.name.replace('_', ' ')} happening TODAY (${date}) in the ${searchArea} metro area in country ${country}. The driver day is defined by ${timezone}.

The driver is currently near coordinates (${lat}, ${lng}). Prioritize discovering high-value events at venues within 15 miles of these coordinates first. Outside that nearby area, include only major crowd draws with supporting evidence of high impact in the broader ${searchArea} area.

SEARCH: "${category.searchTerms(searchArea, state, date)} ${country}"
EVENT TYPES: ${category.eventTypes.join(', ')}

Return JSON array (max ${maxEvents} events). The title, venue, full address and all four published date/time fields are required. Unknown optional identity or impact stays null:
[{
  "title": "Event Name",
  "venue": "Venue Name",
  "place_id": null,
  "address": "Full Street Address, City, State",
  "category": "${category.eventTypes[0]}",
  "event_start_date": "YYYY-MM-DD (true start, may be earlier than ${date} for multi-day events)",
  "event_start_time": "7:00 PM",
  "event_end_time": "10:00 PM",
  "event_end_date": "YYYY-MM-DD (true end, may be later than ${date} for multi-day events; same as start for single-day; the next calendar day when the event ends after midnight)",
  "impact": "high|medium|low|null"
}]

RULES:
- ACTIVE TODAY: the actual event interval must overlap calendar day ${date} in ${timezone}. Report dates and clocks in the venue's own timezone. A neighboring timezone can have a different local date; do not discard that event solely because its printed date differs.
- 2026-05-05 (P0-1 fix): preserve TRUE multi-day spans. A 7-day festival running ${date} should report its real start (e.g. 4 days ago) and real end (e.g. 3 days from now) — DO NOT collapse the dates to ${date}. Multi-day events re-discovered tomorrow should report the same start/end so they hash identically.
- OVERNIGHT events: an event that ends after midnight MUST carry the next calendar day as its event_end_date. Example: an event that starts at 9:00 PM and ends at 1:00 AM has an event_end_date one day after its event_start_date. Never repeat the start date as the end date when the end time is earlier than the start time: that schedule is inconsistent and the event is rejected. Preserve the published venue-local start date and do not collapse dates across midnight.
- For SINGLE-day events: use the same actual venue-local date for start and end, which may differ from the driver date near a timezone boundary.
- place_id: optional opaque Google Places identifier only when a source supplies it; otherwise null. Never invent it or assume a prefix. Venue identity is verified separately.
- impact: high, medium or low only with supporting evidence; otherwise null.
- Nearby events should have evidence of a meaningful crowd (high or medium impact); wider-market events need evidence of high impact. Do not fill the list with routine bar nights, trivia, karaoke or small community listings without that evidence. Venue capacity alone does not establish attendance or demand. Never invent attendance counts or earnings.
- category: MUST be one of: concert, sports, comedy, theater, festival, nightlife, convention, community
- ALL 4 date/time fields REQUIRED — use the published schedule. Never estimate missing start/end times or durations. Omit an event if its schedule cannot be verified.
- Search the ENTIRE ${searchArea.toUpperCase()} metro, not just ${city}
- Prioritize high-attendance events that generate rideshare demand
- Return [] if no events active today.`;

  try {
    // 2026-01-14: FIX - Add STRICT categorization rules to prevent "concert" over-tagging
    // This ensures bars with live music are tagged as "live_music", not "concert"
    // 2026-02-26: FIX - Removed DFW-specific venue examples. App is global.
    // 2026-04-05: FIX — Aligned system prompt with ALLOWED_CATEGORIES from validateEvent.js.
    // Previously taught Gemini to use "live_music" which was NOT in the allowed list,
    // causing 100% validation rejection. Now uses only: concert, sports, comedy, theater,
    // festival, nightlife, convention, community, other.
    const system = `You are an event discovery assistant. Search for local events and return structured JSON data.

STRICT CATEGORIZATION RULES (MUST FOLLOW):
- concert: For ticketed performances at dedicated music venues, theaters, arenas, stadiums, AND live bands/DJs at bars or lounges.
- sports: Official league or tournament games at any level (professional, collegiate, international).
- comedy: Stand-up comedy shows, improv nights, comedy club events.
- theater: Plays, musicals, ballet, opera, dance performances.
- festival: Multi-act festivals, fairs, parades, outdoor celebrations.
- nightlife: Club nights, karaoke, trivia, themed bar parties (no live music performance).
- convention: Conventions, conferences, expos, trade shows.
- community: Public/civic gatherings (markets, library events, charity, fundraisers).
- other: Anything that doesn't fit the above categories.

category MUST be one of: concert, sports, comedy, theater, festival, nightlife, convention, community, other.
DO NOT use any other category values.`;
    matrixLog.info({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'DISPATCH',
      roleName: 'BRIEFER',
      secondaryCat: 'EVENTS',
      location: 'pipelines/events.js:fetchEventCategory',
    }, 'Calling Briefer for detailed events');
    // Uses BRIEFING_EVENTS_DISCOVERY role (Gemini with google_search)
    signal?.throwIfAborted();
    const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user: prompt, signal });
    signal?.throwIfAborted();

    if (!result.ok) {
      matrixLog.error({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'EVENTS',
        location: 'pipelines/events.js:fetchEventCategory',
      }, 'Briefer call failed', result.error);
      return { category: category.name, items: [], error: result.error || 'Event data provider failed without an explanation' };
    }

    const parsed = safeJsonParse(result.output);
    // 2026-08-06: providers vary between bare-array and object-wrapped JSON
    // ({events:[...]} / {items:[...]}). A successfully-parsed non-array was
    // previously discarded as [] with NO error recorded — format variance
    // masquerading as verified-empty.
    const items = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.events) ? parsed.events
      : Array.isArray(parsed?.items) ? parsed.items
      : null;
    if (items === null) {
      const shape = parsed && typeof parsed === 'object' ? `object with keys [${Object.keys(parsed).slice(0, 5).join(', ')}]` : typeof parsed;
      return { category: category.name, items: [], error: `parsed non-array response without events/items key (${shape})` };
    }
    // An entry that is not an object is a malformed response, not a candidate.
    if (items.some(e => e === null || typeof e !== 'object' || Array.isArray(e))) {
      throw new Error('Event data provider returned invalid events: every entry must be an event object');
    }
    // normalizeEvent can infer times for other callers. Briefing requires the
    // source facts and must reject omissions before those defaults can run.
    // 2026-09-29: the omission rejects that candidate alone. It used to fail the
    // category, and with it the section, the Briefing and Strategy.
    const complete = [], rejected = [];
    for (const e of items) {
      const missing = missingSourceFields(e);
      if (missing.length) {
        rejected.push({ event: e, stage: 'discovery', reason: 'missing_required_fields', detail: `source omitted ${missing.join(', ')}` });
      } else {
        complete.push(e);
      }
    }
    return { category: category.name, items: complete, rejected, reason: parsed?.reason || null };
  } catch (err) {
    return { category: category.name, items: [], error: err.message };
  }
}

/**
 * Fetch events using Gemini 3 Pro with Google Search grounding (PRIMARY discovery path).
 * Runs parallel category searches; merges + deduplicates (exact title + semantic).
 *
 * Private helper — single caller is fetchEventsForBriefing. The 2-category fan-out
 * (EVENT_CATEGORIES) replaced an earlier 5-category approach and a single-search
 * fallback (now-deleted _fetchEventsWithGemini3ProPreviewLegacy).
 */
async function fetchEventsWithGemini3ProPreview({ snapshot, signal, date, onCategory }) {
  signal?.throwIfAborted();
  // 2026-01-09: Require ALL location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data (city/state/timezone) - cannot fetch events', OP.AI);
    throw new Error('Event discovery requires city, state and timezone');
  }
  const city = snapshot.city;
  const state = snapshot.state;
  // 2026-05-05: P1-2 fix per events_e2e_audit.md — coerce + validate lat/lng before
  // they reach fetchEventCategory's prompt. Without this, an
  // older snapshot or test object passing string/missing coords throws inside the
  // catch path, returning an empty category result, which silently degrades the
  // entire event discovery to "no events found."
  const lat = Number(snapshot.lat);
  const lng = Number(snapshot.lng);
  if (snapshot.lat == null || snapshot.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    briefingLog.warn(2, `Invalid or missing snapshot coords (lat=${snapshot.lat}, lng=${snapshot.lng}) — skipping event discovery`, OP.AI);
    throw new Error('Location coordinates unavailable for event discovery');
  }
  // 2026-09-10: removed `const hour = snapshot?.hour ?? new Date().getHours()` — the value
  // was never read, and the fallback substituted the SERVER's clock for the driver's hour
  // (no-server-timezone rule). If an hour is ever needed here, take snapshot.hour and fail loud.
  const timezone = snapshot.timezone;  // NO FALLBACK - timezone is required

  // The caller captures one driver-local display day for search and saved reads.

  // 2026-04-16: Resolve market — snapshot.market is authoritative, DB lookup is fallback
  // for older snapshots. Null means genuinely unknown; callers handle the placeholder.
  const market = snapshot.market || await getMarketForLocation(city, state, snapshot.country);
  signal?.throwIfAborted();
  if (!market) {
    briefingLog.warn(2, `No market resolved for ${city}, ${state} — event search will use [unknown-market] placeholder`, OP.AI);
  }

  // 2026-02-26: Gemini-only for event discovery. Cross-provider fallback to Claude/GPT
  // returned data in incompatible formats causing more parsing failures than it solved.
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.error(2, `GEMINI_API_KEY not set - cannot fetch events`, null, OP.AI);
    throw new Error('GEMINI_API_KEY required for event discovery');
  }

  briefingLog.ai(2, 'Briefer', `events for ${market || '[unknown-market]'} market (driver in ${city}) - 2 focused searches (${EVENT_SEARCH_TIMEOUT_MS / 1000}s timeout each)`);

  // PARALLEL CATEGORY SEARCHES - 2 focused searches (high_impact + local_entertainment)
  // Each category runs independently, results are merged and deduplicated
  // 2026-02-01: Now searches entire market, not just driver's city
  const startTime = Date.now();
  // Verification starts when one complete category arrives, outside its model
  // deadline. Serialize callbacks and await every callback before finalizing so
  // concurrent responses cannot overwrite progress or outlive this generation.
  let progressQueue = Promise.resolve();

  const categoryPromises = EVENT_CATEGORIES.map(category =>
    withTimeout(
      requestSignal => fetchEventCategory({ category, city, state, market, country: snapshot.country.toUpperCase(), lat, lng, date, timezone, signal: requestSignal }),
      EVENT_SEARCH_TIMEOUT_MS,
      `Event search: ${category.name}`,
      signal
    ).catch(error => ({ category: category.name, items: [], timedOut: error.name === 'TimeoutError', error: error.message }))
      .then(result => {
        if (!onCategory || result.error || result.timedOut) return result;
        const callback = progressQueue.then(() => { signal?.throwIfAborted(); return onCategory(result); });
        progressQueue = callback;
        return callback.then(() => result, error => ({ ...result, error: error.message }));
      })
  );

  const categoryResults = await Promise.all(categoryPromises);
  signal?.throwIfAborted();
  // Cached rows or another successful category cannot prove the failed search
  // completed. Reject before cache reads or publishing any section as ready.
  const failures = categoryResults.filter(result => result.timedOut || result.error);
  if (failures.length) {
    throw new Error('Event discovery incomplete: ' + failures.map(result =>
      result.timedOut ? 'The data provider timed out' : result.error
    ).join('; '));
  }

  return mergeEventCategoryResults(categoryResults, { elapsedMs: Date.now() - startTime });
}

function mergeEventCategoryResults(categoryResults, { elapsedMs = null } = {}) {
  // Merge results from all categories. Progressive callers use the same rules
  // over the categories completed so far; the final merge still requires both.
  // 2026-04-11: Two-phase merge — exact title dedup first, then semantic title-similarity dedup
  const rawEvents = [];
  const seenTitles = new Set();
  const sourceRejections = [];
  let totalFound = 0;
  let completeFound = 0;

  for (const result of categoryResults) {
    totalFound += (result.items?.length || 0) + (result.rejected?.length || 0);
    completeFound += result.items?.length || 0;
    sourceRejections.push(...(result.rejected || []));
    for (const event of result.items || []) {
      // Phase 1: Exact title dedup (cheap, catches identical titles from different categories)
      const titleKey = event.title ? JSON.stringify([event.title.toLowerCase().trim(), event.venue_name || event.venue, event.address, event.event_start_date, event.event_end_date, event.event_start_time, event.event_end_time]) : null;
      if (titleKey && !seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        rawEvents.push(event);
      }
    }
  }


  // 2026-04-11: Phase 2 — Title-similarity dedup. Catches:
  // - "Jon Wolfe Concert" / "Jon Wolfe Live" / "Jon Wolfe" (title variants)
  // - "Fatboy Slim" at SILO Dallas + "Fatboy Slim" at Globe Life Field (wrong stadium assignment)
  // Prefers specific venues over stadiums, longer titles over shorter.
  const { deduplicated: allEvents, removed: semanticRemoved, mergeLog } =
    deduplicateEventsSemantic(rawEvents);

  if (semanticRemoved.length > 0 && elapsedMs !== null) {
    briefingLog.done(2, `[EVENTS] [DEDUP] Semantic dedup: ${rawEvents.length} → ${allEvents.length} (${semanticRemoved.length} title-variant duplicates removed)`, OP.AI);
    // 2026-04-28: per-merge mergeLog demoted — deduplicateEventsSemantic
    // already emits each [BRIEFING] [EVENTS] [DEDUP] line directly to console
    // (memory 236 — same line was firing twice).
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
      for (const logLine of mergeLog) {
        briefingLog.info(logLine);
      }
    }
  }

  if (elapsedMs !== null) briefingLog.done(2, `Briefer: ${allEvents.length} unique events (${totalFound} total from 2 searches, ${sourceRejections.length} incomplete) in ${elapsedMs}ms`, OP.AI);

  // Every category completed. Preserve provided no-data explanations; bare-array
  // providers retain the existing successful-empty contract.
  // 2026-09-29: "no events found" is only true when the searches returned none.
  const emptyReasons = categoryResults.map(result => result.reason).filter(reason => typeof reason === 'string' && reason.trim());
  return { items: allEvents, rejected: sourceRejections, found: totalFound, duplicates: completeFound - allEvents.length,
    reason: totalFound ? null : emptyReasons.join('; ') || 'No events found across all categories', provider: 'gemini' };
}

// Content validation precedes paid venue resolution. Calendar exclusions alone
// must wait: a neighboring venue can already be on tomorrow's local date.
const DATE_WINDOW_REASONS = new Set(['starts_in_future', 'ended_before_today']);

// Every reason a catalog row cannot host a verified event. Empty means verified.
function eventVenueIssues(venue, country) {
  if (!venue) return ['no catalog venue was returned'];
  const issues = [];
  for (const field of ['venue_id', 'place_id', 'formatted_address', 'city', 'state']) {
    if (!venue[field]) issues.push(`${field} missing`);
  }
  if (typeof venue.country !== 'string' || venue.country.toUpperCase() !== country) {
    issues.push(`country ${JSON.stringify(venue.country ?? null)} is not the ISO-2 code ${country}`);
  }
  if (!normalizeCoordinates(venue.lat, venue.lng)) issues.push('coordinates missing or invalid');
  if (!venue.timezone) {
    issues.push('timezone missing');
  } else {
    try { new Intl.DateTimeFormat('en-US', { timeZone: venue.timezone }); } catch { issues.push(`timezone ${JSON.stringify(venue.timezone)} is not a valid zone`); }
  }
  return issues;
}

function hasVerifiedEventVenue(venue, country) {
  return eventVenueIssues(venue, country).length === 0;
}

function venueRejection(error) {
  if (error instanceof EventCandidateRejection) return { stage: error.stage, reason: error.reason, detail: error.detail };
  if (error?.name === 'TimeoutError') {
    return { stage: 'venue_resolution', reason: 'venue_lookup_timeout', detail: `venue lookup exceeded ${EVENT_VENUE_TIMEOUT_MS}ms`, cause: error };
  }
  return { stage: 'venue_resolution', reason: 'venue_lookup_failed', detail: 'venue lookup raised an error', cause: error };
}

async function resolveEventVenue(event, snapshot, signal) {
  signal?.throwIfAborted();
  const country = snapshot.country.toUpperCase();
  // Model-supplied place IDs are hints, not verified identity. Reuse an
  // unambiguous saved name/locality/country match; otherwise ask Places.
  const cached = await lookupVenue({ venueName: event.venue_name, city: event.city || snapshot.city,
    state: event.state || snapshot.state, country });
  signal?.throwIfAborted();
  if (hasVerifiedEventVenue(cached, country)) return cached;

  const query = [event.venue_name, event.address, event.city, event.state, country].filter(Boolean).join(', ');
  let place = await searchPlaceWithTextSearch(snapshot.lat, snapshot.lng, query, { radius: 50000, signal });
  signal?.throwIfAborted();
  if (!place) {
    const geocoded = await geocodeEventAddress(event.address || event.venue_name, event.city || snapshot.city, event.state || snapshot.state, { signal });
    signal?.throwIfAborted();
    if (geocoded && !geocoded.partial_match) {
      place = { placeId: geocoded.place_id, formattedAddress: geocoded.formatted_address,
        lat: geocoded.lat, lng: geocoded.lng, parsed: parseAddressComponents(geocoded.address_components) };
    }
  }
  const coords = normalizeCoordinates(place?.lat, place?.lng);
  const placeIssues = !place ? ['the venue identity provider returned no place'] : [
    !place.placeId && 'place_id missing',
    !place.formattedAddress && 'formatted address missing',
    !coords && 'coordinates missing or invalid',
    !place.parsed?.city && 'city missing',
    !place.parsed?.state && 'state missing',
    place.parsed?.country?.toUpperCase() !== country && `country ${JSON.stringify(place.parsed?.country ?? null)} is not the ISO-2 code ${country}`,
  ].filter(Boolean);
  if (placeIssues.length) {
    throw new EventCandidateRejection('venue_resolution', 'venue_unverified', `provider place cannot be verified: ${placeIssues.join('; ')}`);
  }
  const venue = await findOrCreateVenue({ venue: place.displayName || event.venue_name,
    address: place.formattedAddress, formattedAddress: place.formattedAddress,
    latitude: coords.lat, longitude: coords.lng, city: place.parsed.city, state: place.parsed.state,
    country: place.parsed.country, placeId: place.placeId }, 'briefing_discovery');
  signal?.throwIfAborted();
  // A catalog row that is still unverifiable after findOrCreateVenue (a legacy
  // row with country "United States" or no timezone) rejects this candidate.
  const catalogIssues = eventVenueIssues(venue, country);
  if (venue?.place_id && venue.place_id !== place.placeId) catalogIssues.push('catalog place_id differs from the provider place');
  if (catalogIssues.length) {
    throw new EventCandidateRejection('venue_resolution', 'venue_unverified', `catalog venue cannot be verified: ${catalogIssues.join('; ')}`);
  }
  return venue;
}

// A single verification path serves progressive cards and final persistence.
// Cache within this generation only: publishing progress never starts a second
// venue lookup, and final dedup still decides which verified candidates to save.
function createEventVerifier({ snapshot, todayStr, signal, progress }) {
  const normalizedBySource = new Map();
  const validation = new Map();
  const verification = new Map();
  const verified = new Map();
  const marketMembership = new Map();
  const key = event => JSON.stringify(event);

  function prepare(items) {
    signal?.throwIfAborted();
    progress.stage = 'validation';
    const normalized = items.map(source => {
      const sourceKey = key(source);
      if (!normalizedBySource.has(sourceKey)) normalizedBySource.set(sourceKey, {
        // 2026-04-04: FIX C-4 — Pass city/state context so normalizeEvent has
        // fallback location rather than empty strings that break event hashes.
        ...normalizeEvent(source, { city: snapshot.city, state: snapshot.state }),
        // The legacy normalizer defaults missing/unknown attendance to medium.
        // A demand estimate requires actual provider evidence at this boundary.
        expected_attendance: ['high', 'medium', 'low'].includes(source.expected_attendance || source.impact)
          ? (source.expected_attendance || source.impact) : null,
      });
      return normalizedBySource.get(sourceKey);
    });
    const unchecked = [...new Set(normalized.filter(event => !validation.has(event)))];
    if (unchecked.length) {
      // 2026-01-10: validateEventsHard returns {valid, invalid, stats}.
      // 2026-04-28: Rule 13 uses the driver's timezone, never server time.
      const { valid, invalid = [] } = validateEventsHard(unchecked, { context: { timezone: snapshot.timezone } });
      for (const event of unchecked) {
        const rejected = invalid.find(result => result.event === event);
        // Calendar exclusions wait for the verified venue's own timezone.
        if (valid.includes(event) || (rejected && DATE_WINDOW_REASONS.has(rejected.reason))) validation.set(event, null);
        else if (rejected) validation.set(event, { stage: 'validation', reason: rejected.reason,
          detail: `required field ${rejected.field} failed validation` });
        else throw new Error('Event validation returned no outcome for a candidate');
      }
    }
    const rejected = normalized.filter(event => validation.get(event)).map(event => ({ event, ...validation.get(event) }));
    const validEvents = normalized.filter(event => !validation.get(event));
    // 2026-06-11: Retain both dedup stages. Raw discovery dedup sees provider
    // titles; normalization can reveal new collisions. Hash-first is the cheap
    // exact pass before semantic matching of normalized, validated candidates.
    const hashDeduped = deduplicateEvents(validEvents);
    const { deduplicated: events } = deduplicateEventsSemantic(hashDeduped);
    return { events, rejected, duplicates: validEvents.length - events.length };
  }

  async function verify(event) {
    signal?.throwIfAborted();
    const eventKey = key(event);
    if (!verification.has(eventKey)) verification.set(eventKey, (async () => {
      progress.candidate = label(event.title);
      progress.stage = 'schedule';
      const inconsistency = scheduleInconsistency(event);
      if (inconsistency) return { rejection: { stage: 'schedule', reason: 'schedule_inconsistent', detail: inconsistency } };
      progress.stage = 'venue_resolution';
      let venue;
      try {
        venue = await withTimeout(requestSignal => resolveEventVenue(event, snapshot, requestSignal),
          EVENT_VENUE_TIMEOUT_MS, `Event venue: ${event.venue_name}`, signal);
      } catch (error) {
        signal?.throwIfAborted();
        return { rejection: venueRejection(error) };
      }
      signal?.throwIfAborted();
      progress.stage = 'schedule';
      const canonical = { ...event, venue_name: venue.venue_name, address: venue.formatted_address,
        city: venue.city, state: venue.state, venue_id: venue.venue_id };
      const projected = toBriefingEvent({ event: canonical, venue });
      const overlaps = eventOverlapsDisplayDays(projected, todayStr, todayStr, snapshot.timezone);
      if (overlaps === null) return { rejection: { stage: 'schedule', reason: 'schedule_inconsistent',
        detail: `${event.event_start_date} ${event.event_start_time} to ${event.event_end_date} ${event.event_end_time} cannot be resolved to an interval in ${venue.timezone}` } };
      if (!overlaps) return { outsideWindow: true };
      const result = { venue, projected };
      verified.set(eventKey, result);
      return result;
    })());
    const result = await verification.get(eventKey);
    signal?.throwIfAborted();
    return result;
  }

  return { prepare, verify, knownItems: async events => {
    const items = [];
    for (const event of events) {
      const result = verified.get(key(event));
      if (!result) continue;
      signal?.throwIfAborted();
      const venueId = result.venue.venue_id;
      if (!marketMembership.has(venueId)) {
        marketMembership.set(venueId, venueInSnapshotMarket(result.venue, snapshot));
      }
      const included = await marketMembership.get(venueId);
      signal?.throwIfAborted();
      if (included) items.push(result.projected);
    }
    return items;
  } };
}

/**
 * Primary entry point for event discovery + DB caching + read.
 *
 * Flow:
 *  1. deactivatePastEvents (timezone-aware) — soft-deactivate ended events
 *  2. fetchEventsWithGemini3ProPreview — parallel category discovery via Gemini
 *  3. validateEventsHard — strict field validation
 *  4. deduplicateEvents (HASH) → deduplicateEventsSemantic (semantic) — sequential dedup
 *  5. Verified name/locality cache → Places (NEW) API → provider geocode fallback
 *  6. INSERT into discovered_events with ON CONFLICT DO UPDATE (full content refresh)
 *  7. Read active country/metro events overlapping the driver day using venue-local instants
 *  8. Validate saved required content without reinterpreting venue clocks in the driver zone
 *  9. Return { items, reason, provider }
 *
 * 2026-09-29: steps 3 to 6 reject an unverifiable candidate alone and continue.
 * Step 7 excludes and counts a saved row whose schedule cannot be resolved. The
 * result also carries `candidates`: { discovered, duplicates, accepted,
 * outside_window, rejected, rejections[], rejected_candidates[], saved_excluded,
 * saved_invalid }, where discovered = duplicates + accepted + outside_window + rejected.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone/lat/lng required)
 * @param {{stage: string, candidate: string|null}} [args.progress] - updated as the
 *   pipeline advances so the caller can log the stage that failed
 * @param {function(Array): Promise<void>} [args.onProgress] - receives verified
 *   eligible cards while discovery continues; never indicates completion
 * @returns {Promise<{items: Array, reason: string|null, provider: string}>}
 */
export async function fetchEventsForBriefing({ snapshot, signal, progress = { stage: 'preflight', candidate: null }, onProgress } = {}) {
  signal?.throwIfAborted();
  if (!snapshot) {
    throw new Error('Snapshot is required for events fetch');
  }

  const { city, state, timezone } = snapshot;

  // 2026-06-11: Fail loud on missing timezone. Both the DB date-window (todayStr/endDateStr
  // below) and Rule 13 inside validateEventsHard are timezone-dependent; a missing tz used to
  // silently fall back to UTC, which mis-truncates AHEAD-tz drivers (JST/AEST/Kiritimati) for
  // a 9–14h window each day (memory #255). snapshot.timezone is NOT NULL in schema and the
  // readiness gate (memory #111) blocks briefing until it is populated, so this guard should
  // never fire in practice — it surfaces a data-integrity bug instead of hiding it (NO FALLBACKS).
  if (!timezone) {
    throw new Error('fetchEventsForBriefing requires snapshot.timezone — NO FALLBACKS (date window + Rule 13 are tz-dependent)');
  }

  if (!/^[A-Za-z]{2}$/.test(snapshot.country || '') || !city || !state) {
    throw new Error('fetchEventsForBriefing requires snapshot country/city/state');
  }

  // 2026-02-17: FIX Issue 3 — Deactivate past events before discovery
  // Soft-deactivates events that have ended (is_active = false, deactivated_at = NOW())
  // 2026-09-13: Each event resolves through its own venue_catalog.timezone; one driver's
  // timezone can no longer expire (or preserve) events in other markets.
  // Non-fatal: cleanup failure doesn't block event discovery
  // 2026-03-28: ARCHITECTURE NOTE — Cleanup is intentionally opportunistic (per-briefing-fetch).
  // No cron dependency. If scheduled cleanup is needed later for dashboard accuracy when
  // no users are active, call the same per-venue-timezone cleanup from that scheduler.
  progress.stage = 'cleanup';
  const deactivated = await deactivatePastEvents();
  signal?.throwIfAborted();
  if (deactivated > 0) {
    briefingLog.phase(2, `Cleaned up ${deactivated} past events`, OP.DB);
  }

  // 2026-06-11: Opportunistic event-lifecycle hygiene, ordered so each step sees the
  // prior step's results: (1) deactivate ended events (above), (2) collapse cross-day
  // duplicate spans of the same run (e.g. 6 "Wicked" rows), (3) clear is_event_venue tags
  // on venues left with no active event. All soft (deactivate / flag-off) — never delete a
  // venue. Each is non-fatal and returns 0 on error so cleanup can't block discovery.
  await collapseDuplicateEventSpans();
  signal?.throwIfAborted();
  await clearOrphanedEventVenueTags();
  signal?.throwIfAborted();

  // 2026-04-04: FIX C-5 — Use user's timezone for date range, not UTC
  // Previously used toISOString() which is UTC-based. A driver in UTC-8 at 11PM local
  // would get tomorrow's UTC date as "today", misaligning the 7-day event window.
  // toLocaleDateString('en-CA') returns YYYY-MM-DD format in the correct timezone.
  // 2026-06-11: timezone guaranteed by the guard above — UTC ternary fallback removed.
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: timezone });

  // 2026-01-10: Consolidated event discovery using Briefer model with Google Search tools
  // Simpler pipeline, lower cost, cleaner data - model-agnostic (configured via BRIEFING_EVENTS_MODEL)
  briefingLog.phase(2, `Event discovery for ${city}, ${state} (${todayStr})`, OP.AI);

  let discoveryReason = null;
  const candidates = createCandidateLedger();
  const verifier = createEventVerifier({ snapshot, todayStr, signal, progress });
  const completedCategories = new Map();
  let publishedItems = '[]';
  const onCategory = onProgress ? async result => {
    completedCategories.set(result.category, result);
    // Keep the historical category order even when the responses arrive in the
    // opposite order, then reapply the same combined raw and normalized dedup.
    const completed = EVENT_CATEGORIES.map(category => completedCategories.get(category.name)).filter(Boolean);
    const merged = mergeEventCategoryResults(completed);
    const prepared = verifier.prepare(merged.items);
    const impactRank = { high: 3, medium: 2, low: 1 };
    const verificationOrder = [...prepared.events].sort((a, b) =>
      (impactRank[b.expected_attendance] || 0) - (impactRank[a.expected_attendance] || 0));
    for (const event of verificationOrder) {
      await verifier.verify(event);
      signal?.throwIfAborted();
      const items = prioritizeBriefingEvents(await verifier.knownItems(prepared.events), snapshot);
      const serialized = JSON.stringify(items);
      if (serialized !== publishedItems) {
        await onProgress(items);
        signal?.throwIfAborted();
        publishedItems = serialized;
      }
    }
    progress.stage = 'discovery';
    progress.candidate = null;
  } : undefined;
  progress.stage = 'discovery';
  try {
    // Run parallel category search using configured Briefer model
    const discoveryResult = await fetchEventsWithGemini3ProPreview({ snapshot, signal, date: todayStr, onCategory });
    discoveryReason = discoveryResult.reason;
    candidates.counts.discovered = discoveryResult.found;
    candidates.counts.duplicates = discoveryResult.duplicates;
    for (const rejection of discoveryResult.rejected) candidates.reject(rejection.event, rejection);

    if (discoveryResult.items && discoveryResult.items.length > 0) {
      briefingLog.done(2, `Events: ${discoveryResult.items.length} discovered`, OP.AI);

      const prepared = verifier.prepare(discoveryResult.items);
      for (const rejection of prepared.rejected) candidates.reject(rejection.event, rejection);
      candidates.counts.duplicates += prepared.duplicates;

      for (const event of prepared.events) {
        progress.candidate = label(event.title);
        const verified = await verifier.verify(event);
        if (verified.rejection) {
          candidates.reject(event, verified.rejection);
          continue;
        }
        if (verified.outsideWindow) {
          candidates.counts.outside_window++;
          discoveryReason = 'No events remained within the current date window';
          continue;
        }
        const resolvedVenue = verified.venue;
        const venueId = resolvedVenue.venue_id;
        const resolvedAddress = resolvedVenue.formatted_address;
        const resolvedCity = resolvedVenue.city;
        const resolvedState = resolvedVenue.state;

        // Stage: persistence. A failure here is a real storage failure.
        progress.stage = 'persistence';
        try {
          // Hash the resolved identity, never the model's guessed locality.
          const canonicalEvent = { ...event, venue_name: resolvedVenue.venue_name,
            address: resolvedAddress, city: resolvedCity, state: resolvedState, venue_id: venueId };
          const hash = generateEventHash(canonicalEvent);

          // 2026-06-11: Write-time root-cause guard for duplicate multi-day spans. If an
          // active overlapping same-venue + title-match span already exists (e.g. this run
          // re-discovered on a later day with a different start), extend it and skip the
          // insert instead of creating another hash row. collapseDuplicateEventSpans()
          // stays as the after-the-fact safety net for anything this misses (e.g. a venue
          // that resolved to a different venue_id across discoveries).
          await withEventVenueLock(venueId, async tx => {
          signal?.throwIfAborted();
          const mergedSpanId = await mergeIntoOverlappingActiveSpan({
            venueId,
            title: event.title,
            startDate: event.event_start_date,
            endDate: event.event_end_date,
            startTime: event.event_start_time, endTime: event.event_end_time,
          }, tx);
          signal?.throwIfAborted();
          if (mergedSpanId) {
            briefingLog.info(`Merged "${event.title?.slice(0, 40)}" into active span ${mergedSpanId.slice(0, 8)} (skipped duplicate multi-day insert)`);
            return;
          }

          const storedHash = await resolveEventWriteHash(tx, canonicalEvent, hash);
          signal?.throwIfAborted();
          // Store event with venue_catalog truth (city/address from Places (NEW) API, not Gemini guess)
          await tx.insert(discovered_events).values({
            title: event.title,
            venue_name: resolvedVenue.venue_name,
            address: resolvedAddress,
            city: resolvedCity,
            state: resolvedState,
            venue_id: venueId,  // 2026-01-14: FIX - Link to venue_catalog for coords/map
            event_start_date: event.event_start_date,
            event_start_time: event.event_start_time,
            event_end_time: event.event_end_time,
            event_end_date: event.event_end_date,
            category: event.category,  // Already normalized
            expected_attendance: event.expected_attendance,  // Already normalized
            // 2026-01-14: Removed source_model - column removed from schema (all events from Gemini)
            event_hash: storedHash,
            // 2026-04-14: Stamp current validation version — enables skipping read-time revalidation
            schema_version: VALIDATION_SCHEMA_VERSION,
          }).onConflictDoUpdate({
            target: discovered_events.event_hash,
            // 2026-04-04: FIX H-6 — Update all content fields on conflict, not just timestamp.
            // Previously only updated updated_at + venue_id, silently dropping corrected data
            // (title, times, venue name) from re-discovery.
            // 2026-04-11: FIX — Use resolved venue data for address/city/state on conflict too.
            // Previously used raw event.address on conflict, bypassing Places (NEW) API resolution.
            set: {
              title: event.title,
              venue_name: resolvedVenue.venue_name,
              address: resolvedAddress,
              city: resolvedCity,
              state: resolvedState,
              event_start_date: event.event_start_date,
              event_start_time: event.event_start_time,
              event_end_time: event.event_end_time,
              event_end_date: event.event_end_date,
              category: event.category,
              expected_attendance: event.expected_attendance,
              venue_id: venueId || discovered_events.venue_id,
              ...discoveryReactivationFields(),
              schema_version: VALIDATION_SCHEMA_VERSION,
              updated_at: sql`NOW()`
            }
          });
          signal?.throwIfAborted();
          }, { refreshTag: true });
        } catch (insertErr) {
          // A cancelled write was rolled back on request; it is not a storage failure.
          signal?.throwIfAborted();
          throw reportStageFailure('persistence', new Error('Events database persistence failed', { cause: insertErr }),
            `Saving "${progress.candidate}" at "${label(resolvedVenue.venue_name)}" `);
        }
        candidates.counts.accepted++;
      }
      progress.candidate = null;
    }
  } catch (pipelineErr) {
    // 2026-09-29: this catch also covers the write loop, so the log names the
    // stage that failed instead of calling every failure a discovery failure.
    if (pipelineErr === null || typeof pipelineErr !== 'object' || !reportedFailures.has(pipelineErr)) {
      reportStageFailure(progress.stage, pipelineErr, progress.candidate ? `"${progress.candidate}" ` : '');
    }
    throw pipelineErr;
  }

  // One shared saved-event reader scopes by country + canonical metro before
  // limiting, resolves venue-local instants, and preserves cross-state markets.
  progress.stage = 'saved_read';
  progress.candidate = null;
  let rows, unresolvedCount;
  try {
    signal?.throwIfAborted();
    ({ rows, unresolvedCount } = await readMarketEvents(snapshot, { today: todayStr }));
  } catch (dbErr) {
    // Caller cancellation is not a database failure.
    signal?.throwIfAborted();
    throw reportStageFailure('saved_read', new Error('Events database read failed', { cause: dbErr }), 'Reading saved market events ');
  }
  signal?.throwIfAborted();
  if (unresolvedCount) {
    // 2026-09-29: exclude and count. One saved row whose venue has no usable
    // timezone, or whose end precedes its start, used to fail the read for the
    // whole market. The row stays saved, is not shown, and is reported.
    candidates.counts.saved_excluded = unresolvedCount;
    briefingLog.warn(2, `[EVENTS] [stage=saved_read] ${candidateNote({ saved_excluded: unresolvedCount })} ` +
      '(venue timezone missing or invalid, or the end precedes the start). The shared reader reports a count only.', OP.DB);
  }
  const verifiedEvents = rows.map(toBriefingEvent).filter(event => {
    const result = validateEventsHard([event], { context: { timezone: event.timezone } });
    // Calendar overlap was already established using absolute venue instants.
    const usable = result.valid.length > 0 || (result.invalid.length === 1 && DATE_WINDOW_REASONS.has(result.invalid[0].reason));
    if (!usable) candidates.counts.saved_invalid++;
    return usable;
  });
  const cleanEvents = prioritizeBriefingEvents(verifiedEvents, snapshot);
  briefingLog.done(2, `Events: ${cleanEvents.length} from current country/metro`, OP.DB);

  const summary = candidates.summary();
  const note = candidateNote(summary);
  const empty = cleanEvents.length ? null : verifiedEvents.length
    ? 'No verified high-value events near this location or major crowd draws in this market.'
    : rows.length
    ? 'No events remained after required-field validation'
    : discoveryReason || (note ? 'No verified events for this location' : 'No events found for this location');
  const reason = note
    ? [empty, note].filter(Boolean).map(text => text.replace(/[.\s]+$/, '')).join('. ') + '.'
    : empty;
  return { items: cleanEvents, reason, provider: 'discovered_events', candidates: summary };
}

/**
 * Pipeline contract: discover events for a snapshot.
 *
 * Calls fetchEventsForBriefing (full discovery + DB caching + read pipeline), wraps the
 * {items, reason, provider} result into the section shape, writes the events section to
 * the briefings row, fires CHANNELS.EVENTS pg_notify, returns { events, reason }.
 *
 * Special case: events SSE-write shape is polymorphic — when items > 0, the section
 * is the array directly; when empty, it's a {items, reason} object. The wider
 * pipeline contract wraps both forms in a {events: ..., reason} envelope.
 * While searches/verification continue, known cards use {items, _pending:true}.
 * On a later failure, known cards use {items, _generationFailed:true, ...} and
 * return to reconciliation with that marker intact. Neither is ready data.
 *
 * fetchEventsForBriefing reports provider/storage failures by stage and throws.
 * This wrapper preserves verified progress on those failures; failures without
 * eligible cards and cancellation still throw to the orchestrator's allSettled.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone/lat/lng required)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ events: object|Array, reason: string|null }>}
 */
export async function discoverEvents({ snapshot, snapshotId, signal }) {
  let events;
  let reason = null;
  let verifiedItems = [];

  if (!snapshot) {
    const err = new Error('Snapshot required for events');
    await writeSectionAndNotify(snapshotId, { events: errorMarker(err) }, CHANNELS.EVENTS);
    throw err;
  }

  const progress = { stage: 'preflight', candidate: null };
  try {
    const r = await fetchEventsForBriefing({ snapshot, signal, progress, onProgress: async items => {
      signal?.throwIfAborted();
      verifiedItems = items;
      await writeSectionAndNotify(snapshotId, { events: { items, _pending: true,
        reason: 'Event searches and verification are still in progress.' } }, CHANNELS.EVENTS);
    } });
    signal?.throwIfAborted();
    progress.stage = 'section_contract';
    if (!Array.isArray(r?.items)) throw new Error('Event discovery returned an invalid response');
    const items = r.items;

    // Reject explicit failure metadata even if results also exist.
    if (r?.discoveryFailed || r?.timedOutCount > 0 || r?.erroredCount > 0) {
      throw new Error(r.reason || 'Event discovery failed');
    }

    // 2026-09-29: the candidate summary travels with the section. With no items
    // it is saved beside the reason. With items the saved column stays a bare
    // array, which is the shape Strategy and the Briefing readers accept.
    const candidates = r?.candidates ? { candidates: r.candidates } : {};
    events = {
      items,
      reason: r?.reason || (items.length === 0 ? 'No events found for this area' : null),
      ...candidates
    };
    reason = events.reason;

    // Match orchestrator's prior SSE-write shape: array if items, {items, reason} object if empty
    const sseWriteValue = items.length > 0 ? items : { items: [], reason: events.reason, ...candidates };
    progress.stage = 'section_write';
    await writeSectionAndNotify(snapshotId, { events: sseWriteValue }, CHANNELS.EVENTS);
  } catch (err) {
    // 2026-09-29: the saved marker holds a driver-safe sentence only, and the real
    // cause lived in err.cause, which nothing logged. Log the stage and the cause.
    if (err === null || typeof err !== 'object' || !reportedFailures.has(err)) {
      reportStageFailure(progress.stage, err, progress.candidate ? `"${progress.candidate}" ` : '');
    }
    events = { ...(verifiedItems.length ? { items: verifiedItems } : {}), ...errorMarker(err) };
    reason = events.error;
    await writeSectionAndNotify(snapshotId, { events }, CHANNELS.EVENTS);
    // Known verified cards survive a later search/storage failure. The marker
    // still blocks readiness; cancellation keeps its original throw semantics.
    if (verifiedItems.length && !signal?.aborted) return { events, reason };
    throw err;
  }

  return { events, reason };
}
