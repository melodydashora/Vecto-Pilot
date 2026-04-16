// server/lib/ai/providers/consolidator.js
// Strategy generation provider
//
// TWO FUNCTIONS:
//   1. runImmediateStrategy() - STRATEGY_TACTICAL role → "strategy_for_now" (1-hour tactical)
//      - Called by blocks-fast.js during initial pipeline
//      - Uses snapshot + briefing data directly (no minstrategy)
//
//   2. runConsolidator() - STRATEGY_DAILY role → "consolidated_strategy" (8-12hr daily)
//      - Called on-demand via POST /api/strategy/daily/:snapshotId
//      - Uses snapshot + briefing data directly (no minstrategy)
//      - Includes BRIEFING_FALLBACK role when primary fails

import crypto from 'crypto';
import { db } from '../../../db/drizzle.js';
// 2026-04-11: Added driver_profiles for STRATEGIST_ENRICHMENT_PLAN (driver preferences,
// home base, vehicle class derivation, EV detection). See
// server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md for the design rationale.
import { strategies, briefings, news_deactivations, venue_catalog, driver_profiles } from '../../../../shared/schema.js';
import { eq, inArray, or, ilike, sql } from 'drizzle-orm';
// 2026-02-13: Removed direct callAnthropic import — now uses callModel adapter
// @ts-ignore
// 2026-02-13: Removed direct callOpenAI import — now uses callModel adapter
// 2026-02-11: Route through callModel adapter for registry config (thinkingLevel, tokens, features)
import { callModel } from '../adapters/index.js';
import { triadLog, aiLog, dbLog, OP } from '../../../logger/workflow.js';
import { isOpenNow } from '../../venue/venue-hours.js';
// 2026-02-17: Use canonical timezone module for ALL time resolution (single source of truth)
import { formatLocalTime } from '../../location/getSnapshotTimeContext.js';
// 2026-01-09: Use canonical validation module
import { validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../../events/pipeline/validateEvent.js';

/**
 * 2026-01-09: Read-time event validation
 * 2026-04-14: Now accepts optional schema_version to skip redundant revalidation.
 *
 * Uses canonical validateEventsHard module. Events written with the current
 * VALIDATION_SCHEMA_VERSION were already validated at store time in
 * briefing-service.js, so re-validating them is safe but redundant.
 *
 * For events from briefings.events JSONB (no schema_version available), pass null
 * to always revalidate (safe default). For direct discovered_events table reads,
 * pass the row's schema_version to enable the optimization.
 *
 * @param {Array} events - Events array
 * @param {number|null} [schemaVersion=null] - schema_version from discovered_events row (if available)
 * @returns {Array} Validated events (TBD/Unknown removed)
 */
function filterEventsReadTime(events, schemaVersion = null) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return events || [];
  }

  // 2026-04-14: Skip revalidation if events were written at current schema version
  if (schemaVersion !== null && !needsReadTimeValidation(schemaVersion)) {
    return events;
  }

  // Legacy, older-version, or briefing-sourced events need revalidation
  const result = validateEventsHard(events, {
    logRemovals: false,  // Don't spam logs for read-time validation
    phase: 'CONSOLIDATOR_READ'
  });

  return result.valid;
}

/**
 * Normalize a news title for hash matching
 * Strips common prefixes like "URGENT:", "BREAKING:", etc.
 */
function normalizeNewsTitle(title) {
  if (!title) return '';
  return title
    .replace(/^(URGENT|BREAKING|ALERT|UPDATE|DEVELOPING|JUST IN):\s*/i, '')
    .trim();
}

/**
 * Generate a hash for news item matching
 */
function generateNewsHash(title, source, date) {
  const normalizedTitle = normalizeNewsTitle(title);
  const normalized = `${normalizedTitle}_${source || ''}_${date || ''}`.toLowerCase().trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Get deactivated news hashes for a user
 */
async function getDeactivatedNewsHashes(userId) {
  if (!userId) return new Set();

  try {
    const deactivations = await db
      .select({ news_hash: news_deactivations.news_hash })
      .from(news_deactivations)
      .where(eq(news_deactivations.user_id, userId));

    return new Set(deactivations.map(d => d.news_hash));
  } catch (error) {
    console.error('Consolidator: getDeactivatedNewsHashes error:', error);
    return new Set();
  }
}

/**
 * Filter out deactivated news items for a user
 * Handles both array format and {items: [...]} format
 */
async function filterDeactivatedNews(newsData, userId) {
  if (!userId || !newsData) {
    return newsData;
  }

  const deactivatedHashes = await getDeactivatedNewsHashes(userId);
  if (deactivatedHashes.size === 0) {
    return newsData;
  }

  // Handle both array format and {items: [...]} format
  const newsItems = Array.isArray(newsData) ? newsData : newsData?.items;

  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return newsData;
  }

  const originalCount = newsItems.length;
  const filteredItems = newsItems.filter(item => {
    const itemHash = generateNewsHash(item.title, item.source, item.date);
    return !deactivatedHashes.has(itemHash);
  });

  if (filteredItems.length < originalCount) {
    triadLog.phase(3, `Consolidator: News filtered: ${originalCount} → ${filteredItems.length} (${originalCount - filteredItems.length} deactivated)`);
  }

  // Return in the same format as received
  if (Array.isArray(newsData)) {
    return filteredItems;
  } else {
    return { ...newsData, items: filteredItems };
  }
}

// 2026-02-26: Removed unused FALLBACK_MODEL/TOKENS/TEMPERATURE constants.
// BRIEFING_FALLBACK role is configured in model-registry.js and called via callModel().

/**
 * 2026-02-26: Renamed from callGPT5ForImmediateStrategy (now uses Claude Opus via callModel).
 * Generate immediate 1-hour tactical strategy from snapshot + briefing data.
 * NO minstrategy required - STRATEGY_TACTICAL has all the context it needs.
 *
 * 2026-04-11: STRATEGIST ENRICHMENT — the prompt now includes driver preferences
 * (vehicle class, fuel economy, earnings goal), full traffic intel (incidents,
 * closures, high-demand zones), NEAR/FAR event distance annotation, 6-hour
 * weather forecast timeline, event capacity estimates, home base context, and
 * pre-computed earnings math. See server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md
 * for the full design. All enrichments are ADDITIVE — if a field is null or a
 * schema migration hasn't applied, helpers fall back to sensible defaults.
 *
 * @param {Object} snapshot - Full snapshot row from DB
 * @param {Object} briefing - Briefing data { traffic, events, weather, weather_forecast, news, school_closures, airport }
 */
