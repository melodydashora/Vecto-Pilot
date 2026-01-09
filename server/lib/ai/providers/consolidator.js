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
import { strategies, briefings, news_deactivations, venue_catalog } from '../../../../shared/schema.js';
import { eq, inArray, or, ilike, sql } from 'drizzle-orm';
import { callAnthropic } from '../adapters/anthropic-adapter.js';
import { triadLog, aiLog, dbLog, OP } from '../../../logger/workflow.js';
import { isOpenNow } from '../../venue/venue-hours.js';
import { filterInvalidEvents } from '../../briefing/briefing-service.js';

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
    console.error('[consolidator] getDeactivatedNewsHashes error:', error);
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
    triadLog.phase(3, `[consolidator] News filtered: ${originalCount} → ${filteredItems.length} (${originalCount - filteredItems.length} deactivated)`);
  }

  // Return in the same format as received
  if (Array.isArray(newsData)) {
    return filteredItems;
  } else {
    return { ...newsData, items: filteredItems };
  }
}

// BRIEFING_FALLBACK role configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 8000;
const FALLBACK_TEMPERATURE = 0.3;

/**
 * Call STRATEGY_TACTICAL role to generate immediate strategy from snapshot + briefing data
 * NO minstrategy required - STRATEGY_TACTICAL has all the context it needs
 * @param {Object} snapshot - Full snapshot row from DB
 * @param {Object} briefing - Briefing data { traffic, events, weather }
 */
async function callGPT5ForImmediateStrategy({ snapshot, briefing }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    aiLog.warn(1, `OPENAI_API_KEY not configured for immediate strategy`);
    return { strategy: '' };
  }

  // Format time from snapshot - NO FALLBACK for timezone
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = snapshot.dow != null ? dayNames[snapshot.dow] : 'Unknown';
  const isWeekend = snapshot.dow === 0 || snapshot.dow === 6;
  // Only format localTime if we have timezone, otherwise show raw ISO or Unknown
  let localTime = 'Unknown time';
  if (snapshot.local_iso && snapshot.timezone) {
    localTime = new Date(snapshot.local_iso).toLocaleString('en-US', {
      timeZone: snapshot.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } else if (snapshot.local_iso) {
    // No timezone - show ISO without formatting
    localTime = `${snapshot.local_iso} (timezone unknown)`;
  }

  // 60s timeout - fail fast if STRATEGY_TACTICAL role hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    // 2026-01-08: Pre-format events (now async to lookup venue hours from venue_catalog)
    const formattedEvents = await formatEventsForLLM(briefing.events, snapshot.timezone);

    const prompt = `You are a rideshare strategist. Analyze the briefing data and tell the driver what to do RIGHT NOW.

=== DRIVER CONTEXT ===
Location: ${snapshot.city}, ${snapshot.state}
Coords: ${parseFloat(snapshot.lat).toFixed(6)},${parseFloat(snapshot.lng).toFixed(6)}
Time: ${localTime} (${snapshot.day_part_key})
${snapshot.is_holiday ? `HOLIDAY: ${snapshot.holiday}` : ''}

=== BRIEFING DATA ===
TRAFFIC IMPACT: ${briefing.traffic?.driverImpact || briefing.traffic?.headline || 'Normal traffic conditions'}

EVENTS (next 6 hours):
${formattedEvents}

WEATHER: ${JSON.stringify(snapshot.weather)}

NEWS (today):
${JSON.stringify(optimizeNewsForLLM(briefing.news), null, 1)}

SCHOOL CLOSURES (within 10mi):
${formatSchoolClosuresSummary(briefing.school_closures, snapshot.timezone)}

AIRPORT: ${JSON.stringify(optimizeAirportForLLM(briefing.airport))}

=== OUTPUT (500 chars max) ===
Based on ALL the data above, provide a strategic brief:

**GO:** [Area/zone to position - based on events, demand patterns]
**AVOID:** [Roads/areas with incidents from traffic data]
**WHEN:** [Timing window - when to be there, how long the opportunity lasts]
**WHY:** [1 sentence - which specific event/condition is driving this]
**IF NO PING:** [What to do if no rides come - how long to wait, backup move]

RULES:
- Reference SPECIFIC data (event names, road numbers, times from above)
- Use **bold** for area names and road names
- Be concise but complete - driver needs actionable intel
- Do NOT list specific venues (venue cards handle that separately)`;


    // STRATEGY_TACTICAL role with medium reasoning for strategic analysis
    // Note: This model requires max_completion_tokens and reasoning_effort
    // Use "developer" role instead of "system" for newer models
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          { role: 'developer', content: 'You are a rideshare strategy expert. Provide concise, actionable guidance.' },
          { role: 'user', content: prompt }
        ],
        reasoning_effort: 'medium',
        max_completion_tokens: 2000  // Model needs tokens for reasoning + output
      }),
      signal: controller.signal  // Abort after 60s timeout
    });
    clearTimeout(timeoutId);  // Clear timeout on successful response

    if (!response.ok) {
      const errText = await response.text();
      aiLog.warn(1, `[STRATEGY_TACTICAL] Immediate strategy failed (${response.status}): ${errText.substring(0, 200)}`, OP.AI);
      return { strategy: '' };
    }

    const data = await response.json();
    const strategy = data.choices?.[0]?.message?.content || '';

    if (strategy) {
      aiLog.done(1, `[STRATEGY_TACTICAL] Immediate strategy (${strategy.length} chars)`, OP.AI);
      return { strategy };
    }

    aiLog.warn(1, `[STRATEGY_TACTICAL] Empty response. Response: ${JSON.stringify(data).substring(0, 300)}`, OP.AI);
    return { strategy: '' };
  } catch (error) {
    clearTimeout(timeoutId);  // Clean up timeout on error
    const isTimeout = error.name === 'AbortError';
    aiLog.warn(1, `Immediate strategy call failed${isTimeout ? ' (TIMEOUT after 60s)' : ''}: ${error.message}`, OP.AI);
    return { strategy: '' };
  }
}

