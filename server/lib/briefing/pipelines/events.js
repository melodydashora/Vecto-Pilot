// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 8/11).
// Owns: events section of the briefings row + briefing_events_ready pg_notify channel.
// Plus the discovered_events DB table writes (post-discovery, post-validation, post-dedup).
//
// Live path (verified via call-graph recon — see claude_memory #297):
//   fetchEventsForBriefing → fetchEventsWithGemini3ProPreview → fetchEventCategory (parallel x N)
//                          → validateEventsHard → deduplicateEvents (HASH, Rule 16)
//                          → deduplicateEventsSemantic → venue resolution → discovered_events INSERT
//                          → DB read → filterInvalidEvents → return
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
import { db } from '../../../db/drizzle.js';
import { discovered_events, venue_catalog } from '../../../../shared/schema.js';
import { eq, and, sql, gte, lte, isNotNull } from 'drizzle-orm';
import { validateEventsHard, VALIDATION_SCHEMA_VERSION } from '../../events/pipeline/validateEvent.js';
import { normalizeEvent } from '../../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../../events/pipeline/hashEvent.js';
import { deduplicateEventsSemantic } from '../../events/pipeline/deduplicateEventsSemantic.js';
import { findOrCreateVenue, lookupVenue } from '../../venue/venue-cache.js';
import { geocodeEventAddress } from '../../events/pipeline/geocodeEvent.js';
import { searchPlaceWithTextSearch } from '../../venue/venue-address-resolver.js';
import { validateVenueAddress } from '../../venue/venue-address-validator.js';
import { deactivatePastEvents } from '../cleanup-events.js';

// Per-category Gemini search timeout. Each category runs in parallel; total fan-out
// time is bounded by max(category_timeouts), not sum, since they're Promise.all'd.
const EVENT_SEARCH_TIMEOUT_MS = 90000; // 90 seconds per category search (Gemini + thinking needs time)

/**
 * 2026-04-04: FIX H-5 — Enhanced withTimeout to:
 * 1. Clear timer when promise resolves (was leaking timers)
 * 2. Signal AbortController on timeout so callers can cancel in-flight work
 * Note: H-2 (120s global router timeout) limits max wasted time even without abort support.
 *
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for logging purposes
 * @returns {Promise} - Resolves with either the original result or a timeout error
 */
function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  const controller = new AbortController();
  let timer;

  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      briefingLog.warn(2, `${operationName} timed out after ${timeoutMs}ms - returning empty`, OP.AI);
      controller.abort();
      resolve({ timedOut: true, error: `Timeout after ${timeoutMs}ms` });
    }, timeoutMs);
  });

  // Wrap the original promise to clear timer on completion
  const wrappedPromise = promise.then(
    (result) => { clearTimeout(timer); return result; },
    (error) => { clearTimeout(timer); throw error; }
  );

  return Promise.race([wrappedPromise, timeoutPromise]);
}