async function generateImmediateStrategy({ snapshot, briefing }) {

  // 2026-02-17: Use snapshot directly — it has everything resolved from GlobalHeader
  const localTime = formatLocalTime(snapshot);

  try {
    // 2026-04-11: Fetch driver preferences (single indexed lookup, defensive defaults).
    // Returns a well-formed prefs object even when user_id is null, profile is
    // missing, or the migration hasn't run yet.
    const prefs = await loadDriverPreferences(snapshot.user_id);

    // 2026-04-11: Event distance annotation + NEAR/FAR bucketing via the
    // venue_lat / venue_lng already present in briefing.events (from the
    // venue_catalog LEFT JOIN in briefing-service.js). No new DB query.
    const formattedEvents = await formatEventsForStrategist(briefing.events, snapshot, 15);

    // 2026-04-11: Traffic intelligence — structured incidents/closures/zones
    // when the new traffic shape is present, Gemini analysis fallback otherwise.
    const trafficBlock = formatTrafficIntelForStrategist(briefing.traffic);

    // 2026-04-11: Weather forecast timeline — reads briefing.weather_forecast
    // (already populated upstream, previously unused).
    const weatherBlock = formatWeatherForStrategist(briefing.weather, briefing.weather_forecast, snapshot.timezone);

    // 2026-04-11: Driver preference summary + pre-computed earnings math.
    const driverPrefBlock = buildDriverPreferencesSection(prefs);
    const earningsBlock = buildEarningsContextSection(prefs);
    const homeBaseLine = buildHomeBaseLine(snapshot, prefs);

    // 2026-01-14: FIX - Send full formatted_address and snapshot context to LLM
    const driverAddress = snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`;

    // Greeting personalization — use driver_nickname or first name if we have it
    const driverGreeting = prefs.driver_nickname ? ` for ${prefs.driver_nickname}` : '';

    // 2026-04-11: Prompt rebuilt with 7 enrichments. Driver preferences and earnings
    // context sit near the top; traffic/events/weather sections now use enriched
    // formatters; the TIME-OF-DAY and OUTPUT FORMAT sections remain.
    const prompt = `You are an expert rideshare strategist${driverGreeting}. Tell the driver what to do RIGHT NOW for the next 1-2 hours.

=== DRIVER CONTEXT ===
Current position: ${driverAddress}
Coords: ${parseFloat(snapshot.lat).toFixed(6)},${parseFloat(snapshot.lng).toFixed(6)}
${homeBaseLine || ''}
City: ${snapshot.city}, ${snapshot.state}
Timezone: ${snapshot.timezone}
Time: ${localTime} (${snapshot.day_part_key})
${snapshot.is_holiday ? `HOLIDAY: ${snapshot.holiday}` : ''}

=== DRIVER PREFERENCES ===
${driverPrefBlock}

=== EARNINGS CONTEXT ===
${earningsBlock}

=== BRIEFING DATA ===
${trafficBlock}

EVENTS (next 6 hours, sorted closest-first, [NEAR] = within 15mi, [FAR] = beyond 15mi — intel only):
${formattedEvents}

${weatherBlock}

NEWS: ${formatNewsForPrompt(optimizeNewsForLLM(briefing.news))}

SCHOOL CLOSURES: ${formatSchoolClosuresSummary(briefing.school_closures, snapshot.timezone)}

AIRPORT: ${optimizeAirportForLLM(briefing.airport)}

=== TIME-OF-DAY INTELLIGENCE ===
Think about WHAT drives demand at ${localTime}:
- Morning (6-10 AM): Commuters, airport departures, school drop-offs
- Midday (10 AM-2 PM): Airport arrivals, business lunch, medical appointments
- Afternoon (2-5 PM): School pickups, early commuters, airport surge
- Evening (5-9 PM): Dinner, event arrivals, nightlife start
- Night (9 PM-12 AM): Event exits (SURGE from crowds leaving), bar/club transfers
- Late night (12-3 AM): Bar closings (last call surge), nightlife exodus
- Dead hours (3-6 AM): Airport early departures, hotel shuttles, go home if nothing

=== OUTPUT FORMAT (no asterisks or bold in content — only section labels are bold) ===

**GO:** Where to position — cluster near events/venues, not isolated spots. Quote expected earnings: "$X-Y in surge rides" where appropriate.
**AVOID:** Roads/areas with incidents or competition — name specific road names from the TRAFFIC block.
**WHEN:** Hour-by-hour timing window — consider event END times for exit surge, not just starts. Phase the night if multiple events have different exit windows.
**WHY:** Which specific event/condition is driving this recommendation — reference the NEAR event or the FAR event whose surge flow you're catching.
**IF NO PING:** Wait X minutes, then backup plan — nearby cluster, or head home with destination filter on. Include a fuel-cost sanity check: "Drive to X (12mi, ~$2.40 fuel) for $40-60 surge rides."
**INTEL:** 2-3 sentences of additional context — competitive landscape, upcoming demand shifts, airport opportunities, weather changes, or anything from news that affects the next few hours.

PRINCIPLES:
- DOLLAR-SPECIFIC ADVICE: You have the driver's vehicle class, fuel cost per mile, and earnings goal. Quote dollar figures. "Drive to X (~$2.40 fuel) for $40-60 surge rides" beats "go north."
- NEAR vs FAR EVENTS: Events tagged [NEAR] are within 15mi — recommend them directly with pickup/drop-off pro-tips. Events tagged [FAR] are beyond 15mi — treat as SURGE FLOW INTELLIGENCE only: fans travel FROM hotels/dining/residential clusters near the driver TO the distant event, and that outflow creates pickup demand near the driver. Recommend the closest high-impact venues in the 15-mile radius that benefit from the outflow. NEVER recommend a [FAR] event venue as a destination.
- HOUR-BY-HOUR PHASING: When multiple events have different start/end times, phase the advice. "7-8pm: [NEAR] theater at 7:30 — drop-off surge. 9-10pm: stage at hotel cluster for the [FAR] sports game end — fans from the hotels will ride back."
- ROAD-SPECIFIC AVOID: Name the specific roads and distances from the TRAFFIC block. "Avoid I-35 near exit 428 (3.2mi, closed)."
- FUEL-COST REPOSITIONING: Before recommending a long reposition, compute whether it's worth it: drive distance × fuel cost/mi should be << expected surge revenue.
- NEVER include raw latitude/longitude coordinates in the strategy text. Always refer to locations by name — venue names, neighborhood names, intersection names ("Preston Road and Coit Road"), or landmark names. Coordinates are for internal use only and must never appear in user-facing text.
- Verify timing: cross-reference news published dates against current time — yesterday's surge is over, do not recommend stale opportunities.
- Event END times create bigger surge than start times — crowds leaving = ride demand.
- Stay in clusters (nightlife districts, hotel zones, event complexes) — do not send the driver to isolated one-off venues.
- If nothing is nearby and demand is low, it is OK to recommend heading home with destination filter on — especially if that's within the driver's max_deadhead radius and fuel cost is material.
- Factor in competitive landscape — if autonomous vehicles or new services operate in specific zones, note the impact on demand.
- Reference specific data from the briefing (event names, road names, times).
- Do not use asterisks, bold, or markdown formatting inside the content text — only the section labels (GO, AVOID, WHEN, WHY, IF NO PING, INTEL) should be bold.`;


    // 2026-02-26: Uses STRATEGY_TACTICAL role via callModel adapter (Claude Opus)
    // 2026-04-11: System prompt expanded with the 5 owner directives (dollar-specific
    // advice, NEAR/FAR event reasoning, hour-by-hour phasing, specific roads, fuel-cost
    // repositioning math).
    const response = await callModel('STRATEGY_TACTICAL', {
      system: `You are the Rideshare Strategist Dispatch Authority. A driver and their family depend on the quality of your guidance. You have access to real-time traffic, events, weather, airport conditions, news, AND the driver's preferences (vehicle type, fuel costs, earnings goal, home base). Every recommendation must be actionable, specific, and dollar-aware.

CORE DIRECTIVES:
- You have the driver's vehicle type, fuel costs, and earnings goal. Use these to give DOLLAR-SPECIFIC advice. Quote expected earnings and fuel costs in your recommendations. "Drive to X (12mi, ~$2.40 fuel) for $40-60 in surge rides" beats "go north for surge."
- Every event has a distance from the driver. Events tagged [NEAR] are within 15 miles — recommend them directly as destinations with event-specific pro-tips. Events tagged [FAR] are beyond 15 miles — use them as SURGE FLOW INTELLIGENCE only: fans travel FROM hotels, dining clusters, and residential areas near the driver TO the distant event, and that outflow creates pickup demand NEAR the driver at the departure end. Recommend the closest high-impact venues within 15 miles that will benefit from the outflow. NEVER recommend a [FAR] event venue as a destination — it violates the closest-first invariant.
- Give hour-by-hour phased advice when multiple events have different start/end times. Phase the shift: what to do now, at 7pm, at 9pm, at 11pm.
- Name specific roads and intersections to avoid and specific named areas to stage. Use the TRAFFIC block's AVOID and CLOSURES rows verbatim when relevant.
- Include fuel cost estimates for any repositioning move. A 12-mile drive at 25 mpg and $3.50/gal costs ~$1.70 in fuel — factor that against expected surge revenue before recommending the drive.
- Attendance numbers are heuristic estimates only — never cite attendance numbers, crowd sizes, or capacity figures to the driver. Reason about event impact qualitatively using the high/medium/low demand signal. Use phrases like 'high-demand concert' or 'private event energy' instead of fabricated numbers.

You understand demand patterns: events create surge at END times (exit crowds), airports follow flight schedules, nightlife clusters outperform isolated venues, and sometimes the smartest move is heading home with destination filter on. Every recommendation directly impacts someone's livelihood. Be precise, be honest, be actionable, be dollar-aware.`,
      user: prompt
    });

    if (!response.ok) {
      aiLog.warn(1, `[STRATEGY_TACTICAL] Immediate strategy failed: ${response.error}`, OP.AI);
      return { strategy: '' };
    }

    const strategy = response.output || '';

    if (strategy) {
      aiLog.done(1, `[STRATEGY_TACTICAL] Immediate strategy (${strategy.length} chars)`, OP.AI);
      return { strategy };
    }

    aiLog.warn(1, `[STRATEGY_TACTICAL] Empty response`, OP.AI);
    return { strategy: '' };
  } catch (error) {
    aiLog.warn(1, `Immediate strategy call failed: ${error.message}`, OP.AI);
    return { strategy: '' };
  }
}

/**
 * 2026-02-26: Renamed from callGeminiConsolidator (now uses Claude Opus via callModel).
 * Generate 8-12 hour daily strategy via STRATEGY_DAILY role with retry logic.
 * Handles 503/429 overload errors with exponential backoff.
 */
