
import { db } from '../../db/drizzle.js';
// 2026-02-17: Renamed market_cities → market_cities (market consolidation)
import { briefings, snapshots, discovered_events, market_cities, venue_catalog, discovered_traffic } from '../../../shared/schema.js';
import { eq, and, desc, sql, gte, lte, ilike, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
// 2026-02-17: Removed event-schedule-validator.js (dead code — Gemini handles all event discovery)
// 2026-01-10: Removed direct Anthropic import - use callModel adapter instead (D-016)
// 2026-02-11: Removed direct OpenAI and GoogleGenAI imports - all AI calls go through callModel adapter
// This ensures thinkingLevel, safety settings, and JSON cleanup are consistently applied
import { briefingLog, OP, matrixLog } from '../../logger/workflow.js';
// Centralized AI adapter - use for all model calls
import { callModel } from '../ai/adapters/index.js';
// Dump last briefing row to file for debugging
import { dumpLastBriefingRow } from './dump-last-briefing.js';

// 2026-05-02: Workstream 6 Step 1 — progressive write + pg_notify primitive
// extracted to a sibling so pipeline modules and the future aggregator both
// import from a single source of truth for channel names + the error wrapper.
import { writeSectionAndNotify, CHANNELS, errorMarker } from './briefing-notify.js';

// 2026-05-02: Workstream 6 Step 1 — shared utilities extracted (commit 2/11).
// Pipelines and aggregator import from these single-source modules.
import { safeJsonParse } from './shared/safe-json-parse.js';
import { getMarketForLocation } from './shared/get-market-for-location.js';
import { isDailyBriefingStale, isEventsStale, isTrafficStale, areEventsEmpty } from './shared/staleness.js';

// 2026-05-02: Workstream 6 Step 1 — schools pipeline extracted as the pilot (commit 3/11).
// fetchSchoolClosures re-exported below to preserve the public API surface.
import { discoverSchools, fetchSchoolClosures } from './pipelines/schools.js';
export { fetchSchoolClosures };

// 2026-05-02: Workstream 6 Step 1 — weather pipeline extracted (commit 4/11).
// fetchWeatherConditions re-exported below to preserve the public API surface
// (server/api/briefing/briefing.js imports it directly for refresh endpoints).
import { discoverWeather, fetchWeatherConditions } from './pipelines/weather.js';
export { fetchWeatherConditions };

// 2026-05-02: Workstream 6 Step 1 — airport pipeline extracted (commit 5/11).
// fetchAirportConditions and extractAirportJson are internal-only — no re-export
// needed (consolidator.js:652 only references the function name in a code COMMENT,
// not as an import).
import { discoverAirport } from './pipelines/airport.js';

// 2026-05-02: Workstream 6 Step 1 — news pipeline extracted (commit 6/11).
// fetchRideshareNews re-exported below to preserve the public API surface
// (server/api/briefing/briefing.js imports it directly for refresh endpoints,
// and refreshNewsInBriefing in this file uses it via the same binding).
// Two dead code paths deleted in this commit (Option A precedent — see
// claude_memory #294): fetchNewsWithClaudeWebSearch + consolidateNewsItems,
// both with zero callers.
import { discoverNews, fetchRideshareNews } from './pipelines/news.js';
export { fetchRideshareNews };

// 2026-05-02: Workstream 6 Step 1 — traffic pipeline extracted (commit 7/11).
// fetchTrafficConditions re-exported below to preserve the public API surface
// (server/api/briefing/briefing.js imports it directly for refresh endpoints,
// and refreshTrafficInBriefing in this file uses it via the same binding).
// Hybrid drift resolution (claude_memory #294 dead-code precedent + commit 5
// airport private-helper precedent): analyzeTrafficWithAI moved to pipelines/traffic.js
// as a private helper. The resume plan §3 commit 7 wording flagged it as
// potential cross-pollution, but the call graph showed its only caller is
// fetchTrafficConditions (live traffic path). It was misplaced in the file
// but semantically a pure traffic helper.
import { discoverTraffic, fetchTrafficConditions } from './pipelines/traffic.js';
export { fetchTrafficConditions };

// 2026-01-09: Canonical ETL pipeline modules - use these for validation
// Local filterInvalidEvents is kept for backwards compatibility but delegates to canonical
import { validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../events/pipeline/validateEvent.js';
// 2026-01-10: Added for Gemini-only event discovery (normalizing + hashing)
import { normalizeEvent } from '../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../events/pipeline/hashEvent.js';
// 2026-04-11: Title-similarity dedup — catches Gemini returning same event with different titles
import { deduplicateEventsSemantic } from '../events/pipeline/deduplicateEventsSemantic.js';

// 2026-02-17: FIX Issue 1 (Venue Creation Gap) — geocode + findOrCreateVenue
// Was: lookupVenueFuzzy (read-only, never created venues for new event locations)
// Now: geocode to get place_id, then findOrCreateVenue (creates venue if new)
// This ensures discovered_events.venue_id is populated, enabling:
// - Events on map (coordinates from venue)
// - Event badges on venue cards
// - Precise location data in strategies
import { findOrCreateVenue, lookupVenue } from '../venue/venue-cache.js';
import { geocodeEventAddress } from '../events/pipeline/geocodeEvent.js';
// 2026-04-10: Google Places (NEW) API (New) is the authoritative source for venue data.
// Used in event pipeline to resolve venue address, coordinates, and city after Gemini discovery.
import { searchPlaceWithTextSearch } from '../venue/venue-address-resolver.js';
// 2026-04-11: Address quality validation — catches bad Places (NEW) API results before they persist
import { validateVenueAddress } from '../venue/venue-address-validator.js';

// 2026-02-17: FIX Issue 3 (Past Event Cleanup)
// Soft-deactivates ended events (is_active = false) before each discovery cycle
// Prevents stale events from appearing in briefings and AI Coach queries
import { deactivatePastEvents } from './cleanup-events.js';

// TomTom Traffic API for real-time traffic conditions (primary provider)
// 2026-01-14: Moved TomTom to server/lib/traffic/ for architecture cleanup
import { getTomTomTraffic, fetchRawTraffic } from '../traffic/tomtom.js';

// Haversine distance calculation for school closures filtering
import { haversineDistanceMiles } from '../location/geo.js';

// Email alerts for model errors
import { sendModelErrorAlert } from '../notifications/email-alerts.js';

// =============================================================================
// TIMEOUT UTILITY
// =============================================================================
// 2026-01-15: Added to prevent zombie event searches from blocking the pipeline
// A single stalled search was observed hanging for 3.5 minutes, blocking all other work
// This wrapper ensures each search is abandoned after the timeout, returning an empty result
// 2026-02-01: Increased from 45s to 90s - Gemini with HIGH thinking takes 50-70s per search

const EVENT_SEARCH_TIMEOUT_MS = 90000; // 90 seconds per category search (Gemini + thinking needs time)

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within the timeout,
 * it returns a timeout error result instead of hanging indefinitely.
 *
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for logging purposes
 * @returns {Promise} - Resolves with either the original result or a timeout error
 */
// 2026-04-04: FIX H-5 — Enhanced withTimeout to:
// 1. Clear timer when promise resolves (was leaking timers)
// 2. Signal AbortController on timeout so callers can cancel in-flight work
// Note: H-2 (120s global router timeout) limits max wasted time even without abort support.
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

// 2026-05-02: getMarketForLocation moved to ./shared/get-market-for-location.js
// (Workstream 6 Step 1 commit 2 — used by ≥2 pipelines).

// 2026-05-02: getSchoolSearchTerms moved to ./pipelines/schools.js
// (Workstream 6 Step 1 commit 3 — pilot pipeline extraction).

/**
 * Deduplicate events based on normalized name, address, and time
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
 * import { validateEventsHard } from '../events/pipeline/validateEvent.js';
 *
 * @deprecated Compatibility shim — use validateEventsHard() directly.
 * Scheduled for removal after all callers are migrated.
 *
 * Active callers (verified via Read 2026-04-28):
 *   1. server/api/briefing/briefing.js (POST /filter-invalid-events) — imported at line 4
 *   2. server/lib/briefing/briefing-service.js:1603 — internal call (this file)
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

// 2026-02-11: Removed direct OpenAI client - all calls now use callModel adapter

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Fetch events using Claude web search (fallback when Gemini fails)
 * Uses parallel category searches similar to Gemini approach
 * 2026-01-15: Added 90s timeout per search to prevent zombie searches
 * 2026-02-01: Added market parameter for metro-wide search
 */
async function fetchEventsWithClaudeWebSearch({ snapshot, city, state, market, date, lat, lng, timezone }) {
  const startTime = Date.now();
  // 2026-04-16: market is authoritative; '[unknown-market]' placeholder surfaces in AI prompts
  // so we can spot unresolved markets instead of silently searching a single suburb.
  const searchArea = market || '[unknown-market]';

  // Helper to search a single category with Claude
  async function searchCategory(category) {
    const prompt = `Search the web for ${category.name.replace('_', ' ')} events happening in the ${searchArea} metro area TODAY (${date}).

SEARCH THE ENTIRE ${searchArea.toUpperCase()} MARKET - include events in ${city} AND nearby cities.

SEARCH QUERY: "${category.searchTerms(searchArea, state, date)}"

Return a JSON array of events with this format (max 5 events):
[{"title":"Event Name","venue":"Venue Name","address":"Full Address","event_start_date":"${date}","event_start_time":"7:00 PM","event_end_time":"10:00 PM","event_end_date":"${date}","category":"${category.eventTypes[0]}","impact":"high"}]

ALL 4 date/time fields (event_start_date, event_start_time, event_end_time, event_end_date) are REQUIRED. Estimate times if unknown — do NOT omit them. Return an empty array [] if no events found.`;

    // 2026-04-05: FIX — Aligned with ALLOWED_CATEGORIES. Removed 'live_music' (not in allowed list).
    const system = `You are an event search assistant. Search the web for local events and return structured JSON data. Only include events happening TODAY. Be accurate with venue names and times.

STRICT CATEGORIZATION RULES (MUST FOLLOW):
- concert: For ticketed performances at music venues, theaters, arenas, stadiums, AND live bands/DJs at bars or lounges.
- sports: Official league or tournament games at any level (professional, collegiate, international).
- comedy: Stand-up comedy, improv nights, comedy club events.
- theater: Plays, musicals, ballet, opera, dance performances.
- festival: Multi-act festivals, fairs, parades.
- nightlife: Club nights, karaoke, trivia, themed bar parties (no live music performance).
- convention: Conventions, conferences, expos.
- community: Public/civic gatherings (markets, library events, charity).

category MUST be one of: concert, sports, comedy, theater, festival, nightlife, convention, community, other.`;

    try {
      matrixLog.info({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'DISPATCH',
        roleName: 'BRIEFER',
        secondaryCat: 'EVENTS',
        location: 'briefing-service.js:discoverEventsWithClaude',
      }, 'Calling Briefer for parallel event discovery');
      // Uses BRIEFING_FALLBACK role (Claude with web_search) for parallel event discovery
      const result = await callModel('BRIEFING_FALLBACK', { system, user: prompt });

      if (!result.ok) {
        matrixLog.error({
          category: 'BRIEFING',
          connection: 'AI',
          action: 'COMPLETE',
          roleName: 'BRIEFER',
          secondaryCat: 'EVENTS',
          location: 'briefing-service.js:discoverEventsWithClaude',
        }, 'Briefer call failed', result.error);
        return { category: category.name, items: [], error: result.error };
      }

      const parsed = safeJsonParse(result.output);
      const items = Array.isArray(parsed) ? parsed : [];
      return {
        category: category.name,
        items: items.filter(e => e.title && e.venue),
        citations: result.citations || []
      };
    } catch (err) {
      return { category: category.name, items: [], error: err.message };
    }
  }

  // Run both categories in parallel using Claude web search (with 90s timeout each)
  const categoryPromises = EVENT_CATEGORIES.map(category =>
    withTimeout(
      searchCategory(category),
      EVENT_SEARCH_TIMEOUT_MS,
      `Claude event search: ${category.name}`
    )
  );

  const categoryResults = await Promise.all(categoryPromises);

  // Merge and deduplicate results
  const allEvents = [];
  const allCitations = [];
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
    if (result.citations) {
      allCitations.push(...result.citations);
    }
    for (const event of result.items || []) {
      const titleKey = event.title?.toLowerCase().trim();
      if (titleKey && !seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        allEvents.push(event);
      }
    }
    if (result.error) {
      briefingLog.warn(2, `Claude category ${result.category} failed: ${result.error}`, OP.AI);
    }
  }

  if (timedOutCount > 0) {
    briefingLog.warn(2, `${timedOutCount}/${EVENT_CATEGORIES.length} Claude category searches timed out`, OP.FALLBACK);
  }

  const elapsedMs = Date.now() - startTime;
  briefingLog.done(2, `Claude: ${allEvents.length} unique events (${totalFound} total) in ${elapsedMs}ms`, OP.FALLBACK);

  if (allEvents.length === 0) {
    return { items: [], reason: 'No events found via Claude web search', provider: 'claude' };
  }

  return { items: allEvents, citations: allCitations, reason: null, provider: 'claude' };
}

const inFlightBriefings = new Map(); // In-memory dedup for concurrent calls within same process

// 2026-05-02: safeJsonParse moved to ./shared/safe-json-parse.js
// (Workstream 6 Step 1 commit 2 — used by 11 sites across pipelines; pure function with no deps).
// Original definition (lines 728-942) preserved verbatim in the new file.

// 2026-01-10: Updated to use canonical field names (event_start_date, event_start_time)
const LocalEventSchema = z.object({
  title: z.string(),
  summary: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  source: z.string(),
  event_type: z.enum(['concert', 'game', 'comedy', 'live_music', 'festival', 'sports', 'performance', 'other']).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distance_miles: z.number().optional(),
  event_start_date: z.string().optional(),
  event_start_time: z.string().optional(),
  event_end_time: z.string().optional(),
  address: z.string().optional(),
  location: z.string().optional(),
  link: z.string().optional(),
  staging_area: z.string().optional(),
  place_id: z.string().optional(),
});

function mapGeminiEventsToLocalEvents(rawEvents, { lat, lng }) {
  if (!Array.isArray(rawEvents)) return [];

  const mapped = rawEvents.map((e, idx) => {
    const subtype = (e.subtype || '').toLowerCase();
    const type = (e.type || '').toLowerCase();

    let event_type = 'other';
    if (subtype.includes('concert') || subtype.includes('live music') || subtype.includes('music')) {
      event_type = 'concert';
    } else if (subtype.includes('sports') || subtype.includes('game') || subtype.includes('match')) {
      event_type = 'sports';
    } else if (subtype.includes('festival') || subtype.includes('fair') || subtype.includes('parade')) {
      event_type = 'festival';
    } else if (subtype.includes('comedy')) {
      event_type = 'comedy';
    } else if (type === 'road_closure') {
      event_type = 'other';
    }

    const location = e.venue && e.address ? `${e.venue}, ${e.address}` : e.venue || e.address || undefined;
    // 2026-01-10: Use new field names (event_start_date, event_start_time)
    const timeLabel = e.event_start_date && e.event_start_time ? `${e.event_start_date} ${e.event_start_time}` : e.event_start_date || e.event_start_time || '';
    const summaryParts = [e.title, e.venue || null, timeLabel || null, e.impact ? `Impact: ${e.impact}` : null].filter(Boolean);
    const summary = summaryParts.join(' • ') || `Local event ${idx + 1}`;

    let staging_area;
    if (typeof e.recommended_driver_action === 'string' && e.recommended_driver_action.startsWith('reposition_to:')) {
      staging_area = e.recommended_driver_action.split(':')[1].replace(/_/g, ' ').trim();
    }

    return {
      title: e.title || `Event ${idx + 1}`,
      summary,
      impact: (e.impact === 'high' || e.impact === 'low') ? e.impact : 'medium',
      source: e.source || 'Gemini Web Search',
      event_type,
      latitude: e.latitude ?? undefined,
      longitude: e.longitude ?? undefined,
      distance_miles: typeof e.estimated_distance_miles === 'number' ? e.estimated_distance_miles : undefined,
      // 2026-01-10: Use canonical field names
      event_start_date: e.event_start_date,
      event_start_time: e.event_start_time,
      event_end_time: e.event_end_time,
      address: e.address,
      location,
      link: e.source,
      staging_area,
    };
  });

  return mapped;
}

/**
 * HYBRID EVENT CATEGORIES - 2 focused searches instead of 5 for better cost/quality balance
 * 2026-02-01: Consolidated from 5 categories to 2 (60% cost reduction, same quality)
 * 2026-02-01: Now uses MARKET (not city) for broader event coverage
 *
 * Split rationale:
 * - high_impact: Big venues that generate surge demand (stadiums, arenas, concert halls)
 * - local_entertainment: Smaller venues, local events (bars, comedy clubs, community)
 */
// 2026-02-26: FIX - Removed hardcoded US league names (NBA, NFL, etc.) and DFW-specific references.
// Search terms are now market-agnostic so Gemini discovers whatever events exist in any global market.
// 2026-04-05: FIX — eventTypes now use ONLY values from ALLOWED_CATEGORIES in validateEvent.js.
// Previously used 'game' and 'live_music' which don't exist in the allowed list.
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
 * Fetch events for a single category - used in parallel
 * 2026-02-01: Updated for hybrid 2-category approach + market-wide search
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
      location: 'briefing-service.js:fetchDetailedEvents',
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
        location: 'briefing-service.js:fetchDetailedEvents',
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

// Legacy single-search function (kept for fallback reference)
async function _fetchEventsWithGemini3ProPreviewLegacy({ snapshot }) {
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.error(2, `GEMINI_API_KEY not set`, null, OP.AI);
    return [];
  }

  // 2026-01-09: Require ALL location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data (city/state/timezone) - cannot fetch events (legacy)', OP.AI);
    return { items: [], reason: 'Location data not available (missing timezone)' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot.timezone;  // NO FALLBACK - timezone is required

  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  const timeContext = hour >= 17 ? 'tonight' : 'today';
  // 2026-04-16: FIX — derive weekday name from snapshot.dow (integer 0-6) instead of
  // recomputing from new Date(). Recomputation could drift if the briefing runs near
  // midnight UTC while the driver is still in the previous local day.
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = snapshot.dow != null
    ? DOW_NAMES[snapshot.dow]
    : new Date().toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });

  // 2026-01-10: Enhanced prompt with STRICT date/time requirements
  // Validation will reject events missing event_start_date, event_start_time, or event_end_time
  const system = `You are an event discovery assistant. Search for local events and return structured JSON data.

CRITICAL REQUIREMENTS - Every event MUST have ALL of these fields:
- event_start_date: Start date in YYYY-MM-DD format (REQUIRED)
- event_start_time: Start time like "7:00 PM" or "19:00" (REQUIRED)
- event_end_date: End date in YYYY-MM-DD format (REQUIRED - same as start for single-day events)
- event_end_time: End time like "10:00 PM" or "22:00" (REQUIRED - ESTIMATE if unknown)

Events without ALL date/time fields will be REJECTED. Never return null, "TBD", or "Unknown" for these fields.
If end time is not specified, estimate: Sports=3h, Concerts=3h, Festivals=4h, Theater=2.5h.`;

  const user = `Find events in ${city}, ${state} ${timeContext} (${date}, ${dayOfWeek}).

Return a JSON array where EVERY event has ALL required fields:
{
  "title": "Event Name",
  "venue": "Venue Name",
  "address": "Full Street Address",
  "event_start_date": "${date}",
  "event_start_time": "7:00 PM",
  "event_end_date": "${date}",
  "event_end_time": "10:00 PM",
  "subtype": "concert|sports|comedy|theater|festival|community",
  "impact": "high|medium|low"
}

RULES:
1. event_start_date and event_end_date MUST be in YYYY-MM-DD format
2. event_start_time and event_end_time MUST be separate fields (NEVER combine)
3. If exact end time unknown, estimate duration: Sports=3h, Concert=3h, Festival=4h
4. NO null values, NO "TBD", NO "Unknown" - SKIP the event entirely if times cannot be determined
5. Include events for ${date} and the next 3 days`;

  matrixLog.info({
    category: 'BRIEFING',
    connection: 'AI',
    action: 'DISPATCH',
    roleName: 'BRIEFER',
    secondaryCat: 'EVENTS',
    location: 'briefing-service.js:discoverEventsWithGemini',
  }, 'Calling Briefer for event discovery');
  // Uses BRIEFING_EVENTS_DISCOVERY role (Gemini with google_search)
  const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

  if (!result.ok) {
    matrixLog.error({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'EVENTS',
      location: 'briefing-service.js:discoverEventsWithGemini',
    }, 'Briefer call failed', result.error);
    if (result.error?.includes('Empty response')) {
      return { items: [], reason: 'Gemini returned empty response' };
    }
    throw new Error(`Gemini events API failed: ${result.error}`);
  }

  try {
    const parsed = safeJsonParse(result.output);
    const events = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

    // 2026-01-10: STRICT FILTER - Reject events missing required date/time fields at source
    // This prevents incomplete events from entering the pipeline at all
    const validEvents = events.filter(e => {
      // Must have title and venue
      if (!e.title || !e.venue) return false;

      // Must have start date (accept both naming conventions)
      const hasStartDate = e.event_start_date || e.event_date || e.date;
      if (!hasStartDate) return false;

      // Must have start time (accept both naming conventions)
      const hasStartTime = e.event_start_time || e.event_time || e.time;
      if (!hasStartTime) return false;

      // Must have end time
      if (!e.event_end_time && !e.end_time) return false;

      return true;
    });

    const rejected = events.length - validEvents.length;
    if (rejected > 0) {
      briefingLog.warn(2, `Rejected ${rejected}/${events.length} events missing required date/time fields`, OP.AI);
    }

    return { items: validEvents, reason: null };
  } catch (err) {
    briefingLog.error(2, `Parse Gemini events failed`, err, OP.AI);
    throw new Error(`Failed to parse Gemini events response: ${err.message}`);
  }
}

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