/**
 * HYBRID EVENT CATEGORIES - 2 focused searches instead of 5 for better cost/quality balance
 * 2026-02-01: Consolidated from 5 categories to 2 (60% cost reduction, same quality)
 * 2026-02-01: Now uses MARKET (not city) for broader event coverage
 *
 * Split rationale:
 * - high_impact: Big venues that generate surge demand (stadiums, arenas, concert halls)
 * - local_entertainment: Smaller venues, local events (bars, comedy clubs, community)
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
    description: 'Local nightlife and community events',
    searchTerms: (market, state, date) => `comedy shows live music bars nightlife community events ${market} ${state} ${date} trivia karaoke DJ local entertainment`,
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
      .toLowerCase()
      .replace(/["'"]/g, '')                          // Remove quotes
      // 2026-01-31: Strip common event prefixes that create duplicates
      .replace(/^(live music|live band|concert|show|event|performance|dj set|acoustic):\s*/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')              // Remove (parenthetical content)
      .replace(/\s+(at|in|from|@)\s+.+$/i, '')       // Remove "at Cosm", "in Shared Reality" suffixes
      .replace(/[^a-z0-9\s]/g, ' ')                  // Remove special chars
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
    return `${name}|${addr}|${time}`;
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
 *   2. server/lib/briefing/pipelines/events.js (this file, internal use in fetchEventsForBriefing)
 *   3. server/lib/briefing/dump-last-briefing.js — imported at line 8
 *
 * @param {Array} events - Array of events to filter
 * @param {Object} [options={}] - Options
 * @param {string} [options.timezone] - IANA timezone for Rule 13. When omitted,
 *   falls back to UTC (backwards-compat). Pass `snapshot.timezone` from callers.
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
async function fetchEventCategory({ category, city, state, market, lat, lng, date, timezone }) {
  const maxEvents = category.maxEvents || 8;
  // 2026-04-16: market is authoritative; placeholder surfaces unresolved markets in prompts
  const searchArea = market || '[unknown-market]';

  // 2026-02-26: Simplified prompt — today only, strict required fields, place_id for venue linking.
  // Gemini has native Google Places knowledge via google_search grounding.
  // 2026-04-14: Inject driver GPS for proximity-biased discovery (Memory #107). Previously
  // the search was metro-wide with no proximity bias, so drivers in suburbs got events
  // 30-60mi away in the far corners of the metro. lat/lng were already parameters but
  // never reached the prompt.
  const prompt = `Find ${category.description || category.name.replace('_', ' ')} happening TODAY (${date}) in the ${searchArea} metro area.

The driver is currently near coordinates (${lat.toFixed(6)}, ${lng.toFixed(6)}). Prioritize discovering events at venues within 15 miles of these coordinates first. Then include the most impactful events from the broader ${searchArea} area.

SEARCH: "${category.searchTerms(searchArea, state, date)}"
EVENT TYPES: ${category.eventTypes.join(', ')}

Return JSON array (max ${maxEvents} events). EVERY field below is REQUIRED — events missing any field will be rejected:
[{
  "title": "Event Name",
  "venue": "Venue Name",
  "place_id": "ChIJ...",
  "address": "Full Street Address, City, State",
  "category": "${category.eventTypes[0]}",
  "event_start_date": "${date}",
  "event_start_time": "7:00 PM",
  "event_end_time": "10:00 PM",
  "event_end_date": "${date}",
  "impact": "high|medium|low"
}]

RULES:
- TODAY ONLY — date must be ${date}. Multi-day events active today are included.
- place_id: The Google Places ID for the venue (starts with "ChIJ"). Use your knowledge of Google Places to provide this. If truly unknown, use "unknown".
- category: MUST be one of: concert, sports, comedy, theater, festival, nightlife, convention, community
- ALL 4 date/time fields REQUIRED — estimate times if unknown (Sports=3h, Concert=3h, Festival=4h, Nightlife=4h)
- Search the ENTIRE ${searchArea.toUpperCase()} metro, not just ${city}
- Prioritize high-attendance events that generate rideshare demand
- Return [] if no events today.`;

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
    const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user: prompt });

    if (!result.ok) {
      matrixLog.error({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'EVENTS',
        location: 'pipelines/events.js:fetchEventCategory',
      }, 'Briefer call failed', result.error);
      return { category: category.name, items: [], error: result.error };
    }

    const parsed = safeJsonParse(result.output);
    const items = Array.isArray(parsed) ? parsed : [];
    return { category: category.name, items: items.filter(e => e.title && e.venue) };
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
async function fetchEventsWithGemini3ProPreview({ snapshot }) {
  // 2026-01-09: Require ALL location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data (city/state/timezone) - cannot fetch events', OP.AI);
    return { items: [], reason: 'Location data not available (missing timezone)' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot.timezone;  // NO FALLBACK - timezone is required

  // Use local_iso if available, otherwise compute local date from timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // 2026-04-16: Resolve market — snapshot.market is authoritative, DB lookup is fallback
  // for older snapshots. Null means genuinely unknown; callers handle the placeholder.
  const market = snapshot.market || await getMarketForLocation(city, state);
  if (!market) {
    briefingLog.warn(2, `No market resolved for ${city}, ${state} — event search will use [unknown-market] placeholder`, OP.AI);
  }

  // 2026-02-26: Gemini-only for event discovery. Cross-provider fallback to Claude/GPT
  // returned data in incompatible formats causing more parsing failures than it solved.
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.error(2, `GEMINI_API_KEY not set - cannot fetch events`, null, OP.AI);
    return { items: [], reason: 'GEMINI_API_KEY required for event discovery' };
  }

  briefingLog.ai(2, 'Gemini', `events for ${market || '[unknown-market]'} market (driver in ${city}) - 2 focused searches (90s timeout each)`);

  // PARALLEL CATEGORY SEARCHES - 2 focused searches (high_impact + local_entertainment)
  // Each category runs independently, results are merged and deduplicated
  // 2026-02-01: Now searches entire market, not just driver's city
  const startTime = Date.now();

  const categoryPromises = EVENT_CATEGORIES.map(category =>
    withTimeout(
      fetchEventCategory({ category, city, state, market, lat, lng, date, timezone }),
      EVENT_SEARCH_TIMEOUT_MS,
      `Event search: ${category.name}`
    )
  );

  const categoryResults = await Promise.all(categoryPromises);

  // Merge results from all categories
  // 2026-04-11: Two-phase merge — exact title dedup first, then semantic title-similarity dedup
  const rawEvents = [];
  const seenTitles = new Set();
  let totalFound = 0;
  let timedOutCount = 0;

  for (const result of categoryResults) {
    // 2026-01-15: Handle timeout results - treat as empty with warning
    if (result.timedOut) {
      timedOutCount++;
      continue;
    }
    totalFound += result.items?.length || 0;
    for (const event of result.items || []) {
      // Phase 1: Exact title dedup (cheap, catches identical titles from different categories)
      const titleKey = event.title?.toLowerCase().trim();
      if (titleKey && !seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        rawEvents.push(event);
      }
    }
    if (result.error) {
      briefingLog.warn(2, `Category ${result.category} failed: ${result.error}`, OP.AI);
    }
  }

  if (timedOutCount > 0) {
    briefingLog.warn(2, `${timedOutCount}/${EVENT_CATEGORIES.length} category searches timed out`, OP.AI);
  }

  // 2026-04-11: Phase 2 — Title-similarity dedup. Catches:
  // - "Jon Wolfe Concert" / "Jon Wolfe Live" / "Jon Wolfe" (title variants)
  // - "Fatboy Slim" at SILO Dallas + "Fatboy Slim" at Globe Life Field (wrong stadium assignment)
  // Prefers specific venues over stadiums, longer titles over shorter.
  const { deduplicated: allEvents, removed: semanticRemoved, mergeLog } =
    deduplicateEventsSemantic(rawEvents);

  if (semanticRemoved.length > 0) {
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

  const elapsedMs = Date.now() - startTime;
  briefingLog.done(2, `Gemini: ${allEvents.length} unique events (${totalFound} total from 2 searches) in ${elapsedMs}ms`, OP.AI);

  // 2026-02-26: No cross-provider fallback. If Gemini returns 0, return empty.
  // The Strategist AI can flag gaps; a second LLM returning different JSON made things worse.
  if (allEvents.length === 0) {
    return { items: [], reason: 'No events found across all categories', provider: 'gemini' };
  }

  return { items: allEvents, reason: null, provider: 'gemini' };
}

/**
 * Primary entry point for event discovery + DB caching + read.
 *
 * Flow:
 *  1. deactivatePastEvents (timezone-aware) — soft-deactivate ended events
 *  2. fetchEventsWithGemini3ProPreview — parallel category discovery via Gemini
 *  3. validateEventsHard — strict field validation
 *  4. deduplicateEvents (HASH) → deduplicateEventsSemantic (semantic) — sequential dedup
 *  5. Per-event venue resolution: place_id cache → Places (NEW) API → geocode fallback
 *  6. INSERT into discovered_events with ON CONFLICT DO UPDATE (full content refresh)
 *  7. Read events for state + multi-day window from discovered_events JOIN venue_catalog
 *  8. filterInvalidEvents (timezone-aware Rule 13 today-check) — read-path defense
 *  9. Return { items, reason, provider }
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone/lat/lng required)
 * @returns {Promise<{items: Array, reason: string|null, provider: string}>}
 */
export async function fetchEventsForBriefing({ snapshot } = {}) {
  if (!snapshot) {
    throw new Error('Snapshot is required for events fetch');
  }

  const { city, state, lat, lng, timezone } = snapshot;

  // 2026-02-17: FIX Issue 3 — Deactivate past events before discovery
  // Soft-deactivates events that have ended (is_active = false, deactivated_at = NOW())
  // Uses snapshot timezone for accurate "now" calculation — NO FALLBACKS
  // Non-fatal: cleanup failure doesn't block event discovery
  // 2026-03-28: ARCHITECTURE NOTE — Cleanup is intentionally opportunistic (per-briefing-fetch).
  // No cron dependency. If scheduled cleanup is needed later for dashboard accuracy when
  // no users are active, add a cron job calling deactivatePastEvents() per market timezone.
  if (timezone) {
    const deactivated = await deactivatePastEvents(timezone);
    if (deactivated > 0) {
      briefingLog.phase(2, `Cleaned up ${deactivated} past events`, OP.DB);
    }
  }

  // 2026-04-04: FIX C-5 — Use user's timezone for date range, not UTC
  // Previously used toISOString() which is UTC-based. A driver in UTC-8 at 11PM local
  // would get tomorrow's UTC date as "today", misaligning the 7-day event window.
  // toLocaleDateString('en-CA') returns YYYY-MM-DD format in the correct timezone.
  const today = new Date();
  const todayStr = timezone
    ? today.toLocaleDateString('en-CA', { timeZone: timezone })
    : today.toISOString().split('T')[0];
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const endDateStr = timezone
    ? weekFromNow.toLocaleDateString('en-CA', { timeZone: timezone })
    : weekFromNow.toISOString().split('T')[0];

  // 2026-01-10: Consolidated event discovery using Briefer model with Google Search tools
  // Simpler pipeline, lower cost, cleaner data - model-agnostic (configured via BRIEFING_EVENTS_MODEL)
  briefingLog.phase(2, `Event discovery for ${city}, ${state} (${todayStr})`, OP.AI);

  try {
    // Run parallel category search using configured Briefer model
    const discoveryResult = await fetchEventsWithGemini3ProPreview({ snapshot });

    if (discoveryResult.items && discoveryResult.items.length > 0) {
      briefingLog.done(2, `Events: ${discoveryResult.items.length} discovered`, OP.AI);

      // Store discovered events in DB for caching and SmartBlocks integration
      // Note: This uses the canonical ETL pipeline for validation/normalization
      // 2026-04-04: FIX C-4 — Pass city/state context so normalizeEvent has fallback location
      // Without context, events from AI responses missing city/state fields get empty strings,
      // breaking downstream filtering and event hash consistency
      const normalized = discoveryResult.items.map(e => normalizeEvent(e, { city, state }));
      // 2026-01-10: validateEventsHard returns { valid, invalid, stats } - extract .valid array
      // 2026-04-28: thread snapshot.timezone so Rule 13 today-check uses driver's local tz
      // (spec §9.2 — global-app correctness for far-east / Hawaii callers near midnight UTC)
      const { valid: validatedEvents } = validateEventsHard(normalized, {
        context: { timezone: timezone }
      });

      const hashDeduped = deduplicateEvents(validatedEvents);
      const { deduplicated: semanticDeduped } = deduplicateEventsSemantic(hashDeduped);
      console.log(
        `[BRIEFING] [EVENTS] [DEDUP] [WRITE] ` +
        `hash: ${validatedEvents.length} → ${hashDeduped.length}, ` +
        `semantic: ${hashDeduped.length} → ${semanticDeduped.length} ` +
        `(pre-insert dedup before per-event upsert)`
      );

      for (const event of semanticDeduped) {
        try {
          const hash = generateEventHash(event);

          // 2026-04-10: Venue Resolution via Google Places (NEW) API (New).
          // Google Places is the ONLY source of truth for venue addresses, coordinates, and cities.
          // Priority chain: (a) place_id cache hit → (b) Places (NEW) API search → (c) geocode fallback
          let venueId = null;
          let resolvedVenue = null;  // Will hold venue_catalog record with authoritative data

          if (event.venue_name) {
            try {
              let placeId = event.place_id || null;

              // Step (a): If Gemini returned a place_id, check venue_catalog cache
              if (placeId && placeId.startsWith('ChIJ')) {
                const cached = await lookupVenue({ placeId });
                if (cached && cached.formatted_address && cached.lat && cached.lng) {
                  // Venue exists with complete Places (NEW) API data — use it directly
                  resolvedVenue = cached;
                  venueId = cached.venue_id;
                  briefingLog.info(`Cache hit (place_id) for "${event.venue_name}": ${cached.venue_name}`);
                }
                // If cached but MISSING formatted_address/lat/lng, fall through to step (b)
              }

              // Step (b): No cached venue — resolve via Google Places (NEW) API (New)
              // Uses snapshot lat/lng as location bias with 50km radius for metro-wide discovery
              if (!resolvedVenue) {
                const placeResult = await searchPlaceWithTextSearch(lat, lng, event.venue_name, { radius: 50000 });

                if (placeResult) {
                  // Places (NEW) API returned authoritative venue data
                  const venue = await findOrCreateVenue({
                    venue: event.venue_name,
                    address: placeResult.formattedAddress,
                    latitude: placeResult.lat,
                    longitude: placeResult.lng,
                    city: placeResult.parsed?.city || city,       // FROM PLACES API
                    state: placeResult.parsed?.state || state,     // FROM PLACES API
                    placeId: placeResult.placeId,
                    formattedAddress: placeResult.formattedAddress
                  }, 'briefing_discovery');

                  if (venue) {
                    resolvedVenue = venue;
                    venueId = venue.venue_id;
                    briefingLog.info(`Places (NEW) API resolved "${event.venue_name}" → "${venue.venue_name}" in ${placeResult.parsed?.city || '?'} (${venue.venue_id?.slice(0, 8)})`);
                  }
                } else {
                  // Step (c): Places (NEW) API returned nothing — fall back to geocode with snapshot context
                  const geocodeResult = await geocodeEventAddress(event.venue_name, city, state);
                  if (geocodeResult) {
                    const venue = await findOrCreateVenue({
                      venue: event.venue_name,
                      address: geocodeResult.formatted_address || event.address,
                      latitude: geocodeResult.lat,
                      longitude: geocodeResult.lng,
                      city: city,
                      state: state,
                      placeId: geocodeResult.place_id || placeId,
                      formattedAddress: geocodeResult.formatted_address
                    }, 'briefing_discovery');

                    if (venue) {
                      resolvedVenue = venue;
                      venueId = venue.venue_id;
                      briefingLog.info(`Geocode fallback for "${event.venue_name}" → ${venue.venue_id?.slice(0, 8)}`);
                    }
                  }
                }
              }

              // Flag venue as event venue if not already
              // 2026-04-18: Replaced silent catch with logged warning. Per CLAUDE.md
              // NO SILENT FAILURES rule: errors must reach logs even if non-fatal.
              if (resolvedVenue && resolvedVenue.is_event_venue !== true) {
                try {
                  await db.update(venue_catalog).set({ is_event_venue: true, updated_at: new Date() })
                    .where(eq(venue_catalog.venue_id, resolvedVenue.venue_id));
                } catch (flagErr) {
                  briefingLog.warn(2, `Failed to flag venue ${resolvedVenue.venue_id?.slice(0,8)} as event venue (non-fatal): ${flagErr.message}`, OP.DB);
                }
              }
            } catch (venueErr) {
              // Non-fatal - continue without link
              briefingLog.warn(2, `Venue link failed for "${event.venue_name}": ${venueErr.message}`, OP.DB);
            }
          }

          // 2026-04-11: Validate resolved venue address quality before storing.
          // If the venue's address is garbage (e.g., "Theatre, Frisco, TX 75034"),
          // log a warning. The venue-cache layer already re-resolves bad addresses,
          // so here we just validate the final result for monitoring.
          const resolvedAddress = resolvedVenue?.formatted_address || event.address;
          const resolvedCity = resolvedVenue?.city || city;
          const resolvedState = resolvedVenue?.state || state;

          if (resolvedVenue) {
            const { valid: addrValid, issues: addrIssues } = validateVenueAddress({
              formattedAddress: resolvedAddress,
              venueName: event.venue_name,
              lat: resolvedVenue.lat,
              lng: resolvedVenue.lng,
              city: resolvedCity
            });
            if (!addrValid) {
              briefingLog.warn(2, `[VENUE] Event "${event.title}" has low-quality venue address: "${resolvedAddress}" — ${addrIssues.join('; ')}`, OP.DB);
            }
          }

          // Store event with venue_catalog truth (city/address from Places (NEW) API, not Gemini guess)
          await db.insert(discovered_events).values({
            title: event.title,
            venue_name: event.venue_name,  // Keep Gemini's name for display
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
            event_hash: hash,
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
              venue_name: event.venue_name,
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
              is_active: true,
              schema_version: VALIDATION_SCHEMA_VERSION,
              updated_at: sql`NOW()`
            }
          });
        } catch (insertErr) {
          // Ignore individual insert errors (duplicates, etc.)
          if (!insertErr.message?.includes('duplicate')) {
            briefingLog.warn(2, `Event insert failed: ${insertErr.message}`, OP.DB);
          }
        }
      }
    }
  } catch (discoveryErr) {
    briefingLog.warn(2, `Event discovery failed: ${discoveryErr.message}`, OP.AI);
    // Continue - we can still read cached events from DB
  }

  // Read events from discovered_events table for this city/state and date range
  // 2026-01-14: JOIN with venue_catalog to get coordinates for map display
  try {
    // 2026-01-10: Use symmetric field names (event_start_date)
    // 2026-01-10: Added NOT NULL filters to exclude broken events from UI
    // 2026-01-14: LEFT JOIN with venue_catalog to get venue coordinates
    const events = await db.select({
      // Event fields
      id: discovered_events.id,
      title: discovered_events.title,
      venue_name: discovered_events.venue_name,
      address: discovered_events.address,
      city: discovered_events.city,
      state: discovered_events.state,
      venue_id: discovered_events.venue_id,
      event_start_date: discovered_events.event_start_date,
      event_start_time: discovered_events.event_start_time,
      event_end_time: discovered_events.event_end_time,
      // 2026-02-01: FIX - Add event_end_date (defaults to event_start_date for single-day events)
      event_end_date: discovered_events.event_end_date,
      category: discovered_events.category,
      expected_attendance: discovered_events.expected_attendance,
      // 2026-01-14: Removed source_model - column removed from schema
      // Venue coordinates from join (may be null if not linked)
      venue_lat: venue_catalog.lat,
      venue_lng: venue_catalog.lng,
      venue_address: venue_catalog.address
    })
      .from(discovered_events)
      .leftJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
      // 2026-04-10: FIX — Query by STATE (metro-wide), not city. Events now store their
      // actual venue city (e.g., "Fort Worth", "Arlington") so filtering by snapshot city
      // ("Dallas") would miss all metro events outside the driver's exact city.
      // 2026-04-28: FIX — multi-day-inclusive predicate. Was forward-only on event_start_date
      // (`gte(start_date, today) AND lte(start_date, horizon)`), which silently excluded
      // multi-day events that started before today (e.g. a 4-day festival running through
      // today was missed on day 2). Now: any event whose [start, end] window overlaps the
      // [today, horizon] window. Active-only filter still gates already-ended events
      // because deactivatePastEvents() runs first.
      .where(and(
        eq(discovered_events.state, state),
        lte(discovered_events.event_start_date, endDateStr),
        gte(discovered_events.event_end_date, todayStr),
        eq(discovered_events.is_active, true),
        // STRICT FILTER: Hide events with NULL times from UI
        isNotNull(discovered_events.event_start_time),
        isNotNull(discovered_events.event_end_time)
      ))
      .orderBy(discovered_events.event_start_date)
      .limit(50);

    console.log(
      `[BRIEFING] [EVENTS] [DB] [EVENTS_DISCOVERY] [READ] [ACTIVE-TODAY] [NEW EVENTS PIPELINE] ` +
      `state=${state}, today=${todayStr}, horizon=${endDateStr}, count=${events.length} — ` +
      `multi-day inclusive (start<=horizon AND end>=today)`
    );

    if (events.length > 0) {
      // Map discovered_events format to the briefing events format
      // 2026-01-10: DB columns are now event_start_date, event_start_time
      // 2026-01-14: Coordinates now come from linked venue_catalog (not deprecated event.lat/lng)
      // 2026-01-14: Removed source_model field entirely - all events come from Gemini Briefer
      // 2026-02-01: Added event_end_date (defaults to event_start_date for single-day events)
      const normalizedEvents = events.map(e => ({
        title: e.title,
        summary: [e.title, e.venue_name, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
        impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : 'medium',
        event_type: e.category,
        subtype: e.category, // For EventsComponent category grouping
        event_start_date: e.event_start_date,
        event_start_time: e.event_start_time,
        event_end_time: e.event_end_time,
        // 2026-02-01: FIX - Include event_end_date (defaults to event_start_date for single-day events)
        event_end_date: e.event_end_date || e.event_start_date,
        // 2026-01-14: Prefer venue address from catalog (more accurate)
        address: e.venue_address || e.address,
        venue: e.venue_name,
        location: e.venue_name ? `${e.venue_name}, ${e.venue_address || e.address || ''}`.trim() : e.address,
        // 2026-01-14: FIX - Get coordinates from linked venue (enables map pins!)
        latitude: e.venue_lat,
        longitude: e.venue_lng,
        // Include venue_id for debugging/linking verification
        venue_id: e.venue_id
      }));

      // 2026-01-08: HARD FILTER - Remove events with TBD/Unknown in critical fields
      // 2026-04-28: Thread timezone so the read-path Rule 13 today-check honors the
      // driver's local tz. Without this, AHEAD-timezone drivers (HST/JST/AEST/Kiritimati)
      // saw their own stored events stripped on every read during the 9-14h UTC window.
      const cleanEvents = filterInvalidEvents(normalizedEvents, { timezone });

      briefingLog.done(2, `Events: ${cleanEvents.length} from discovered_events table`, OP.DB);
      return { items: cleanEvents, reason: null, provider: 'discovered_events' };
    }

    briefingLog.info(`No events found for ${city}, ${state}`);
    return { items: [], reason: 'No events found for this location', provider: 'discovered_events' };
  } catch (dbErr) {
    briefingLog.error(2, `Events DB read failed: ${dbErr.message}`, dbErr, OP.DB);
    return { items: [], reason: `Database error: ${dbErr.message}`, provider: 'discovered_events' };
  }
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
 *
 * fetchEventsForBriefing's internal try/catch handles AI provider failures and DB
 * read errors — so the catch block here is defensive against unexpected sync/import
 * errors. Errors from missing snapshot context throw and propagate to allSettled.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone/lat/lng required)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ events: object|Array, reason: string|null }>}
 */
export async function discoverEvents({ snapshot, snapshotId }) {
  let events;
  let reason = null;

  if (!snapshot) {
    const err = new Error('Snapshot required for events');
    await writeSectionAndNotify(snapshotId, { events: errorMarker(err) }, CHANNELS.EVENTS);
    throw err;
  }

  try {
    const r = await fetchEventsForBriefing({ snapshot });
    const items = Array.isArray(r?.items) ? r.items : [];
    events = {
      items,
      reason: r?.reason || (items.length === 0 ? 'No events found for this area' : null)
    };
    reason = items.length > 0 ? null : (r?.reason || 'No events found for this area');

    // Match orchestrator's prior SSE-write shape: array if items, {items, reason} object if empty
    const sseWriteValue = items.length > 0 ? items : { items: [], reason: events.reason };
    await writeSectionAndNotify(snapshotId, { events: sseWriteValue }, CHANNELS.EVENTS);
  } catch (err) {
    events = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { events }, CHANNELS.EVENTS);
    throw err;
  }

  return { events, reason };
}