async function generateDailyStrategy({ prompt, maxTokens = 4096, temperature = 0.2 }) {
  // RETRY CONFIGURATION: 2 attempts with 1s, 2s delays (faster failure, rely on circuit breaker)
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 1000;
  const callStart = Date.now();

  // 2026-02-26: Rideshare Strategist Dispatch Authority — daily shift planning
  const system = 'You are the Rideshare Strategist Dispatch Authority. A driver and their family depend on the quality of your daily shift plan. You have access to real-time traffic, events, weather, airport conditions, and news — use all of it to plan the most profitable 8-12 hour shift possible. You understand demand patterns: event END times create exit surge, airports follow flight schedules, nightlife clusters outperform isolated venues, weather changes trigger surge BEFORE the storm arrives. Every recommendation directly impacts someone\'s livelihood. Be precise, be honest, and when nothing is happening, say so.';

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      if (attempt > 1) {
        aiLog.info(`Consolidator retry attempt ${attempt-1}/${MAX_RETRIES} due to overload...`);
      }

      // 2026-02-11: Use callModel adapter - picks up thinkingLevel HIGH + google_search from registry
      const response = await callModel('STRATEGY_DAILY', { system, user: prompt });

      // Handle Overloaded (503) or Rate Limited (429) from adapter
      if (!response.ok) {
        if (response.error?.includes('503') || response.error?.includes('429')) {
           aiLog.warn(1, `STRATEGY_DAILY busy: ${response.error.substring(0, 100)}`);
           if (attempt <= MAX_RETRIES) {
             const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
             aiLog.info(`Waiting ${delay}ms before retry...`);
             await new Promise(resolve => setTimeout(resolve, delay));
             continue;
           }
           return { ok: false, error: `STRATEGY_DAILY Overloaded after ${MAX_RETRIES} retries` };
        }

        if (response.error?.includes('API key expired')) {
          return { ok: false, error: 'GEMINI_API_KEY expired - update in Secrets' };
        }

        return { ok: false, error: response.error };
      }

      const text = response.output || response.text;

      if (!text) {
        aiLog.warn(1, `STRATEGY_DAILY returned empty response`);
        return { ok: false, error: 'Empty response' };
      }

      const elapsed = Date.now() - callStart;
      aiLog.info(`STRATEGY_DAILY consolidator: ${text.length} chars in ${elapsed}ms`);
      return { ok: true, output: text.trim(), durationMs: elapsed };

    } catch (error) {
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        aiLog.info(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const elapsed = Date.now() - callStart;
      aiLog.error(1, `STRATEGY_DAILY failed after ${elapsed}ms and ${MAX_RETRIES} retries: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }
}

/**
 * Format school closures for strategist summary
 * Shows count, type breakdown, distance from driver, and reopening dates
 * Limits to 8 entries to save tokens in the prompt
 */
/**
 * 2026-01-08: FIX - Filter school closures where TODAY falls between start_date and end_date
 * Uses snapshot.timezone directly - no re-fetching
 * @param {Array} closures - Array of closure objects with start_date/end_date
 * @param {string} timezone - IANA timezone from snapshot (required)
 * @returns {Array} Closures active TODAY only
 */
function filterClosuresActiveToday(closures, timezone) {
  if (!closures || !Array.isArray(closures) || !timezone) return [];

  // Get today's date in snapshot's timezone (YYYY-MM-DD format)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

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
 * 2026-01-08: Format school closures as simple string list (NO JSON)
 * Output: "- Frisco ISD: Closed (Teacher In-Service)"
 * Uses snapshot.timezone directly
 * @param {Array} closures - Array of closure objects
 * @param {string} timezone - IANA timezone from snapshot
 * @returns {string} Simple formatted list
 */
function formatSchoolClosuresSummary(closures, timezone) {
  // Filter to closures active TODAY (start_date <= today <= end_date)
  const activeClosures = filterClosuresActiveToday(closures, timezone);

  if (!activeClosures || activeClosures.length === 0) {
    return 'None today';
  }

  // Simple string list format - NO JSON, minimal tokens
  const lines = activeClosures.slice(0, 10).map(c => {
    const name = c.schoolName || c.name || c.district || 'Unknown';
    const reason = c.reason || c.closure_reason || 'Closed';
    return `- ${name}: ${reason}`;
  });

  if (activeClosures.length > 10) {
    lines.push(`... and ${activeClosures.length - 10} more`);
  }

  return lines.join('\n');
}

/**
 * Parse JSON field safely - handles both string and object formats
 */
function parseJsonField(field) {
  if (!field) return null;
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return null;
    }
  }
  return field;
}

/**
 * 2026-01-08: FIX - Filter events to relevant time window
 * Only include events happening now or soon (not events that are over or too far out)
 * Window: now - 1h to now + 6h
 * @param {Array} events - Array of event objects
 * @param {string} timezone - IANA timezone
 * @returns {Array} Filtered events within time window
 */
// 2026-04-16 (H-2 fix): Rewritten to handle split date/time fields from discovered_events.
// Previous version looked for event.event_start (combined ISO) which doesn't exist —
// discovered_events has separate event_start_date + event_start_time fields. All events
// with unparseable times passed by default, letting wrong-date events into the prompt.
function filterEventsToTimeWindow(events, timezone) {
  if (!events || !Array.isArray(events)) return [];

  // Compute today's date in driver's timezone for date-gating
  const todayLocal = timezone
    ? new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    : new Date().toISOString().split('T')[0];

  return events.filter(event => {
    // HARD GATE: event_start_date must be today in driver's timezone
    const eventDate = event.event_start_date || event.event_date || event.date;
    if (eventDate && eventDate !== todayLocal) {
      aiLog.info(`[event-date-gate] Dropping "${event.title}" — date ${eventDate} != today ${todayLocal}`);
      return false;
    }

    // Time window check: try to build a parseable timestamp
    const eventStart = event.event_start
      || (event.event_start_date && event.event_start_time
        ? `${event.event_start_date}T${event.event_start_time.replace(/\s*(AM|PM)/i, ' $1')}`
        : null)
      || event.start_time || event.time;
    if (!eventStart) return true; // No time info — include (date already gated above)

    const parsed = new Date(eventStart);
    if (isNaN(parsed.getTime())) return true; // Can't parse — include (date already gated)

    const now = new Date();
    const windowStart = new Date(now.getTime() - 60 * 60 * 1000);  // now - 1h
    const windowEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);  // now + 6h
    return parsed >= windowStart && parsed <= windowEnd;
  });
}

/**
 * 2026-01-08: FIX - Optimize event data for LLM payload
 * Strip redundant fields, standardize coordinates to 6 decimals
 * Remove: source, provider (redundant), full address (have coords)
 * Keep: name, venue, time, category, coords (6 decimal), venue_status
 * @param {Array} events - Array of event objects
 * @param {Map} venueStatusMap - Optional map of venueName -> { isOpen, reason }
 * @returns {Array} Optimized events for LLM
 */
/**
 * 2026-01-14: Convert 24h time (HH:MM) to 12h AM/PM format for LLM clarity
 * Examples: "19:00" → "7:00 PM", "09:30" → "9:30 AM", "00:00" → "12:00 AM"
 */
function formatTime12h(timeStr) {
  if (!timeStr) return null;

  // Already has AM/PM - return as-is
  if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) {
    return timeStr;
  }

  // Parse HH:MM format
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;

  const hours = parseInt(parts[0], 10);
  const minutes = parts[1];

  if (isNaN(hours)) return timeStr;

  const suffix = hours >= 12 ? 'PM' : 'AM';
  const standardHour = hours % 12 || 12;

  return `${standardHour}:${minutes} ${suffix}`;
}

/**
 * 2026-02-17: Optimize weather data for LLM.
 * Strips metadata timestamps — the snapshot already tells the LLM what time it is.
 * observedAt is just "when we fetched" noise that confuses the model.
 */
/**
 * 2026-02-26: Return driver-impact summary instead of full JSON blob.
 * The briefing pipeline generates driverImpact at store time (briefing-service.js).
 * Falls back to conditions + temp if driverImpact not yet populated (legacy rows).
 */
function optimizeWeatherForLLM(weather) {
  if (!weather) return 'No weather data';
  if (weather.driverImpact) return weather.driverImpact;
  // Fallback for legacy rows without driverImpact
  const temp = weather.tempF || weather.temperature || '??';
  return `${weather.conditions || 'Unknown conditions'}, ${temp}°F`;
}

// 2026-02-26: Removed optimizeTrafficForLLM — both prompts now use driverImpact summary directly.

/**
 * 2026-01-14: FIX - Use correct field names from briefing-service.js normalization
 * Briefing events have: title, venue, event_start_time, event_end_time, event_type
 * NOT: event_name, name, event_start, category
 */
function optimizeEventsForLLM(events, venueStatusMap = null) {
  if (!events || !Array.isArray(events)) return [];

  return events.map(event => {
    // Standardize coordinates to 6 decimals (lat/longitude come from briefing normalization)
    const lat = event.latitude ? parseFloat(event.latitude).toFixed(6) : null;
    const lng = event.longitude ? parseFloat(event.longitude).toFixed(6) : null;

    // Look up venue open/closed status if we have a map
    const venueName = event.venue_name || event.venue;
    let venueStatus = null;
    if (venueStatusMap && venueName) {
      venueStatus = venueStatusMap.get(venueName.toLowerCase());
    }

    // 2026-01-14: FIX - Use correct field names from briefing-service.js (lines 991-1006)
    // title (not event_name), event_start_time (not event_start), event_type (not category)
    // Also format times to 12h AM/PM for LLM clarity (not military time)
    return {
      // CRITICAL: Include event title so AI knows "Live Band Karaoke" vs generic "Concert"
      event: event.title,
      venue: venueName,
      // Time window for "right now" context (12h format for LLM clarity)
      time: formatTime12h(event.event_start_time),
      end: formatTime12h(event.event_end_time),
      // Use event_type (normalized category from briefing-service)
      type: event.event_type || event.category,
      // Only include coords if we have them (6 decimal precision)
      ...(lat && lng ? { coords: `${lat},${lng}` } : {}),
      // Include distance if available
      ...(event.distance_mi ? { distance: `${event.distance_mi}mi` } : {}),
      // 2026-01-08: Include venue open/closed status from venue_catalog.hours_full_week
      ...(venueStatus?.isOpen != null ? {
        venue_open: venueStatus.isOpen,
        hours_note: venueStatus.reason || ''
      } : {})
      // Deliberately NOT including: source, provider, address (redundant with coords)
    };
  });
}

/**
 * 2026-01-14: "Strategy-Worthy" filter - avoid spamming AI with generic bar events
 * Only include bar events (live_music, nightlife) if they have a "strong signal"
 * (not just generic happy hour or drink specials)
 *
 * @param {Array} events - Array of event objects
 * @returns {Array} Filtered events worth including in strategy
 */
function filterStrategyWorthyEvents(events) {
  if (!events || !Array.isArray(events)) return [];

  return events.filter(event => {
    const category = (event.event_type || event.category || '').toLowerCase();
    const title = (event.title || '').toLowerCase();

    // Always include major event types
    const isMajorEvent = ['concert', 'sports', 'community', 'conference'].includes(category);
    if (isMajorEvent) return true;

    // For bar events (live_music, nightlife), require a "strong signal"
    const isBarEvent = ['live_music', 'nightlife', 'bar'].includes(category);
    if (isBarEvent) {
      // Filter out generic bar noise
      const isGenericNoise =
        title.includes('happy hour') ||
        title.includes('drink special') ||
        title.includes('specials') ||
        title.includes('ladies night') ||
        title === '' ||
        !event.title; // No title = no signal

      if (isGenericNoise) {
        return false; // Skip generic bar events
      }
      // Has a specific event name (e.g., "Live Band Karaoke") - include it
      return true;
    }

    // Include other categories by default
    return true;
  });
}

/**
 * 2026-01-08: Format events summary for LLM (minimal tokens)
 * Now async to support venue hours lookup from venue_catalog
 * @param {Array} events - Array of event objects
 * @param {string} timezone - IANA timezone
 * @returns {Promise<string>} Formatted event summary with venue open/closed status
 */
async function formatEventsForLLM(events, timezone) {
  // Filter to time window first
  const relevantEvents = filterEventsToTimeWindow(events, timezone);

  if (!relevantEvents || relevantEvents.length === 0) {
    return 'No relevant events in the next 6 hours';
  }

  // 2026-01-14: FIX - Filter out generic bar noise (happy hours, specials)
  // Only include bar events that have a "strong signal" (specific event title)
  const strategyWorthy = filterStrategyWorthyEvents(relevantEvents);

  if (strategyWorthy.length === 0) {
    return 'No significant events in the next 6 hours';
  }

  // Extract venue names for batch lookup
  const venueNames = strategyWorthy
    .map(e => e.venue_name || e.venue)
    .filter(Boolean);

  // 2026-01-08: Batch lookup venue hours from venue_catalog
  const venueStatusMap = await batchLookupVenueHours(venueNames, timezone);

  // Optimize and format (now includes venue open/closed status)
  const optimized = optimizeEventsForLLM(strategyWorthy, venueStatusMap);

  // Limit to 15 most relevant events to save tokens
  const limited = optimized.slice(0, 15);

  return JSON.stringify(limited, null, 1); // Minimal indentation
}

/**
/**
 * 2026-02-26: Simplified news for strategist — 5 items max.
 * HIGH-impact items include summary (key context for strategy decisions).
 * MEDIUM/LOW items are headline-only (saves tokens).
 * All items include published_date so strategist can judge temporal relevance.
 */
function optimizeNewsForLLM(news) {
  const items = Array.isArray(news) ? news : (news?.items || []);
  if (!items || items.length === 0) return [];

  return items.slice(0, 5).map(item => {
    const entry = {
      headline: item.headline || item.title,
      impact: item.impact || 'medium',
      date: item.published_date || item.date || null
    };
    // HIGH-impact items get summary — these drive strategy decisions
    if (entry.impact === 'high' && item.summary) {
      entry.context = item.summary.slice(0, 150); // Truncate to save tokens
    }
    return entry;
  });
}

/**
 * 2026-02-26: Format news as string list for strategist prompt.
 * HIGH-impact items show context. All items show published date for temporal verification.
 */
function formatNewsForPrompt(newsItems) {
  if (!newsItems || newsItems.length === 0) return 'No relevant news today';
  return newsItems.map(n => {
    const date = n.date ? ` (${n.date})` : '';
    const line = `- [${(n.impact || 'medium').toUpperCase()}] ${n.headline}${date}`;
    return n.context ? `${line}\n  → ${n.context}` : line;
  }).join('\n');
}

/**
 * 2026-02-26: Simplified airport data — generate travelImpact summary, strip source noise.
 * Handles both single airport and multi-airport (airports array) formats.
 */
function optimizeAirportForLLM(airport) {
  if (!airport) return 'No airport data';

  // Handle airports array format from fetchAirportConditions()
  const airports = airport.airports || [];
  if (airports.length === 0 && !airport.code) {
    return airport.recommendations || 'No airport data available';
  }

  // Single airport (legacy) or first airport from array
  const primary = airports[0] || airport;
  const code = primary.code || airport.code || airport.airport_code || '???';
  const delays = primary.delays || airport.delays || airport.delay_status || 'normal operations';
  const status = primary.status || 'normal';
  const busyTimes = primary.busyTimes || [];
  const recommendations = airport.recommendations || '';

  // Generate concise travelImpact summary
  const parts = [`${code}:`];

  if (status === 'severe_delays') {
    parts.push(`severe delays (${delays}) — high surge at terminal pickup`);
  } else if (status === 'delays') {
    parts.push(`delays (${delays}) — moderate surge opportunity`);
  } else {
    parts.push('normal operations');
  }

  if (busyTimes.length > 0) {
    parts.push(`Peak: ${busyTimes.slice(0, 2).join(', ')}`);
  }

  // Add other airports briefly
  if (airports.length > 1) {
    const others = airports.slice(1).map(a =>
      `${a.code || '???'}: ${a.status === 'delays' || a.status === 'severe_delays' ? a.delays : 'normal'}`
    );
    parts.push(others.join('; '));
  }

  if (recommendations) {
    parts.push(recommendations);
  }

  return parts.join('. ');
}

/**
 * 2026-01-08: Batch lookup venue hours from venue_catalog
 * Uses hours_full_week structured JSON for programmatic isOpen() checks
 * Falls back to business_hours if hours_full_week not populated
 *
 * @param {Array} venueNames - Array of venue names to lookup
 * @param {string} timezone - IANA timezone for isOpen calculation
 * @returns {Promise<Map>} Map of venueName -> { isOpen, nextChange, reason }
 */
// ============================================================================
// 2026-04-11: STRATEGIST ENRICHMENT HELPERS
// ============================================================================
// See server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md for full design.
//
// These helpers enrich the STRATEGY_TACTICAL / STRATEGY_DAILY prompts with:
//   1. Driver preferences (vehicle class, fuel economy, earnings goal, etc.)
//   2. Full traffic intelligence (incidents/closures/avoid/highDemandZones)
//   3. Event distance annotation with NEAR/FAR bucketing (15-mile threshold)
//   4. 6-hour weather forecast timeline with storm risk detection
//   5. Event capacity heuristic for scale awareness
//   6. Home base context (distinct from current snapshot position)
//   7. Earnings math context (rates, fuel cost/mile, net, required $/hr)
//
// DESIGN PRINCIPLE — ADDITIVE: Every helper degrades gracefully when a field
// is null, a row is missing, or the driver_profiles schema migration hasn't
// been applied yet. The pipeline NEVER breaks on missing enrichment data.
//
// The schema migration (add 4 columns to driver_profiles) is documented in
// the plan file section 5 and docs/review-queue/pending.md as follow-up work.
// Until it runs, all new preference fields fall through to owner-specified
// defaults. After it runs, real values are picked up automatically.
// ============================================================================

/**
 * Haversine distance in miles between two lat/lng points. Returns Infinity
 * when either point has null coordinates so callers can filter or sort
 * "unknown distance" events to the bottom without special-casing.
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sensible defaults for driver preferences (plan file section 4). */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export const DRIVER_PREF_DEFAULTS = Object.freeze({
  fuel_economy_mpg: 25,
  earnings_goal_daily: null,
  shift_hours_target: null,
  max_deadhead_mi: 15,
  vehicle_class: 'UberX',
});

/**
 * Default rate cards by vehicle class. Illustrative baselines labeled as
 * "estimated" in the prompt — replaceable whenever live market rates are wired
 * in. Keys match the vehicle_class values deriveVehicleClass() returns.
 */
const RATE_DEFAULTS = Object.freeze({
  'UberX':          { perMile: 0.80, perMin: 0.20 },
  'Uber Comfort':   { perMile: 1.20, perMin: 0.25 },
  'UberXL':         { perMile: 1.00, perMin: 0.22 },
  'UberXXL':        { perMile: 1.10, perMin: 0.24 },
  'Uber Black':     { perMile: 2.50, perMin: 0.50 },
  'Uber Black SUV': { perMile: 3.50, perMin: 0.70 },
});

// Default gas price per gallon for fuel cost math (replaceable via env var).
const DEFAULT_GAS_PRICE = Number(process.env.GAS_PRICE_DEFAULT || 3.50);
// Electric vehicle cost per mile (covers typical electricity cost for rideshare EVs).
const EV_COST_PER_MILE = 0.04;
// NEAR/FAR distance threshold — matches VENUE_SCORER's 15-mile rule so the
// strategist and Smart Blocks pipeline share a consistent mental model.
const NEAR_EVENT_RADIUS_MILES = 15;

/**
 * Derive the driver's primary vehicle class from driver_profiles.elig_*
 * booleans. Highest-tier-eligible wins. The class name is also the key into
 * RATE_DEFAULTS, so earnings math lines up with whatever class we derive.
 */
function deriveVehicleClass(profile) {
  if (!profile) return DRIVER_PREF_DEFAULTS.vehicle_class;
  if (profile.elig_luxury_suv)   return 'Uber Black SUV';
  if (profile.elig_luxury_sedan) return 'Uber Black';
  if (profile.elig_xxl)          return 'UberXXL';
  if (profile.elig_xl)           return 'UberXL';
  if (profile.elig_comfort)      return 'Uber Comfort';
  if (profile.elig_economy)      return 'UberX';
  return DRIVER_PREF_DEFAULTS.vehicle_class;
}

/**
 * Load a normalized driver_preferences object for a user. Always returns a
 * well-formed object even when:
 *   - user_id is null
 *   - driver_profiles row doesn't exist
 *   - schema migration hasn't applied (new columns missing, PG error 42703)
 *   - any other DB error
 *
 * Defaults are applied for fields that are null or unavailable. Callers get a
 * consistent shape regardless of schema state.
 */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export async function loadDriverPreferences(userId) {
  const prefs = {
    vehicle_class: DRIVER_PREF_DEFAULTS.vehicle_class,
    fuel_economy_mpg: DRIVER_PREF_DEFAULTS.fuel_economy_mpg,
    earnings_goal_daily: DRIVER_PREF_DEFAULTS.earnings_goal_daily,
    shift_hours_target: DRIVER_PREF_DEFAULTS.shift_hours_target,
    max_deadhead_mi: DRIVER_PREF_DEFAULTS.max_deadhead_mi,
    is_electric: false,
    home_lat: null,
    home_lng: null,
    home_formatted_address: null,
    driver_nickname: null,
    rideshare_platforms: null,
    profile_loaded: false,
    migration_applied: false,
  };

  if (!userId) return prefs;

  try {
    // First try: full SELECT (assumes migration has run).
    // On PG error 42703 ("column does not exist"), fall back to the safe column set.
    let row = null;
    try {
      const rows = await db.select().from(driver_profiles)
        .where(eq(driver_profiles.user_id, userId))
        .limit(1);
      row = rows[0] || null;
      prefs.migration_applied = true;
    } catch (err) {
      const pgCode = err?.cause?.code || err?.original?.code || err?.code;
      const msg = err?.cause?.message || err?.message || '';
      if (pgCode === '42703' || /column.*does not exist/i.test(msg)) {
        // Schema migration hasn't applied — select only columns known to exist.
        const rows = await db.select({
          user_id: driver_profiles.user_id,
          first_name: driver_profiles.first_name,
          driver_nickname: driver_profiles.driver_nickname,
          home_lat: driver_profiles.home_lat,
          home_lng: driver_profiles.home_lng,
          home_formatted_address: driver_profiles.home_formatted_address,
          market: driver_profiles.market,
          rideshare_platforms: driver_profiles.rideshare_platforms,
          elig_economy: driver_profiles.elig_economy,
          elig_xl: driver_profiles.elig_xl,
          elig_xxl: driver_profiles.elig_xxl,
          elig_comfort: driver_profiles.elig_comfort,
          elig_luxury_sedan: driver_profiles.elig_luxury_sedan,
          elig_luxury_suv: driver_profiles.elig_luxury_suv,
          attr_electric: driver_profiles.attr_electric,
        }).from(driver_profiles)
          .where(eq(driver_profiles.user_id, userId))
          .limit(1);
        row = rows[0] || null;
        prefs.migration_applied = false;
      } else {
        throw err;
      }
    }

    if (!row) return prefs;

    prefs.profile_loaded = true;
    prefs.vehicle_class = deriveVehicleClass(row);
    prefs.is_electric = !!row.attr_electric;
    prefs.home_lat = row.home_lat;
    prefs.home_lng = row.home_lng;
    prefs.home_formatted_address = row.home_formatted_address;
    prefs.driver_nickname = row.driver_nickname || row.first_name || null;
    prefs.rideshare_platforms = row.rideshare_platforms || null;

    // New preference fields — only present when migration has applied.
    if (prefs.migration_applied) {
      if (row.fuel_economy_mpg != null) prefs.fuel_economy_mpg = row.fuel_economy_mpg;
      if (row.earnings_goal_daily != null) prefs.earnings_goal_daily = Number(row.earnings_goal_daily);
      if (row.shift_hours_target != null) prefs.shift_hours_target = Number(row.shift_hours_target);
      if (row.max_deadhead_mi != null) prefs.max_deadhead_mi = row.max_deadhead_mi;
    }

    return prefs;
  } catch (err) {
    aiLog.warn(1, `[strategist-enrichment] loadDriverPreferences failed for ${userId}: ${err.message}`, OP.DB);
    return prefs;
  }
}

/**
 * Compute per-mile fuel/energy cost based on vehicle type and preference data.
 * Returns the cost as a number (dollars per mile).
 */
function computeFuelCostPerMile(prefs) {
  if (prefs.is_electric) return EV_COST_PER_MILE;
  const mpg = Math.max(prefs.fuel_economy_mpg, 1);
  return DEFAULT_GAS_PRICE / mpg;
}

/**
 * Build the DRIVER PREFERENCES prompt section (single compact line).
 * Token budget: ~80 tokens.
 */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export function buildDriverPreferencesSection(prefs) {
  const fuelType = prefs.is_electric ? 'electric' : 'gas';
  const mpgDisplay = prefs.is_electric ? 'n/a (EV)' : `${prefs.fuel_economy_mpg} mpg`;
  const perMileCost = computeFuelCostPerMile(prefs);
  const goalDisplay = prefs.earnings_goal_daily != null
    ? `$${prefs.earnings_goal_daily.toFixed(0)}`
    : 'not set';
  const hoursDisplay = prefs.shift_hours_target != null ? `${prefs.shift_hours_target}` : 'not set';

  return `Vehicle: ${prefs.vehicle_class} | Fuel economy: ${mpgDisplay} (${fuelType}) | Cost/mile: ~$${perMileCost.toFixed(2)} | Today's goal: ${goalDisplay} in ${hoursDisplay} hours | Max deadhead: ${prefs.max_deadhead_mi} mi from home`;
}

/**
 * Build the EARNINGS CONTEXT prompt section — pre-computed economics the
 * strategist can quote directly. Omits the required-$/hr line when goal/hours
 * are not set. Token budget: ~180 tokens.
 */
function buildEarningsContextSection(prefs) {
  const rate = RATE_DEFAULTS[prefs.vehicle_class] || RATE_DEFAULTS['UberX'];
  const perMileCost = computeFuelCostPerMile(prefs);
  const netPerMile = rate.perMile - perMileCost;

  const lines = [];
  lines.push(`Vehicle class: ${prefs.vehicle_class} | Estimated rate: ~$${rate.perMile.toFixed(2)}/mi + $${rate.perMin.toFixed(2)}/min`);
  if (prefs.is_electric) {
    lines.push(`Fuel cost: ~$${EV_COST_PER_MILE.toFixed(2)}/mi (electric)`);
  } else {
    lines.push(`Fuel cost: $${DEFAULT_GAS_PRICE.toFixed(2)}/gal ÷ ${prefs.fuel_economy_mpg} mpg = ~$${perMileCost.toFixed(2)}/mi (gas)`);
  }
  lines.push(`Net per mile: ~$${netPerMile.toFixed(2)}/mi`);
  if (prefs.earnings_goal_daily != null && prefs.shift_hours_target != null && prefs.shift_hours_target > 0) {
    const perHourGross = prefs.earnings_goal_daily / prefs.shift_hours_target;
    lines.push(`To earn $${prefs.earnings_goal_daily.toFixed(0)} in ${prefs.shift_hours_target}hrs: need ~$${perHourGross.toFixed(0)}/hr gross`);
  }
  lines.push(`Surge multiplier on event nights: typically 1.5-3x in the first 30 min after major event end times`);
  return lines.join('\n');
}

/**
 * Build the home-base context line. Returns null when home fields are not
 * populated (caller omits the line entirely). The strategist should interpret
 * absence as "use current position as home."
 */
function buildHomeBaseLine(snapshot, prefs) {
  if (prefs.home_lat == null || prefs.home_lng == null) return null;
  const distFromHome = haversineMiles(snapshot.lat, snapshot.lng, prefs.home_lat, prefs.home_lng);
  const distDisplay = Number.isFinite(distFromHome)
    ? ` — ${distFromHome.toFixed(1)} mi from current position`
    : '';
  const homeAddress = prefs.home_formatted_address
    || `${Number(prefs.home_lat).toFixed(6)}, ${Number(prefs.home_lng).toFixed(6)}`;
  return `Home base: ${homeAddress}${distDisplay}`;
}

/**
 * INTERNAL RANKING HEURISTIC ONLY — never surface these numbers to the user-facing prompt.
 * Used by the ranking pipeline for weight/priority math. The driver-facing strategist
 * sees only qualitative demand levels (high/medium/low) per DECISIONS.md capacity doctrine.
 *
 * Heuristic event capacity estimate from venue name + category + expected_
 * attendance. See plan file section 4 enrichment 5 for the table.
 */
function estimateEventCapacity(event) {
  const category = (event.category || '').toLowerCase();
  const venueName = (event.venue_name || '').toLowerCase();
  const attendance = (event.expected_attendance || 'medium').toLowerCase();

  // Venue-type heuristic (strongest signal)
  if (/stadium|arena|coliseum|speedway/.test(venueName)) return 18000;
  if (/pavilion|amphitheater|amphitheatre/.test(venueName)) return 12000;
  if (/convention center|expo center|fairgrounds/.test(venueName)) return 8000;
  if (/theater|theatre|playhouse|opera house|hall/.test(venueName)) return 2000;
  if (/comedy club|comedy cellar/.test(venueName)) return 350;
  if (/nightclub|club/.test(venueName) && category === 'nightlife') return 1000;

  // Category fallback
  if (category === 'sports') return 15000;
  if (category === 'concert') return 10000;
  if (category === 'festival') return 8000;
  if (category === 'theater') return 2000;
  if (category === 'comedy') return 350;
  if (category === 'nightlife') return 500;

  // Expected_attendance 3-level fallback
  if (attendance === 'high') return 5000;
  if (attendance === 'low') return 200;
  return 1000; // medium default
}

/**
 * Annotate events with distance and capacity, then bucket into NEAR / FAR /
 * unknown-distance groups. NEAR events are sorted closest-first; FAR events
 * are sorted by impact (high attendance first) then distance.
 *
 * Events receive new fields: distance_mi, estimated_attendance.
 * The source fields (venue_lat, venue_lng) are already present in
 * briefings.events from the venue_catalog LEFT JOIN — no extra DB query.
 */
function annotateAndBucketEvents(events, driverLat, driverLng) {
  const annotated = (events || []).map(e => ({
    ...e,
    distance_mi: haversineMiles(driverLat, driverLng, e.venue_lat, e.venue_lng),
    estimated_attendance: estimateEventCapacity(e),
  }));

  const near = annotated
    .filter(e => Number.isFinite(e.distance_mi) && e.distance_mi <= NEAR_EVENT_RADIUS_MILES)
    .sort((a, b) => {
      // Impact-weighted sort: capacity / (1 + distance) — higher score = better event
      // A stadium at 7mi (1875) beats karaoke at 3mi (87). See Memory #106.
      const scoreA = (a.estimated_attendance || 1000) / (1 + a.distance_mi);
      const scoreB = (b.estimated_attendance || 1000) / (1 + b.distance_mi);
      return scoreB - scoreA; // descending — highest impact first
    });

  const far = annotated
    .filter(e => Number.isFinite(e.distance_mi) && e.distance_mi > NEAR_EVENT_RADIUS_MILES)
    .sort((a, b) => {
      const aHigh = a.expected_attendance === 'high' ? 1 : 0;
      const bHigh = b.expected_attendance === 'high' ? 1 : 0;
      if (aHigh !== bHigh) return bHigh - aHigh;
      return a.distance_mi - b.distance_mi;
    });

  const unknown = annotated.filter(e => !Number.isFinite(e.distance_mi));

  return { near, far, unknown };
}

/**
 * Format an event list for the strategist prompt with distance annotation,
 * NEAR/FAR tags, and capacity labels. Prioritizes NEAR events in the slice
 * (all near first, then highest-impact far, then unknowns).
 *
 * Reuses the existing filterEventsToTimeWindow + filterStrategyWorthyEvents +
 * batchLookupVenueHours pipeline — no behavior change to those steps.
 *
 * Limit is 15 for the immediate strategist and 20 for the daily strategist.
 */
async function formatEventsForStrategist(events, snapshot, limit = 15) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return 'No relevant events in the next 6 hours';
  }

  const relevant = filterEventsToTimeWindow(events, snapshot.timezone);
  if (!relevant || relevant.length === 0) {
    return 'No relevant events in the next 6 hours';
  }

  // 2026-04-16 (H-2 fix): Belt-and-suspenders date gate — drop any event whose
  // event_start_date doesn't match today in the driver's timezone. Catches events
  // that Gemini stored with wrong dates (e.g., Dallas Pulse Apr 17 stored as Apr 16).
  const todayLocal = snapshot.timezone
    ? new Date().toLocaleDateString('en-CA', { timeZone: snapshot.timezone })
    : new Date().toISOString().split('T')[0];
  const dateGated = relevant.filter(e => {
    const d = e.event_start_date || e.event_date || e.date;
    if (d && d !== todayLocal) {
      aiLog.info(`[strategist-date-gate] Dropping "${e.title}" — stored date ${d} != today ${todayLocal}`);
      return false;
    }
    return true;
  });
  if (dateGated.length === 0) {
    return 'No relevant events in the next 6 hours';
  }

  const worthy = filterStrategyWorthyEvents(dateGated);
  if (worthy.length === 0) {
    return 'No significant events in the next 6 hours';
  }

  const { near, far, unknown } = annotateAndBucketEvents(worthy, snapshot.lat, snapshot.lng);
  const prioritized = [...near, ...far, ...unknown].slice(0, limit);

  // Batch-look-up venue hours for open/closed flag (existing behavior)
  const venueNames = prioritized.map(e => e.venue_name || e.venue).filter(Boolean);
  const venueStatusMap = await batchLookupVenueHours(venueNames, snapshot.timezone);

  const lines = prioritized.map(e => {
    const bucket = !Number.isFinite(e.distance_mi)
      ? '[?mi]'
      : e.distance_mi <= NEAR_EVENT_RADIUS_MILES
        ? `[NEAR ${e.distance_mi.toFixed(1)}mi]`
        : `[FAR ${e.distance_mi.toFixed(1)}mi]`;

    const start = formatTime12h(e.event_start_time);
    const end = formatTime12h(e.event_end_time);
    const category = e.category || 'event';
    const impact = (e.expected_attendance || '').toLowerCase() === 'high' ? ' HIGH IMPACT' : '';
    // Attendance numbers intentionally removed from prompt. Heuristic estimates were
    // causing 3-40x hallucination amplification when LLM treated them as ground truth.
    // See DECISIONS.md four-hop rule: if a field is heuristic, never present it as fact.
    const capacity = '';
    const venue = e.venue_name || e.venue || 'Unknown venue';

    const venueKey = venue.toLowerCase();
    const venueStatus = venueStatusMap.get(venueKey);
    const openFlag = venueStatus?.isOpen === false ? ' [CLOSED NOW]' : '';

    return `${bucket} ${e.title} — ${venue} — ${start}-${end} — ${category}${impact}${capacity}${openFlag}`;
  });

  return lines.join('\n');
}