// 2026-01-08: REMOVED confirmTBDEventDetails - replaced by filterInvalidEvents (hard filter)
// Old function tried to "repair" TBD events via AI calls. New approach: just remove them.



export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  // Dedup 1: Check if already in flight in this process (concurrent calls)
  if (inFlightBriefings.has(snapshotId)) {
    briefingLog.info(`Already in flight for ${snapshotId.slice(0, 8)} - waiting`, OP.CACHE);
    return inFlightBriefings.get(snapshotId);
  }

  // 2026-04-04: FIX H-4 — Use advisory lock to prevent race conditions across processes.
  // Previously, between checking existing row and inserting/clearing placeholder, another
  // process could insert, causing the "clear fields" UPDATE to wipe data being written
  // by the other process. Advisory lock serializes the check-then-write sequence.
  // NOTE: db.execute() returns { rows: [...] }, NOT an array — use .rows[0] (matches blocks-fast.js pattern)
  const lockQueryResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(hashtext(${snapshotId})) as acquired`
  );
  const lockAcquired = lockQueryResult.rows?.[0]?.acquired === true;

  if (!lockAcquired) {
    // Another process holds the lock — briefing generation is in progress elsewhere.
    // Wait briefly then return whatever exists.
    briefingLog.info(`Advisory lock not acquired for ${snapshotId.slice(0, 8)} - generation in progress elsewhere`, OP.CACHE);
    const existing = await getBriefingBySnapshotId(snapshotId);
    if (existing) {
      return { success: true, briefing: existing, deduplicated: true };
    }
    // No row yet — the other process hasn't inserted placeholder. Return pending.
    return { success: true, briefing: null, deduplicated: true, pending: true };
  }

  try {
    // Dedup 2: Check database state - if briefing exists with ALL populated fields, skip regeneration
    // NULL fields = generation in progress or needs refresh
    // Populated fields = data ready, don't regenerate
    // 2026-04-05: Error-marked fields (_generationFailed) don't count as "populated" — must regenerate
    const existing = await getBriefingBySnapshotId(snapshotId);
    if (existing) {
      const hasTraffic = existing.traffic_conditions !== null && !existing.traffic_conditions?._generationFailed;
      const hasEvents = existing.events !== null && !existing.events?._generationFailed && (Array.isArray(existing.events) ? existing.events.length > 0 : existing.events?.items?.length > 0 || existing.events?.reason);
      const hasNews = existing.news !== null && !existing.news?._generationFailed;
      const hasClosures = existing.school_closures !== null && !existing.school_closures?._generationFailed;

      // ALL fields must be populated for concurrent request deduplication to apply
      if (hasTraffic && hasEvents && hasNews && hasClosures) {
        // 2026-01-10: Fixed misleading terminology - this is DEDUP not CACHE
        // Prevents duplicate concurrent requests, not traditional caching
        // Only skip if briefing was generated < 60 seconds ago (in-flight or just completed)
        const ageMs = Date.now() - new Date(existing.updated_at).getTime();
        if (ageMs < 60000) {
          briefingLog.info(`Recent briefing (${Math.round(ageMs/1000)}s old) - skipping duplicate generation`, OP.CACHE);
          return { success: true, briefing: existing, deduplicated: true };
        }
      } else if (hasTraffic || hasEvents) {
        briefingLog.info(`Partial data - regenerating`, OP.CACHE);
      }
    }

    // Create placeholder row with NULL fields to signal "generation in progress"
    // This prevents other callers from starting duplicate generation
    if (!existing) {
      try {
        await db.insert(briefings).values({
          snapshot_id: snapshotId,
          news: null,
          weather_current: null,
          weather_forecast: null,
          traffic_conditions: null,
          events: null,
          school_closures: null,
          airport_conditions: null,
          created_at: new Date(),
          updated_at: new Date()
        });
      } catch (insertErr) {
        // Row might already exist from concurrent call - that's OK
        if (!insertErr.message?.includes('duplicate') && !insertErr.message?.includes('unique')) {
          briefingLog.warn(1, `Placeholder insert warning: ${insertErr.message}`, OP.DB);
        }
      }
    } else {
      // Clear fields to signal "refreshing in progress"
      await db.update(briefings)
        .set({
          traffic_conditions: null,
          events: null,
          airport_conditions: null,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
    }
  } finally {
    // Release advisory lock — the placeholder is set, actual generation runs without lock
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${snapshotId}))`);
  }

  // 2026-04-05: Wrap in error handler to mark placeholder row as permanently failed
  // on throw. Without this, a thrown error leaves NULL fields in the DB forever,
  // and GET endpoints return success:false indefinitely → client infinite retry loop.
  const briefingPromise = generateBriefingInternal({ snapshotId, snapshot })
    .catch(async (err) => {
      console.error(`[BRIEFING] Generation failed for ${snapshotId.slice(0, 8)}: ${err.message}`);
      // Mark the placeholder row with error sentinel so endpoints return _generationFailed
      // instead of "not yet available" (which causes clients to keep polling)
      // 2026-05-02: Single timestamp shared across all 4 sections (intentional —
      // bulk-failure path; per-section .catch wrappers in generateBriefingInternal
      // use distinct timestamps via errorMarker(err) at each section boundary).
      const failureMarker = errorMarker(err);
      try {
        await db.update(briefings)
          .set({
            traffic_conditions: failureMarker,
            events: failureMarker,
            news: failureMarker,
            airport_conditions: failureMarker,
            updated_at: new Date()
          })
          .where(eq(briefings.snapshot_id, snapshotId));
        briefingLog.warn(1, `Marked briefing ${snapshotId.slice(0, 8)} as permanently failed`, OP.DB);
      } catch (markErr) {
        console.error(`[BRIEFING] Could not mark failed briefing: ${markErr.message}`);
      }
      return { success: false, error: err.message, _generationFailed: true };
    });

  inFlightBriefings.set(snapshotId, briefingPromise);

  briefingPromise.finally(() => {
    inFlightBriefings.delete(snapshotId);
  });

  return briefingPromise;
}