/**
 * Call STRATEGY_DAILY role with Google Search tool and Retry Logic
 * Handles 503/429 overload errors with exponential backoff
 */
async function callGeminiConsolidator({ prompt, maxTokens = 4096, temperature = 0.2 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    aiLog.error(1, `GEMINI_API_KEY not configured for consolidator`);
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  // RETRY CONFIGURATION: 2 attempts with 1s, 2s delays (faster failure, rely on circuit breaker)
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 1000;
  const callStart = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    // 60s timeout per attempt - fail fast if Gemini hangs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      if (attempt > 1) {
        aiLog.info(`Consolidator retry attempt ${attempt-1}/${MAX_RETRIES} due to overload...`);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,  // Abort after 60s timeout
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
            ],
            generationConfig: {
              thinkingConfig: {
                // STRATEGY_DAILY role model only supports LOW or HIGH thinking levels
                thinkingLevel: "LOW"
              },
              temperature,
              maxOutputTokens: maxTokens
            }
          })
        }
      );

      clearTimeout(timeoutId);  // Clear timeout on any response

      // Handle Overloaded (503) or Rate Limited (429)
      if (response.status === 503 || response.status === 429) {
        const errText = await response.text();
        aiLog.warn(1, `Gemini consolidator busy (${response.status}): ${errText.substring(0, 100)}`);

        if (attempt <= MAX_RETRIES) {
          // Wait before retrying (Exponential Backoff)
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          aiLog.info(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry loop
        }
        return { ok: false, error: `Gemini Overloaded after ${MAX_RETRIES} retries` };
      }

      if (!response.ok) {
        const errText = await response.text();
        aiLog.error(1, `Gemini consolidator API error ${response.status}: ${errText.substring(0, 500)}`);

        if (response.status === 400 && errText.includes('API key expired')) {
          return { ok: false, error: 'GEMINI_API_KEY expired - update in Secrets' };
        }

        return { ok: false, error: `API error ${response.status}` };
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        aiLog.warn(1, `Gemini consolidator returned empty response`);
        return { ok: false, error: 'Empty response' };
      }

      const elapsed = Date.now() - callStart;
      aiLog.info(`Gemini consolidator: ${text.length} chars in ${elapsed}ms`);
      return { ok: true, output: text.trim(), durationMs: elapsed };

    } catch (error) {
      clearTimeout(timeoutId);  // Clean up timeout on error
      const isTimeout = error.name === 'AbortError';
      aiLog.error(1, `Consolidator ${isTimeout ? 'TIMEOUT' : 'network error'} (attempt ${attempt}): ${error.message}`);
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        aiLog.info(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const elapsed = Date.now() - callStart;
      aiLog.error(1, `Consolidator failed after ${elapsed}ms and ${MAX_RETRIES} retries: ${error.message}`);
      return { ok: false, error: isTimeout ? 'TIMEOUT after 60s' : error.message };
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
    // Get start and end dates (support multiple field names)
    const startDate = c.start_date || c.startDate || c.closure_date || c.date;
    const endDate = c.end_date || c.endDate || c.reopening_date || startDate; // Default end = start if single day

    // If no dates at all, exclude (we need date info to validate)
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
function filterEventsToTimeWindow(events, timezone) {
  if (!events || !Array.isArray(events)) return [];

  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000);  // now - 1h
  const windowEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);  // now + 6h

  return events.filter(event => {
    // Try to parse event start time
    const eventStart = event.event_start || event.start_time || event.time;
    if (!eventStart) return true; // Include if no time (assume relevant)

    // Parse event date/time
    const eventDate = new Date(eventStart);
    if (isNaN(eventDate.getTime())) return true; // Include if can't parse

    // Check if within window
    return eventDate >= windowStart && eventDate <= windowEnd;
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
function optimizeEventsForLLM(events, venueStatusMap = null) {
  if (!events || !Array.isArray(events)) return [];

  return events.map(event => {
    // Standardize coordinates to 6 decimals
    const lat = event.lat ? parseFloat(event.lat).toFixed(6) : null;
    const lng = event.lng ? parseFloat(event.lng).toFixed(6) : null;

    // Look up venue open/closed status if we have a map
    const venueName = event.venue_name || event.venue;
    let venueStatus = null;
    if (venueStatusMap && venueName) {
      venueStatus = venueStatusMap.get(venueName.toLowerCase());
    }

    return {
      name: event.event_name || event.name,
      venue: venueName,
      time: event.event_start || event.start_time || event.time,
      end: event.event_end || event.end_time,
      category: event.category || event.event_type,
      // Only include coords if we have them (6 decimal precision)
      ...(lat && lng ? { coords: `${lat},${lng}` } : {}),
      // Include distance if available
      ...(event.distance_mi ? { distance: `${event.distance_mi}mi` } : {}),
      // 2026-01-08: Include venue open/closed status from venue_catalog.hours_full_week
      // Guard against undefined venueStatus (use ?. for safe navigation)
      ...(venueStatus?.isOpen != null ? {
        venue_open: venueStatus.isOpen,
        hours_note: venueStatus.reason || ''
      } : {})
      // Deliberately NOT including: source, provider, address (redundant with coords)
    };
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

  // Extract venue names for batch lookup
  const venueNames = relevantEvents
    .map(e => e.venue_name || e.venue)
    .filter(Boolean);

  // 2026-01-08: Batch lookup venue hours from venue_catalog
  const venueStatusMap = await batchLookupVenueHours(venueNames, timezone);

  // Optimize and format (now includes venue open/closed status)
  const optimized = optimizeEventsForLLM(relevantEvents, venueStatusMap);

  // Limit to 15 most relevant events to save tokens
  const limited = optimized.slice(0, 15);

  return JSON.stringify(limited, null, 1); // Minimal indentation
}

/**
 * 2026-01-08: Optimize news data for LLM payload
 * Strip redundant fields like source, provider info
 * @param {Array|Object} news - News data (array or {items: []})
 * @returns {Array} Optimized news for LLM
 */
function optimizeNewsForLLM(news) {
  // Handle both array and {items: []} format
  const items = Array.isArray(news) ? news : (news?.items || []);
  if (!items || items.length === 0) return [];

  return items.slice(0, 8).map(item => ({
    headline: item.headline || item.title,
    impact: item.impact || 'medium',
    date: item.published_date || item.date,
    // Only include summary if short
    ...(item.summary && item.summary.length < 200 ? { summary: item.summary } : {})
    // Deliberately NOT including: source, provider, url (save tokens)
  }));
}

/**
 * 2026-01-08: Optimize airport data for LLM payload
 * Only include actionable info (delays, closures, peak times)
 * @param {Object} airport - Airport conditions data
 * @returns {Object} Optimized airport data
 */
function optimizeAirportForLLM(airport) {
  if (!airport) return null;

  return {
    code: airport.code || airport.airport_code,
    delays: airport.delays || airport.delay_status,
    peak_arrivals: airport.peak_arrivals || airport.arrivals?.peak,
    peak_departures: airport.peak_departures || airport.departures?.peak,
    // Only include if there are issues
    ...(airport.advisories ? { advisories: airport.advisories } : {})
  };
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

    // Fetch strategy row and briefing
    const [[strategyRow], [briefingRow]] = await Promise.all([
      db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1),
      db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1)
    ]);

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
    const closuresData = parseJsonField(briefingRow.school_closures);
    const airportData = parseJsonField(briefingRow.airport_conditions);

    // 2026-01-08: Apply hard filter to remove TBD/Unknown events at READ time
    // This ensures clean data even from old briefings stored before the filter was added
    const eventsData = filterInvalidEvents(rawEventsData);

    // Filter out deactivated news for this user
    const newsData = await filterDeactivatedNews(rawNewsData, snapshot.user_id);

    // 2026-01-08: Lookup venue hours from venue_catalog for open/closed status
    const eventVenueNames = (eventsData || [])
      .map(e => e.venue_name || e.venue)
      .filter(Boolean);
    const venueStatusMap = await batchLookupVenueHours(eventVenueNames, snapshot.timezone);

    triadLog.phase(3, `Briefing data: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}, airport=${!!airportData}`);

    // Get location/time context from SNAPSHOT (not strategies table)
    const userAddress = snapshot.formatted_address || 'Unknown location';
    const cityDisplay = snapshot.city || 'your area';
    const stateDisplay = snapshot.state || '';
    const lat = snapshot.lat;
    const lng = snapshot.lng;

    // Format time context from snapshot - NO FALLBACK for timezone
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dow = snapshot.dow;
    const dayOfWeek = dow != null ? dayNames[dow] : 'Unknown';
    const isWeekend = dow === 0 || dow === 6;
    // Only format localTime if we have timezone
    let localTime = 'Unknown time';
    if (snapshot.local_iso && snapshot.timezone) {
      localTime = new Date(snapshot.local_iso).toLocaleString('en-US', {
        timeZone: snapshot.timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } else if (snapshot.local_iso) {
      localTime = `${snapshot.local_iso} (timezone unknown)`;
    }
    const dayPart = snapshot.day_part_key || 'unknown';
    const isHoliday = snapshot.is_holiday || false;
    const holiday = snapshot.holiday || null;

    triadLog.phase(3, `Location: ${userAddress}`);
    triadLog.phase(3, `Time: ${localTime} (${dayPart})`);

    // Step 4: Build Daily Strategy prompt with RAW briefing JSON
    // This is the DAILY STRATEGY (8-12 hours) that goes to the Briefing Tab
    // NOTE: All context comes from snapshot + briefings tables (no minstrategy)
    const prompt = `You are a STRATEGIC ADVISOR for rideshare drivers. Create a comprehensive "Daily Strategy" covering the next 8-12 hours.

=== DRIVER CONTEXT ===
Location: ${userAddress}
Coordinates: ${lat}, ${lng}
City: ${cityDisplay}, ${stateDisplay}
Current Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${dayPart}
${isHoliday ? `HOLIDAY: ${holiday}` : ''}

=== CURRENT_TRAFFIC_DATA ===
${JSON.stringify(trafficData, null, 2)}

=== CURRENT_EVENTS_DATA (optimized - today's events with venue status) ===
${JSON.stringify(optimizeEventsForLLM(eventsData, venueStatusMap).slice(0, 20), null, 1)}

=== CURRENT_NEWS_DATA (optimized) ===
${JSON.stringify(optimizeNewsForLLM(newsData), null, 1)}

=== CURRENT_WEATHER_DATA ===
${JSON.stringify(weatherData, null, 2)}

=== SCHOOL_CLOSURES_DATA (within 10mi of driver - TODAY ONLY) ===
${formatSchoolClosuresSummary(closuresData, snapshot.timezone)}

=== AIRPORT_CONDITIONS_DATA (optimized) ===
${JSON.stringify(optimizeAirportForLLM(airportData))}

=== YOUR TASK ===
Create a DAILY STRATEGY for this driver covering the next 8-12 hours. Think like a shift planner, not just immediate tactics.

CRITICAL: Reference SPECIFIC details from the data above (traffic incidents by name, event venues, closure streets, weather impacts, airport arrivals/departures).

Output 4-6 paragraphs covering:
1. Today's overview: "Today in ${cityDisplay} (${dayOfWeek})..." - What makes today unique?
2. Morning/Afternoon strategy: Where demand will be and when
3. Events impact: Specific events from CURRENT_EVENTS_DATA and their timing/surge windows
4. Traffic & hazards: Road closures, construction, areas to avoid
5. Weather considerations: How conditions affect rider behavior
6. Airport strategy: Peak arrival/departure times, which terminal to position at, expected delays
7. Peak windows: "Your best earning windows today are..." with specific times and locations

STYLE: Strategic and forward-looking. Think 8-12 hours ahead. Be specific about times, locations, and events. No bullet points.

DO NOT: Focus only on "right now", list venues without context, output JSON.`;

    aiLog.info(`Consolidator prompt size: ${prompt.length} chars`);
    
    // Step 5: Call STRATEGY_DAILY role (with BRIEFING_FALLBACK role on failure)
    let result = await callGeminiConsolidator({
      prompt,
      maxTokens: 2048,
      temperature: 0.3
    });

    // If STRATEGY_DAILY failed, try BRIEFING_FALLBACK role
    if (!result.ok) {
      aiLog.warn(1, `STRATEGY_DAILY role failed: ${result.error}`);
      aiLog.info(`Trying BRIEFING_FALLBACK role...`);

      const fallbackResult = await callAnthropic({
        model: FALLBACK_MODEL,
        system: 'You are a strategic advisor for rideshare drivers. Create comprehensive daily strategies.',
        user: prompt,
        maxTokens: FALLBACK_MAX_TOKENS,
        temperature: FALLBACK_TEMPERATURE
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
 */
export async function runImmediateStrategy(snapshotId, options = {}) {
  const startTime = Date.now();
  triadLog.phase(3, `[consolidator] Starting immediate strategy for ${snapshotId.slice(0, 8)}`);

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

    // Fetch briefing data
    const [briefingRow] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (!briefingRow) {
      throw new Error(`Briefing not found for snapshot ${snapshotId}`);
    }

    // 2026-01-08: FIX - Validate briefing data is POPULATED, not just placeholder row
    // Placeholder rows have NULL fields - generation is in progress or failed
    // Strategy REQUIRES actual briefing data (traffic, events) to be useful
    const hasTraffic = briefingRow.traffic_conditions !== null;
    const hasEvents = briefingRow.events !== null;
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

    // 2026-01-08: Apply hard filter to remove TBD/Unknown events at READ time
    const rawEvents = parseJsonField(briefingRow.events);
    const cleanEvents = filterInvalidEvents(rawEvents);

    const briefing = {
      traffic: parseJsonField(briefingRow.traffic_conditions),
      events: cleanEvents,
      weather: parseJsonField(briefingRow.weather_current),
      news: filteredNews,
      school_closures: parseJsonField(briefingRow.school_closures),
      airport: parseJsonField(briefingRow.airport_conditions)
    };

    triadLog.phase(3, `[consolidator] ${snapshot.formatted_address}`);
    triadLog.phase(3, `[consolidator] Briefing: traffic=${!!briefing.traffic}, events=${!!briefing.events}, news=${!!briefing.news}, closures=${!!briefing.school_closures}, airport=${!!briefing.airport}`);

    // Call STRATEGY_TACTICAL role with snapshot + briefing (NO minstrategy)
    const result = await callGPT5ForImmediateStrategy({ snapshot, briefing });

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

    triadLog.done(3, `[consolidator] Immediate strategy saved (${result.strategy.length} chars)`, totalDuration);

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