/**
 * Build the TRAFFIC intelligence block. Reads the enriched traffic_conditions
 * shape (structured incidents, closures, highDemandZones, congestionLevel)
 * when available. Falls back to the Gemini-analyzed shape (avoidAreas,
 * keyIssues, driverImpact strings) when raw data isn't persisted — this is
 * the path for any briefings written before the analyzeTrafficWithGemini
 * additive change.
 *
 * Graceful degradation ladder:
 *   1. Full structured data (incidents + closures + congestion + highDemandZones)
 *   2. Only Gemini analysis (avoidAreas + keyIssues + closuresSummary)
 *   3. Only driverImpact (single line — worst case, matches current behavior)
 */
function formatTrafficIntelForStrategist(traffic) {
  if (!traffic) return 'TRAFFIC: No traffic data available';

  const lines = [];
  const impact = traffic.driverImpact || traffic.headline || traffic.summary || 'Normal conditions';
  const congestion = traffic.congestionLevel && traffic.congestionLevel !== 'unknown'
    ? ` | Congestion: ${traffic.congestionLevel}`
    : '';
  lines.push(`TRAFFIC: ${impact}${congestion}`);

  const avoidAreas = Array.isArray(traffic.avoidAreas) ? traffic.avoidAreas.slice(0, 5) : [];
  if (avoidAreas.length > 0) {
    lines.push(`AVOID: ${avoidAreas.join(' | ')}`);
  }

  const closures = Array.isArray(traffic.closures) ? traffic.closures.slice(0, 5) : [];
  if (closures.length > 0) {
    const closureStrs = closures.map(c => {
      const road = c.road || 'Local road';
      const dist = c.distanceFromDriver != null ? `${c.distanceFromDriver}mi` : '?mi';
      const category = c.category || 'closed';
      return `${road} (${dist}, ${category})`;
    });
    lines.push(`CLOSURES: ${closureStrs.join(' | ')}`);
  }

  // Structured top incidents (non-closure) by severity/magnitude descending
  const incidentsArr = Array.isArray(traffic.incidents) ? traffic.incidents : [];
  const topIncidents = incidentsArr
    .filter(i => !['Road Closed', 'Lane Closed'].includes(i.category))
    .sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))
    .slice(0, 5);
  if (topIncidents.length > 0) {
    const incidentStrs = topIncidents.map(i => {
      const road = i.road || 'Local road';
      const dist = i.distanceFromDriver != null ? `${i.distanceFromDriver}mi` : '?mi';
      const delay = i.delayMinutes ? `${i.delayMinutes}min delay` : '';
      const severity = i.magnitude ? `severity ${i.magnitude}` : '';
      const desc = [i.category, severity, delay].filter(Boolean).join(', ');
      return `${road} (${dist}, ${desc})`;
    });
    lines.push(`TOP INCIDENTS: ${incidentStrs.join(' | ')}`);
  }

  // Fallback: no structured data → use Gemini's keyIssues as mid-tier signal
  if (topIncidents.length === 0 && closures.length === 0) {
    const keyIssues = Array.isArray(traffic.keyIssues) ? traffic.keyIssues.slice(0, 3) : [];
    if (keyIssues.length > 0) {
      lines.push(`KEY ISSUES: ${keyIssues.join(' | ')}`);
    }
  }

  const highDemandZones = Array.isArray(traffic.highDemandZones) ? traffic.highDemandZones.slice(0, 5) : [];
  if (highDemandZones.length > 0) {
    const zoneStrs = highDemandZones
      .map(z => typeof z === 'string' ? z : (z.name || z.description || ''))
      .filter(Boolean);
    if (zoneStrs.length > 0) {
      lines.push(`HIGH-DEMAND ZONES: ${zoneStrs.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a compact weather block with current conditions + 6-hour forecast
 * timeline. Reads briefings.weather_forecast (already populated — see
 * briefing-service.js:1680–1708). Adds a ⚠️ STORM RISK warning line when
 * any hour's precipitationProbability > 30%.
 *
 * Fallback: if weather_forecast is empty/missing, emits only the driverImpact
 * line (current behavior).
 */
function formatWeatherForStrategist(weatherCurrent, weatherForecast, timezone) {
  if (!weatherCurrent) return 'WEATHER: No weather data';

  const lines = [];
  const currentLine = weatherCurrent.driverImpact
    || `${weatherCurrent.conditions || 'Unknown conditions'}, ${weatherCurrent.tempF || weatherCurrent.temperature || '??'}°F`;
  lines.push(`WEATHER: ${currentLine}`);

  if (!Array.isArray(weatherForecast) || weatherForecast.length === 0) {
    return lines.join('\n');
  }

  // Format an hour label in the driver's timezone (e.g., "7pm")
  const formatHourLabel = (iso) => {
    if (!iso) return '?';
    try {
      const date = new Date(iso);
      if (isNaN(date.getTime())) return '?';
      if (!timezone) return '?';
      return date.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: true
      }).replace(/\s+/g, '').toLowerCase().replace(':00', '');
    } catch {
      return '?';
    }
  };

  const hoursToShow = weatherForecast.slice(0, 6);
  const timelineParts = hoursToShow.map(h => {
    const temp = h.tempF != null ? `${Math.round(h.tempF)}°F` : '?°F';
    const precip = h.precipitationProbability != null
      ? ` (${Math.round(h.precipitationProbability)}% precip)`
      : '';
    return `${temp}@${formatHourLabel(h.time)}${precip}`;
  });
  lines.push(`6hr forecast: ${timelineParts.join(' → ')}`);

  // Storm risk detection — first hour with precip > 30%
  const stormHour = hoursToShow.find(h => (h.precipitationProbability || 0) > 30);
  if (stormHour) {
    lines.push(`⚠️ STORM RISK: ${formatHourLabel(stormHour.time)} (${Math.round(stormHour.precipitationProbability)}% precip) — factor into positioning`);
  }

  return lines.join('\n');
}

// ============================================================================
// END STRATEGIST ENRICHMENT HELPERS
// ============================================================================

async function batchLookupVenueHours(venueNames, timezone) {
  const venueStatusMap = new Map();

  if (!venueNames || venueNames.length === 0 || !timezone) {
    return venueStatusMap;
  }

  // Dedupe venue names (case-insensitive)
  const uniqueNames = [...new Set(venueNames.map(n => n?.toLowerCase()).filter(Boolean))];

  if (uniqueNames.length === 0) {
    return venueStatusMap;
  }

  try {
    // Query venue_catalog for matching venues (case-insensitive match)
    const venues = await db
      .select({
        venue_name: venue_catalog.venue_name,
        hours_full_week: venue_catalog.hours_full_week,
        business_hours: venue_catalog.business_hours,
        last_known_status: venue_catalog.last_known_status
      })
      .from(venue_catalog)
      .where(
        sql`LOWER(${venue_catalog.venue_name}) IN (${sql.join(uniqueNames.map(n => sql`${n}`), sql`, `)})`
      )
      .limit(100);

    // Process each venue's hours
    for (const venue of venues) {
      const hoursData = venue.hours_full_week || venue.business_hours;

      // Skip if permanently closed
      if (venue.last_known_status === 'permanently_closed') {
        venueStatusMap.set(venue.venue_name.toLowerCase(), {
          isOpen: false,
          reason: 'Permanently closed'
        });
        continue;
      }

      // Use isOpenNow() if we have structured hours
      if (hoursData && typeof hoursData === 'object') {
        const status = isOpenNow(hoursData, timezone);
        venueStatusMap.set(venue.venue_name.toLowerCase(), status);
      }
    }

    triadLog.phase(3, `[venue-hours] Looked up ${venues.length}/${uniqueNames.length} venues`);
  } catch (error) {
    triadLog.warn(`[venue-hours] Batch lookup failed: ${error.message}`);
  }

  return venueStatusMap;
}

/**
 * Run consolidation using STRATEGY_DAILY role as "Tactical Dispatcher"
 * Generates 8-12 hour daily strategy from snapshot + briefing data
 * Writes to strategies.consolidated_strategy
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot row to avoid redundant DB reads
 */
export async function runConsolidator(snapshotId, options = {}) {
  const startTime = Date.now();
  triadLog.phase(3, `Starting for ${snapshotId.slice(0, 8)}`);

  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const { snapshots } = await import('../../../../shared/schema.js');
      const [row] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // 2026-04-04: Avoid nested array destructuring — if a query returns unexpected shape,
    // the inner destructuring throws "(intermediate value) is not iterable".
    const [strategyRows, briefingRows] = await Promise.all([
      db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1),
      db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1)
    ]);
    const strategyRow = strategyRows?.[0];
    const briefingRow = briefingRows?.[0];

    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }

    if (!briefingRow) {
      throw new Error(`Briefing row not found for snapshot ${snapshotId}`);
    }

    // Check if already consolidated
    if (strategyRow?.consolidated_strategy && strategyRow?.status === 'ok') {
      triadLog.info(`Already consolidated - skipping`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }

    // Parse briefing JSON fields
    const trafficData = parseJsonField(briefingRow.traffic_conditions);
    const rawEventsData = parseJsonField(briefingRow.events);
    const rawNewsData = parseJsonField(briefingRow.news);
    const weatherData = parseJsonField(briefingRow.weather_current);
    // 2026-04-11: Added weather_forecast parse — STRATEGIST ENRICHMENT #4.
    // Previously, weather_forecast was populated by the briefing pipeline but never
    // read by the consolidator. The new formatWeatherForStrategist helper consumes it.
    const weatherForecastData = parseJsonField(briefingRow.weather_forecast);
    const closuresData = parseJsonField(briefingRow.school_closures);
    const airportData = parseJsonField(briefingRow.airport_conditions);

    // Apply canonical validation at READ time for legacy briefings
    // New briefings are validated at STORE time in briefing-service.js
    const eventsData = filterEventsReadTime(rawEventsData);

    // Filter out deactivated news for this user
    const newsData = await filterDeactivatedNews(rawNewsData, snapshot.user_id);

    // 2026-04-11: Load driver preferences for STRATEGY_DAILY enrichment.
    // Single indexed lookup on driver_profiles. Returns defaults if user_id is null,
    // profile row is missing, or the schema migration hasn't applied yet.
    const prefs = await loadDriverPreferences(snapshot.user_id);

    triadLog.phase(3, `Briefing data: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}, forecast=${Array.isArray(weatherForecastData) ? weatherForecastData.length + 'hr' : '0hr'}, airport=${!!airportData}, driverProfile=${prefs.profile_loaded ? 'loaded' : 'defaults'}`);

    // 2026-01-14: FIX - NO FALLBACKS rule - require location data from snapshot
    // If snapshot is missing required location fields, it's a bug upstream that must be fixed
    if (!snapshot.city || !snapshot.state) {
      throw new Error(`Snapshot ${snapshotId} missing required location data (city=${snapshot.city}, state=${snapshot.state})`);
    }

    // Get location/time context from SNAPSHOT (not strategies table)
    // Use formatted_address if available, otherwise construct from city/state
    const userAddress = snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`;
    const cityDisplay = snapshot.city;
    const stateDisplay = snapshot.state;
    const lat = snapshot.lat;
    const lng = snapshot.lng;

    // 2026-02-17: Use snapshot directly — it has everything resolved from GlobalHeader
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[snapshot.dow] || 'Unknown';
    const isWeekend = snapshot.dow === 0 || snapshot.dow === 6;
    const localTime = formatLocalTime(snapshot);

    triadLog.phase(3, `Location: ${userAddress}`);
    triadLog.phase(3, `Time: ${localTime} (${snapshot.day_part_key})`);

    // 2026-04-11: Pre-compute enriched prompt sections using the helpers at
    // the top of this file. Each helper degrades gracefully when data is missing.
    // Daily strategist uses 20 events (immediate uses 15) because the 8-12 hour
    // window covers more of the day.
    const eventsBlock = await formatEventsForStrategist(eventsData, snapshot, 20);
    const trafficBlock = formatTrafficIntelForStrategist(trafficData);
    const weatherBlock = formatWeatherForStrategist(weatherData, weatherForecastData, snapshot.timezone);
    const driverPrefBlock = buildDriverPreferencesSection(prefs);
    const earningsBlock = buildEarningsContextSection(prefs);
    const homeBaseLine = buildHomeBaseLine(snapshot, prefs);
    const driverGreeting = prefs.driver_nickname ? ` for ${prefs.driver_nickname}` : '';

    // 2026-02-26: Build Daily Strategy prompt with pre-summarized briefing data.
    // 2026-04-11: Enriched with driver preferences, earnings context, home base,
    // structured traffic intel, weather forecast timeline, and NEAR/FAR event
    // distance annotation. See STRATEGIST_ENRICHMENT_PLAN.md for full rationale.
    const prompt = `You are a STRATEGIC ADVISOR for rideshare drivers${driverGreeting}. Create a comprehensive "Daily Strategy" covering the next 8-12 hours.

=== DRIVER CONTEXT ===
Current position: ${userAddress}
Coordinates: ${lat}, ${lng}
${homeBaseLine || ''}
City: ${cityDisplay}, ${stateDisplay}
Timezone: ${snapshot.timezone}
Current Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${snapshot.day_part_key}
${snapshot.is_holiday ? `HOLIDAY: ${snapshot.holiday}` : ''}

=== DRIVER PREFERENCES ===
${driverPrefBlock}

=== EARNINGS CONTEXT ===
${earningsBlock}

=== BRIEFING DATA ===
${trafficBlock}

EVENTS (today, sorted closest-first, [NEAR] = within 15mi, [FAR] = beyond 15mi — intel only):
${eventsBlock}

${weatherBlock}

NEWS:
${formatNewsForPrompt(optimizeNewsForLLM(newsData))}

SCHOOL CLOSURES:
${formatSchoolClosuresSummary(closuresData, snapshot.timezone)}

AIRPORT:
${optimizeAirportForLLM(airportData)}

=== YOUR TASK ===
Create a DAILY STRATEGY covering the next 8-12 hours. Think like an experienced rideshare dispatcher planning a shift for this specific driver.

KEY PRINCIPLES:
- DOLLAR-SPECIFIC ADVICE: You have the driver's vehicle class, fuel cost per mile, and earnings goal. Quote expected gross and net earnings. "Drive to hotel cluster (8mi, ~$1.60 fuel) to catch 10pm theater exits — expect $80-120 in 2 hours" beats generic "go to the hotel zone."
- NEAR vs FAR EVENTS: Events tagged [NEAR] are within 15mi — recommend them directly as destinations with event-specific staging advice. Events tagged [FAR] are beyond 15mi — treat as SURGE FLOW INTELLIGENCE only: fans travel FROM hotels/dining/residential clusters near the driver TO the distant event, and that outflow creates pickup demand near the driver. Recommend the closest high-impact venues in the 15-mile radius that benefit from the outflow. NEVER recommend a [FAR] event venue as a destination.
- HOUR-BY-HOUR PHASING: Break the shift into phases (morning → afternoon → evening → night → late-night) with specific positioning for each phase based on the events and demand patterns.
- SPECIFIC ROADS: Use the AVOID, CLOSURES, and TOP INCIDENTS rows from the TRAFFIC block verbatim — name the actual roads.
- VERIFY TIMING: Cross-reference news published dates against current time — don't recommend stale opportunities from yesterday
- Event END times create bigger surge than start times (crowds LEAVING = ride demand)
- Airport demand follows flight schedules, not just "go to airport"
- Dead hours (3-6 AM): Be honest — "head home, early airport runs only" — especially if the drive home is within max_deadhead_mi
- Weather changes create surge BEFORE the rain/storm arrives (people scramble for rides) — use the 6hr forecast timeline to predict exactly when

Output 4-6 paragraphs covering:
1. Today's overview: "Today in ${cityDisplay} (${dayOfWeek})..." — what makes today unique based on events, weather, and day-of-week patterns?
2. Time-block strategy: Phase-by-phase positioning. Reference specific events by name with their times.
3. Events impact: Name [NEAR] events as direct destinations with staging advice. For [FAR] events, describe the surge-flow reasoning (which nearby venues benefit).
4. Traffic & hazards: Specific roads to avoid from the TRAFFIC block, and how they affect routing.
5. Peak earning windows: "Your best windows today are..." with specific times, locations, dollar expectations, and WHY.
6. Airport: When to go (peak arrivals), when to avoid (dead periods), delay impacts on demand.
7. Late-night/wind-down: When to call it — last call surge at bars, hotel zone, or head home with destination filter.

STYLE: Strategic, conversational, like advice from an experienced dispatcher who knows this specific driver and their vehicle. Be specific about times, places, roads, and dollar figures.

DO NOT: Give generic advice, list venues without context, output JSON, pad with filler, or recommend a [FAR] event venue as a destination.`;

    aiLog.info(`Consolidator prompt size: ${prompt.length} chars`);

    // Step 5: Call STRATEGY_DAILY role (with BRIEFING_FALLBACK role on failure)
    let result = await generateDailyStrategy({
      prompt,
      maxTokens: 2048,
      temperature: 0.3
    });

    // If STRATEGY_DAILY failed, try BRIEFING_FALLBACK role
    if (!result.ok) {
      aiLog.warn(1, `STRATEGY_DAILY role failed: ${result.error}`);
      aiLog.info(`Trying BRIEFING_FALLBACK role...`);

      // 2026-02-13: Uses BRIEFING_FALLBACK role via callModel adapter (hedged router)
      // Previously called Claude Opus directly; now uses registry-configured model
      // 2026-04-11: Fallback system prompt expanded to match the enriched primary prompt
      // (dollar-specific advice, NEAR/FAR event reasoning).
      const fallbackResult = await callModel('BRIEFING_FALLBACK', {
        system: `You are the Rideshare Strategist Dispatch Authority (fallback). A driver depends on you. Create a daily shift plan with specific times, locations, dollar figures, and demand pattern awareness. You have access to the driver's vehicle class, fuel costs, earnings goal, and home base — use them for dollar-specific advice. Events tagged [NEAR] are within 15mi (candidate venues); [FAR] events are beyond 15mi (surge flow intelligence only, NOT destinations — they violate the 15-mile rule).`,
        user: prompt
      });

      if (fallbackResult.ok) {
        aiLog.info(`BRIEFING_FALLBACK role succeeded`);
        result = { ok: true, output: fallbackResult.output, usedFallback: true };
      } else {
        aiLog.error(1, `Fallback also failed: ${fallbackResult.error}`);
        throw new Error(result.error || 'STRATEGY_DAILY role failed (BRIEFING_FALLBACK also failed)');
      }
    }

    const consolidatedStrategy = result.output;

    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }

    triadLog.phase(3, `Got strategy: ${consolidatedStrategy.length} chars`);
    triadLog.info(`Preview: ${consolidatedStrategy.substring(0, 150)}...`);

    // Step 6: Write ONLY consolidated_strategy to strategies table
    // NOTE: strategy_for_now is handled separately by runImmediateStrategy
    const totalDuration = Date.now() - startTime;

    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    triadLog.done(3, `Saved strategy (${consolidatedStrategy.length} chars)`, totalDuration);

    return {
      ok: true,
      strategy: consolidatedStrategy,
      metrics: {
        strategyLength: consolidatedStrategy.length,
        geminiDurationMs: result.durationMs || 0,
        totalDurationMs: totalDuration
      }
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    triadLog.error(3, `Failed for ${snapshotId.slice(0, 8)} after ${totalDuration}ms`, error);
    
    // Write error to DB (error_code is INTEGER, use error_message for details)
    await db.update(strategies).set({
      status: 'error',
      error_message: `consolidator_failed: ${error.message}`.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    throw error;
  }
}

/**
 * Run IMMEDIATE strategy only (no daily strategy)
 * Called by blocks-fast.js for fast initial load
 * Uses snapshot row + briefing data directly - NO minstrategy required
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot row to avoid redundant DB reads
 * @param {Object} options.briefingRow - Pre-fetched briefing row (2026-01-10: pass fresh briefing directly)
 */
export async function runImmediateStrategy(snapshotId, options = {}) {
  const startTime = Date.now();
  triadLog.phase(3, `Consolidator: Starting immediate strategy for ${snapshotId.slice(0, 8)}`);

  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const { snapshots } = await import('../../../../shared/schema.js');
      const [row] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // 2026-01-10: Use pre-fetched briefing if provided (ensures fresh data is used)
    // This avoids re-reading from DB after runBriefing just wrote it
    let briefingRow = options.briefingRow;
    if (!briefingRow) {
      [briefingRow] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    }

    if (!briefingRow) {
      throw new Error(`Briefing not found for snapshot ${snapshotId}`);
    }

    // 2026-04-05: Validate briefing data is POPULATED, not just placeholder row.
    // DATA CORRECTNESS > SPEED. Strategy with missing data produces bad advice.
    const hasTraffic = briefingRow.traffic_conditions !== null;
    const hasEvents = briefingRow.events !== null;
    const hasWeather = briefingRow.weather_current !== null;
    const hasNews = briefingRow.news !== null;
    const hasAirport = briefingRow.airport_conditions !== null;

    triadLog.phase(3, `[DATA CHECK] traffic=${hasTraffic}, events=${hasEvents}, weather=${hasWeather}, news=${hasNews}, airport=${hasAirport}`);

    if (!hasTraffic && !hasEvents) {
      throw new Error(`Briefing data not ready for snapshot ${snapshotId} (placeholder only - traffic=${hasTraffic}, events=${hasEvents})`);
    }

    // Check if immediate strategy already exists
    const [strategyRow] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    if (strategyRow?.strategy_for_now && strategyRow?.status === 'ok') {
      triadLog.info(`Immediate strategy already exists - skipping`);
      return { ok: true, skipped: true, reason: 'already_exists' };
    }

    // Parse ALL briefing data (not just traffic/events - include news, closures, and airport too)
    const rawNews = parseJsonField(briefingRow.news);
    const filteredNews = await filterDeactivatedNews(rawNews, snapshot.user_id);

    // 2026-01-09: Apply canonical validation at READ time for legacy briefings
    const rawEvents = parseJsonField(briefingRow.events);
    const cleanEvents = filterEventsReadTime(rawEvents);

    const briefing = {
      traffic: parseJsonField(briefingRow.traffic_conditions),
      events: cleanEvents,
      weather: parseJsonField(briefingRow.weather_current),
      // 2026-04-14: FIX Issue F — weather_forecast was missing from immediate path.
      // generateImmediateStrategy() passes it to formatWeatherForStrategist() at line 187.
      // Without it, the 1-hour tactical strategist silently lost the 6-hour forecast timeline.
      weather_forecast: parseJsonField(briefingRow.weather_forecast),
      news: filteredNews,
      school_closures: parseJsonField(briefingRow.school_closures),
      airport: parseJsonField(briefingRow.airport_conditions)
    };

    // 2026-01-09: Fixed double prefix - triadLog already adds [TRIAD 3/4]
    triadLog.phase(3, `${snapshot.formatted_address}`);
    triadLog.phase(3, `Briefing: traffic=${!!briefing.traffic}, events=${!!briefing.events}, news=${!!briefing.news}, closures=${!!briefing.school_closures}, airport=${!!briefing.airport}`);

    // Call STRATEGY_TACTICAL role with snapshot + briefing (NO minstrategy)
    const result = await generateImmediateStrategy({ snapshot, briefing });

    if (!result.strategy) {
      throw new Error('STRATEGY_TACTICAL role returned empty strategy');
    }

    // Write to strategies table
    const totalDuration = Date.now() - startTime;

    await db.update(strategies).set({
      strategy_for_now: result.strategy,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    triadLog.done(3, `Consolidator: Immediate strategy saved (${result.strategy.length} chars)`, totalDuration);

    return {
      ok: true,
      strategy: result.strategy,
      durationMs: totalDuration
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    triadLog.error(3, `Immediate strategy failed after ${totalDuration}ms`, error);

    // Write error to DB (error_code is INTEGER, use error_message for details)
    await db.update(strategies).set({
      status: 'error',
      error_message: `immediate_failed: ${error.message}`.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    throw error;
  }
}