// 2026-05-02: writeSectionAndNotify, CHANNELS, errorMarker moved to ./briefing-notify.js
// (Workstream 6 Step 1 — see docs/review-queue/PLAN_workstream6_briefing_split.md).

async function generateBriefingInternal({ snapshotId, snapshot }) {
  // Use pre-fetched snapshot if provided, otherwise fetch from DB
  if (!snapshot) {
    try {
      const snapshotResult = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      if (snapshotResult.length > 0) {
        snapshot = snapshotResult[0];
      } else {
        briefingLog.warn(1, `Snapshot ${snapshotId} not found in DB`, OP.DB);
        return { success: false, error: 'Snapshot not found' };
      }
    } catch (err) {
      briefingLog.warn(1, `Could not fetch snapshot: ${err.message}`, OP.DB);
      return { success: false, error: err.message };
    }
  }

  // Require valid location data - no fallbacks for global app
  if (!snapshot.city || !snapshot.state || !snapshot.timezone) {
    console.error(`[BRIEFING] Snapshot missing required location data (city/state/timezone)`);
    return { success: false, error: 'Snapshot missing required location data' };
  }

  briefingLog.start(`${snapshot.city}, ${snapshot.state}`);
  const briefingStartMs = Date.now();

  const { city, state } = snapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // BRIEFING CACHING STRATEGY (Updated 2026-01-05):
  // ═══════════════════════════════════════════════════════════════════════════
  // ALWAYS FRESH (every request):  Weather, Traffic, News, Airport
  // CACHED (24-hour, same city):   School Closures
  // CACHED (from DB table):        Events
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 1: Check for cached SCHOOL CLOSURES only (city-level, 24-hour cache)
  // News, Weather, traffic, and airport are NEVER cached - always fetched fresh
  // JOIN briefings with snapshots to get city/state (briefings table no longer stores location)
  let cachedDailyData = null;
  try {
    // Exclude current snapshotId - we want cached data from OTHER snapshots in same city
    // Also exclude placeholder rows (NULL closures) by checking in the result
    const existingBriefings = await db.select({
      briefing: briefings,
      city: snapshots.city,
      state: snapshots.state
    })
      .from(briefings)
      .innerJoin(snapshots, eq(briefings.snapshot_id, snapshots.snapshot_id))
      .where(and(
        eq(snapshots.city, city),
        eq(snapshots.state, state),
        sql`${briefings.snapshot_id} != ${snapshotId}`,  // Exclude current snapshot
        sql`${briefings.school_closures} IS NOT NULL`  // Require school_closures
      ))
      .orderBy(desc(briefings.updated_at))  // DESC = newest first
      .limit(1);

    if (existingBriefings.length > 0) {
      const existing = existingBriefings[0].briefing; // Access briefing from join result
      // NO FALLBACK - timezone is required and validated at entry
      const userTimezone = snapshot.timezone;

      // Check if cached data actually has content (not just empty arrays)
      const closureItems = existing.school_closures?.items || existing.school_closures || [];
      const hasActualClosuresContent = Array.isArray(closureItems) && closureItems.length > 0;

      // Only use cache if it has ACTUAL content AND is same day
      if (!isDailyBriefingStale(existing, userTimezone) && hasActualClosuresContent) {
        briefingLog.info(`Cache hit: closures=${closureItems.length}`, OP.CACHE);
        cachedDailyData = {
          school_closures: existing.school_closures
        };
      }
    }
  } catch (cacheErr) {
    briefingLog.warn(1, `Cache lookup failed: ${cacheErr.message}`, OP.CACHE);
  }

  // Step 2: ALWAYS fetch fresh weather, traffic, events, airport, AND NEWS
  // 2026-01-05: News moved to fresh fetch (dual-model is fast enough)
  briefingLog.phase(1, `Fetching weather + traffic + events + airport + news`, OP.AI);

  // 2026-04-05: INDEPENDENT SUBSYSTEMS — use Promise.allSettled so each fetch is independent.
  // Previously used Promise.all (all-or-nothing) which meant one crash (e.g., events) killed
  // ALL results, leaving traffic/news/airport as NULLs in the DB forever.
  // Now each subsystem succeeds or fails independently.
  //
  // 2026-04-18: PHASE A — wrap each fetch with progressive section write + per-section
  // NOTIFY so the briefing tab can populate section-by-section as providers resolve
  // instead of blinking from empty→everything at t=52s. Each wrapper returns the
  // original provider result so the extraction and assembly logic below is unchanged;
  // the DB write + NOTIFY are side effects. The final atomic write at the end of
  // this function is the authoritative reconciliation (idempotent).
  let weatherResult, trafficResult, eventsResult, airportResult, newsResult;

  // 2026-05-02: Workstream 6 commit 4 — discoverWeather owns its writeSectionAndNotify
  // (single dual-section call) and its errorMarker .catch. Returns
  // { weather_current, weather_forecast, reason }; the final-assembly block below
  // reads from the new shape.
  const weatherPromise = discoverWeather({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 7 — discoverTraffic owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { traffic_conditions, reason }; the final-assembly
  // block below reads from the new shape.
  const trafficPromise = discoverTraffic({ snapshot, snapshotId });

  const eventsPromise = (snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.reject(new Error('Snapshot required for events')))
    .then(async (r) => {
      const items = Array.isArray(r?.items) ? r.items : [];
      await writeSectionAndNotify(snapshotId, {
        events: items.length > 0 ? items : { items: [], reason: r?.reason || 'No events found for this area' },
      }, CHANNELS.EVENTS);
      return r;
    })
    .catch(async (err) => {
      await writeSectionAndNotify(snapshotId, { events: errorMarker(err) }, CHANNELS.EVENTS);
      throw err;
    });

  // 2026-05-02: Workstream 6 commit 5 — discoverAirport owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { airport_conditions, reason }; the final-assembly
  // block below reads from the new shape.
  const airportPromise = discoverAirport({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 6 — discoverNews owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { news: {items, reason}, reason }; the final-assembly
  // block below reads from the new shape.
  const newsPromise = discoverNews({ snapshot, snapshotId });

  const fetchResults = await Promise.allSettled([
    weatherPromise,
    trafficPromise,
    eventsPromise,
    airportPromise,
    newsPromise,
  ]);

  // 2026-04-05: Extract results with REASON for every outcome (NO NULLS rule).
  // Every subsystem produces either real data or an explanatory error — never bare null.
  const subsystemNames = ['weather', 'traffic', 'events', 'airport', 'news'];
  const failedReasons = {};
  const extractedResults = fetchResults.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const reason = result.reason?.message || 'Unknown error';
    console.error(`[BRIEFING] ${subsystemNames[i]} fetch failed independently: ${reason}`);
    failedReasons[subsystemNames[i]] = reason;
    return null;
  });
  [weatherResult, trafficResult, eventsResult, airportResult, newsResult] = extractedResults;

  const failedCount = Object.keys(failedReasons).length;
  if (failedCount > 0) {
    briefingLog.warn(1, `${failedCount}/5 subsystems failed — storing partial results (${Object.keys(failedReasons).join(', ')})`, OP.AI);
  }
  // If ALL five failed, that's a systemic problem — throw so the .catch() handler marks the row
  if (failedCount === 5) {
    throw new Error(`All 5 briefing subsystems failed: ${Object.values(failedReasons).join('; ')}`);
  }

  // Step 3: Schools pipeline — owns cache-or-fetch decision + SSE write internally.
  // Cache LOOKUP (querying other snapshots in the same city) stays here in the
  // orchestrator because it's cross-snapshot knowledge; cache USAGE moves into
  // discoverSchools per the pipeline contract.
  // `let` (not `const`) for schoolClosures because the downstream Array.isArray
  // defensive check may reassign to [].
  let schoolClosures, schoolClosuresReason;
  ({ closures: schoolClosures, reason: schoolClosuresReason } = await discoverSchools({
    snapshot,
    snapshotId,
    cachedClosures: cachedDailyData?.school_closures,
  }));

  // 2026-04-05: Defensive extraction — each subsystem may be null if its fetch failed.
  // NO NULLS: every field gets a typed value + reason. Empty arrays are valid; null is not.
  let eventsItems = eventsResult?.items;
  if (!Array.isArray(eventsItems)) {
    if (eventsResult !== null) {
      briefingLog.warn(1, `eventsResult.items is ${typeof eventsItems} — defaulting to []`, OP.AI);
    }
    eventsItems = [];
  }
  let newsItems = newsResult?.news?.items;
  if (!Array.isArray(newsItems)) {
    if (newsResult !== null) {
      briefingLog.warn(1, `newsResult.news.items is ${typeof newsItems} — defaulting to []`, OP.AI);
    }
    newsItems = [];
  }
  if (!Array.isArray(schoolClosures)) {
    briefingLog.warn(1, `schoolClosures is ${typeof schoolClosures} — defaulting to []`, OP.AI);
    schoolClosures = [];
  }

  const airportCount = airportResult?.airport_conditions?.airports?.length || 0;
  const forecastHours = weatherResult?.weather_forecast?.length || 0;
  briefingLog.done(2, `weather=${forecastHours}hr, events=${eventsItems.length}, news=${newsItems.length}, traffic=${trafficResult?.traffic_conditions?.congestionLevel || 'N/A'}, airports=${airportCount}`, OP.AI);

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD BRIEFING DATA — NO NULLS RULE
  // ═══════════════════════════════════════════════════════════════════════════
  // Every JSONB column gets a well-typed value. Never bare null.
  // If a subsystem failed, the stored object includes `reason` explaining why.
  // If a subsystem succeeded but found nothing, `reason` explains that too.
  // The client uses the presence of data (not null checks) to decide what to show.
  // ═══════════════════════════════════════════════════════════════════════════

  const weatherCurrent = weatherResult?.weather_current || {
    temperature: 'N/A',
    conditions: failedReasons.weather
      ? `Weather unavailable: ${failedReasons.weather}`
      : 'Weather data could not be retrieved',
    reason: failedReasons.weather || 'Weather API returned no current conditions'
  };

  const briefingData = {
    snapshot_id: snapshotId,
    news: {
      items: newsItems,
      // 2026-04-24: SECURITY — do not interpolate raw failure reasons into the
      // client-facing `reason` field; upstream errors may contain credential
      // material. Use sentinel on failure path; preserve non-error messages.
      reason: failedReasons.news
        ? 'news-fetch-failed'
        : newsResult?.news?.reason || (newsItems.length === 0 ? 'No rideshare news found for this area' : null)
    },
    weather_current: weatherCurrent,
    weather_forecast: weatherResult?.weather_forecast || [],
    traffic_conditions: trafficResult?.traffic_conditions || {
      summary: failedReasons.traffic
        ? `Traffic unavailable: ${failedReasons.traffic}`
        : 'No traffic data available for this area',
      briefing: failedReasons.traffic
        ? `Traffic analysis could not be completed: ${failedReasons.traffic}`
        : 'Traffic data is not available for this location',
      incidents: [],
      congestionLevel: 'unknown',
      reason: failedReasons.traffic || 'Traffic data could not be retrieved'
    },
    events: eventsItems.length > 0
      ? eventsItems
      : {
          items: [],
          reason: failedReasons.events
            ? `Events fetch failed: ${failedReasons.events}`
            : eventsResult?.reason || 'No events found for this area'
        },
    school_closures: schoolClosures.length > 0
      ? schoolClosures
      : { items: [], reason: schoolClosuresReason },
    airport_conditions: airportResult?.airport_conditions || {
      airports: [],
      busyPeriods: [],
      recommendations: failedReasons.airport
        ? `Airport data unavailable: ${failedReasons.airport}`
        : 'No airport data available for this area',
      reason: failedReasons.airport || 'Airport conditions could not be retrieved'
    },
    created_at: new Date(),
    updated_at: new Date(),
    // 2026-04-14: Phase 7 — populate generated_at at the final-data-store write (was dead
    // column per Phase 2 audit). Semantics: last time this briefing's data was actually
    // generated (not placeholder, not error, not cleared). Other write paths intentionally
    // do not touch this column so it preserves "last successful generation" across failures.
    // See BRIEFING-DATA-MODEL.md Appendix D.
    generated_at: new Date()
  };

  try {
    const existing = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (existing.length > 0) {
      await db.update(briefings)
        .set({
          news: briefingData.news,
          weather_current: briefingData.weather_current,
          weather_forecast: briefingData.weather_forecast,
          traffic_conditions: briefingData.traffic_conditions,
          events: briefingData.events,
          school_closures: briefingData.school_closures,
          airport_conditions: briefingData.airport_conditions,
          updated_at: new Date(),
          // 2026-04-14: Phase 7 — refresh generated_at on every successful regeneration.
          generated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
    } else {
      await db.insert(briefings).values(briefingData);
    }
    briefingLog.complete(`${city}, ${state}`, Date.now() - briefingStartMs);

    // Notify clients that briefing data is ready (SSE event)
    try {
      const payload = JSON.stringify({ snapshot_id: snapshotId });
      await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
      // 2026-04-28: send-side NOTIFY demoted; dispatcher logs the canonical receive-side line.
      if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
        briefingLog.info(`NOTIFY briefing_ready sent for ${snapshotId.slice(0, 8)}`, OP.SSE);
      }
    } catch (notifyErr) {
      briefingLog.warn(1, `Failed to send NOTIFY: ${notifyErr.message}`, OP.SSE);
    }

    // Dump last briefing row to file for debugging
    dumpLastBriefingRow().catch(err =>
      briefingLog.warn(1, `Failed to dump briefing: ${err.message}`, OP.DB)
    );

    // Memory #111: Briefing completeness check — strategist should NOT receive incomplete data.
    // Validate that critical briefing fields are present and non-empty before returning success.
    const REQUIRED_BRIEFING_FIELDS = ['events', 'news', 'weather_current', 'traffic_conditions'];
    const missingFields = REQUIRED_BRIEFING_FIELDS.filter(f => {
      const v = briefingData?.[f];
      return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    });
    const isComplete = missingFields.length === 0;
    if (!isComplete) {
      console.warn('[Briefing] Incomplete briefing — missing fields:', missingFields);
    }

    return {
      success: true,
      briefing: briefingData,
      complete: isComplete,
      missingFields
    };
  } catch (error) {
    console.error('[BRIEFING] Database error:', error);
    return {
      success: false,
      error: error.message,
      briefing: briefingData
    };
  }
}

export async function getBriefingBySnapshotId(snapshotId) {
  try {
    const result = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[BRIEFING] Error fetching briefing:', error);
    return null;
  }
}


/**
 * Refresh events data in existing briefing (when events are stale)
 * Keeps other cached data while updating events
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated events
 */
export async function refreshEventsInBriefing(briefing, snapshot) {
  try {
    briefingLog.phase(2, `Refreshing stale events`, OP.AI);

    const eventsResult = await fetchEventsForBriefing({ snapshot });
    const eventsItems = eventsResult?.items || [];

    // NOTE: Event validation disabled - Gemini handles event discovery directly

    // Update only the events data
    briefing.events = eventsItems.length > 0 ? eventsItems : { items: [], reason: eventsResult?.reason || 'No events found' };
    briefing.updated_at = new Date();

    // Update database with fresh events
    try {
      await db.update(briefings)
        .set({
          events: briefing.events,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      briefingLog.done(2, `Events refreshed: ${eventsItems.length}`, OP.DB);
    } catch (dbErr) {
      briefingLog.warn(2, `Events DB update failed: ${dbErr.message}`, OP.DB);
    }

    return briefing;
  } catch (err) {
    briefingLog.warn(2, `Events refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Refresh traffic data in existing briefing
 * NOTE: With fetch-once pattern on client, this is only called during manual refresh
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated traffic_conditions
 */
async function refreshTrafficInBriefing(briefing, snapshot) {
  try {
    const trafficResult = await fetchTrafficConditions({ snapshot });
    if (trafficResult) {
      briefing.traffic_conditions = trafficResult;
      briefing.updated_at = new Date();

      try {
        await db.update(briefings)
          .set({
            traffic_conditions: trafficResult,
            updated_at: new Date()
          })
          .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      } catch (dbErr) {
        briefingLog.warn(1, `Traffic DB update failed`, OP.DB);
      }
    }
    return briefing;
  } catch (err) {
    briefingLog.warn(1, `Traffic refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Refresh news data in existing briefing (volatile data)
 * 2026-01-05: Added to ensure news is always fresh on request
 * News uses dual-model fetch (Gemini + GPT-5.2) which is fast enough for per-request refresh
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated news
 */
async function refreshNewsInBriefing(briefing, snapshot) {
  try {
    const newsResult = await fetchRideshareNews({ snapshot });
    const newsItems = newsResult?.items || [];

    briefing.news = { items: newsItems, reason: newsResult?.reason || null };
    briefing.updated_at = new Date();

    try {
      await db.update(briefings)
        .set({
          news: briefing.news,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      briefingLog.done(1, `News refreshed: ${newsItems.length} items`, OP.DB);
    } catch (dbErr) {
      briefingLog.warn(1, `News DB update failed`, OP.DB);
    }

    return briefing;
  } catch (err) {
    briefingLog.warn(1, `News refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Get existing briefing or generate if missing/stale
 * SPLIT CACHE STRATEGY (2026-01-05 Updated):
 * - ALWAYS FRESH: Traffic, News (refreshed every request)
 * - CACHED 24h: School Closures
 * - FROM DB: Events (from discovered_events table)
 *
 * @param {string} snapshotId
 * @param {object} snapshot - Full snapshot object
 * @param {object} options - Options for cache behavior
 * @param {boolean} options.forceRefresh - Force full regeneration even if cached (default: false)
 * @returns {Promise<object|null>} Parsed briefing data with fresh traffic and news
 */
export async function getOrGenerateBriefing(snapshotId, snapshot, options = {}) {
  const { forceRefresh = false } = options;

  let briefing = await getBriefingBySnapshotId(snapshotId);

  // Check if briefing exists but has NULL fields (generation in progress or incomplete)
  // NULL in ANY of the four core fields = placeholder row or incomplete generation
  const isPlaceholder = briefing && (
    briefing.traffic_conditions === null ||
    briefing.events === null ||
    briefing.news === null ||
    briefing.school_closures === null
  );
  if (isPlaceholder) {
    // Log which fields are missing for debugging
    const missingFields = [];
    if (briefing.traffic_conditions === null) missingFields.push('traffic');
    if (briefing.events === null) missingFields.push('events');
    if (briefing.news === null) missingFields.push('news');
    if (briefing.school_closures === null) missingFields.push('closures');

    // Check if it's a recent placeholder (< 2 minutes old) - generation likely in progress
    const placeholderAgeMs = Date.now() - new Date(briefing.updated_at).getTime();
    if (placeholderAgeMs < 120000) {
      briefingLog.info(`In progress (${Math.round(placeholderAgeMs/1000)}s) - polling`);
      return null; // Let frontend poll again
    } else {
      briefingLog.info(`Stale placeholder - regenerating`);
      briefing = null; // Force regeneration
    }
  }

  // Check if we need to regenerate: no briefing, or forced refresh
  const needsFullRegeneration = !briefing || forceRefresh;
  
  if (needsFullRegeneration) {
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
      }
    } catch (genErr) {
      briefingLog.error(1, `Generation failed`, genErr);
    }
  } else if (!isDailyBriefingStale(briefing, snapshot.timezone)) {
    // Daily briefing is still fresh (within 24h)
    // Refresh volatile data: Traffic AND News (always fresh per request)
    briefing = await refreshTrafficInBriefing(briefing, snapshot);
    briefing = await refreshNewsInBriefing(briefing, snapshot);

    // 2026-01-09: Simplified event refresh logic
    // Trust "No Cached Data" architecture - if events are stale OR empty, refresh ONCE
    // Removed redundant "FINAL SAFETY NET" check - no infinite retry loops
    if (areEventsEmpty(briefing) || isEventsStale(briefing)) {
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    }
  } else {
    // Daily briefing is older than 24h, regenerate everything
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
      }
    } catch (genErr) {
      briefingLog.error(1, `Regeneration failed`, genErr);
    }
  }

  // 2026-01-09: REMOVED "FINAL SAFETY NET"
  // Trust the "No Cached Data" architecture:
  // - If DB read returns empty, accept it (location may genuinely have no events)
  // - Events are stored in discovered_events table by the Gemini pipeline
  // - Multiple re-fetch attempts mask upstream bugs instead of surfacing them

  return briefing;
}
