
import { db } from '../../db/drizzle.js';
import { briefings, snapshots, discovered_events, us_market_cities } from '../../../shared/schema.js';
import { eq, and, desc, sql, gte, lte, ilike } from 'drizzle-orm';
import { z } from 'zod';
// Event validation disabled - Gemini handles event discovery, Claude is fallback only
// import { validateEventSchedules, filterVerifiedEvents } from './event-schedule-validator.js';
// 2026-01-10: Removed direct Anthropic import - use callModel adapter instead (D-016)
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { briefingLog, OP } from '../../logger/workflow.js';
// Centralized AI adapter - use for all model calls
import { callModel } from '../ai/adapters/index.js';
// SerpAPI + GPT-5.2 event discovery (replaces Gemini for events)
import { syncEventsForLocation } from '../../scripts/sync-events.mjs';
// Dump last briefing row to file for debugging
import { dumpLastBriefingRow } from './dump-last-briefing.js';

// 2026-01-09: Canonical ETL pipeline modules - use these for validation
// Local filterInvalidEvents is kept for backwards compatibility but delegates to canonical
import { validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION } from '../events/pipeline/validateEvent.js';
// 2026-01-10: Added for Gemini-only event discovery (normalizing + hashing)
import { normalizeEvent } from '../events/pipeline/normalizeEvent.js';
import { generateEventHash } from '../events/pipeline/hashEvent.js';

// TomTom Traffic API for real-time traffic conditions (primary provider)
import { getTomTomTraffic } from '../external/tomtom-traffic.js';

// Haversine distance calculation for school closures filtering
import { haversineDistanceMiles } from '../location/geo.js';

// Email alerts for model errors
import { sendModelErrorAlert } from '../notifications/email-alerts.js';

/**
 * Get region-specific search terms for school authorities
 * Handles US, UK, Canada, and other international variations
 */
function getSchoolSearchTerms(country) {
  const c = (country || 'US').toLowerCase();

  if (['united kingdom', 'uk', 'gb', 'england', 'scotland', 'wales'].includes(c)) {
    return { authority: 'Local Education Authority', terms: 'term dates, bank holidays, half-term', type: 'council' };
  }
  if (['canada', 'ca'].includes(c)) {
    return { authority: 'School Board', terms: 'school board calendar, PA days, professional development', type: 'board' };
  }
  if (['australia', 'au'].includes(c)) {
    return { authority: 'Department of Education', terms: 'school term dates, pupil-free days', type: 'state' };
  }
  // Default: US
  return { authority: 'School District/ISD', terms: 'school district calendar, student holidays, professional development', type: 'district' };
}

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
   * - Remove common suffixes like "at Cosm", "in Shared Reality"
   * - Lowercase and trim
   */
  function normalizeEventName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/["'"]/g, '')                          // Remove quotes
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

      // Log deduplication for debugging
      if (group.length > 1) {
        briefingLog.info(`[Dedup] Merged ${group.length} variants of "${group[0].title?.slice(0, 40)}..."`);
      }
    }
  }

  const removed = events.length - deduplicated.length;
  if (removed > 0) {
    briefingLog.done(2, `Events deduped: ${events.length} → ${deduplicated.length} (${removed} duplicates removed)`, OP.DB);
  }

  return deduplicated;
}

/**
 * 2026-01-08: HARD FILTER - Remove events with TBD/Unknown in critical fields
 * 2026-01-09: DEPRECATED - Delegates to canonical validateEventsHard module
 *
 * This function is kept for backwards compatibility. New code should use:
 * import { validateEventsHard } from '../events/pipeline/validateEvent.js';
 *
 * @deprecated Use validateEventsHard from pipeline/validateEvent.js instead
 * @param {Array} events - Array of events to filter
 * @returns {Array} Clean events with no TBD/Unknown values
 */
export function filterInvalidEvents(events) {
  if (!events || events.length === 0) return events;

  // 2026-01-09: Delegate to canonical validateEventsHard module
  // This ensures consistent validation rules across the entire pipeline
  const result = validateEventsHard(events, {
    logRemovals: true,
    phase: 'BRIEFING_SERVICE_COMPAT'  // Indicates legacy caller for debugging
  });

  return result.valid;
}

// Initialize OpenAI client for GPT-5.2 fallback
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Fetch events using Claude web search (fallback when Gemini fails)
 * Uses parallel category searches similar to Gemini approach
 */
async function fetchEventsWithClaudeWebSearch({ snapshot, city, state, date, lat, lng, timezone }) {
  const startTime = Date.now();

  // Run all 5 categories in parallel using Claude web search
  const categoryPromises = EVENT_CATEGORIES.map(async (category) => {
    const prompt = `Search the web for ${category.name.replace('_', ' ')} events happening in ${city}, ${state} TODAY (${date}).

SEARCH QUERY: "${category.searchTerms(city, state, date)}"

Return a JSON array of events with this format (max 3 events):
[{"title":"Event Name","venue":"Venue Name","address":"Full Address","event_time":"7:00 PM","subtype":"${category.eventTypes[0]}","impact":"high"}]

Return an empty array [] if no events found.`;

    const system = `You are an event search assistant. Search the web for local events and return structured JSON data. Only include events happening TODAY. Be accurate with venue names and times.`;

    try {
      // Uses BRIEFING_FALLBACK role (Claude with web_search) for parallel event discovery
      const result = await callModel('BRIEFING_FALLBACK', { system, user: prompt });

      if (!result.ok) {
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
  });

  const categoryResults = await Promise.all(categoryPromises);

  // Merge and deduplicate results
  const allEvents = [];
  const allCitations = [];
  const seenTitles = new Set();
  let totalFound = 0;

  for (const result of categoryResults) {
    totalFound += result.items.length;
    if (result.citations) {
      allCitations.push(...result.citations);
    }
    for (const event of result.items) {
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

  const elapsedMs = Date.now() - startTime;
  briefingLog.done(2, `Claude: ${allEvents.length} unique events (${totalFound} total) in ${elapsedMs}ms`, OP.FALLBACK);

  if (allEvents.length === 0) {
    return { items: [], reason: 'No events found via Claude web search', provider: 'claude' };
  }

  return { items: allEvents, citations: allCitations, reason: null, provider: 'claude' };
}

// 2026-01-10: DEAD CODE REMOVED - analyzeTrafficWithClaude and analyzeTrafficWithGPT52
// Traffic analysis now uses analyzeTrafficWithAI exclusively (see below)
// Previous multi-model fallback chain was replaced with single Briefer model approach

/**
 * Analyze TomTom traffic data with AI for strategic, driver-focused summary
 * Model-agnostic: Uses configured STRATEGY_TRAFFIC_ANALYZER model or defaults to Gemini Flash
 * Gemini Flash: $0.50/M input - cost-effective for high-volume traffic analysis
 * @param {Object} params - { tomtomData, city, state, formattedAddress, driverLat, driverLon }
 */
async function analyzeTrafficWithAI({ tomtomData, city, state, formattedAddress, driverLat, driverLon }) {
  // Default to Gemini Flash for traffic analysis (fast, cheap, good at structured output)
  // NOTE: Model ID must include "-preview" suffix (gemini-3-flash is not valid)
  const trafficModel = process.env.STRATEGY_TRAFFIC_ANALYZER || 'gemini-3-flash-preview';

  if (!process.env.GEMINI_API_KEY && trafficModel.startsWith('gemini')) {
    briefingLog.warn(1, `Traffic analyzer unavailable - no GEMINI_API_KEY`, OP.FALLBACK);
    return null;
  }

  const startTime = Date.now();
  const modelLabel = trafficModel.includes('flash') ? 'Gemini Flash' : trafficModel.split('-').slice(0, 2).join(' ');
  briefingLog.ai(1, modelLabel, `analyzing traffic for ${city}, ${state}`);

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Prepare incident data with distance information
    const stats = tomtomData.stats || {};
    const incidents = tomtomData.incidents || [];

    // Filter and prioritize: highway accidents/closures that affect strategy
    const highwayIncidents = incidents.filter(i => i.isHighway);
    const closures = incidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const accidents = incidents.filter(i => i.category === 'Accident');
    const jams = incidents.filter(i => i.category === 'Jam');

    // Build a strategic prompt focused on driver impact
    const prompt = `You are a traffic strategist for rideshare drivers. Analyze this traffic data and provide a STRATEGIC briefing.

DRIVER POSITION: ${city}, ${state} (${driverLat ? parseFloat(driverLat).toFixed(6) : 'N/A'},${driverLon ? parseFloat(driverLon).toFixed(6) : 'N/A'})
AREA: ${city}, ${state}

TRAFFIC OVERVIEW:
- Total incidents within 10 miles: ${stats.total || incidents.length}
- Highway incidents: ${highwayIncidents.length}
- Road closures: ${closures.length}
- Accidents: ${accidents.length}
- Traffic jams: ${jams.length}
- Congestion level: ${tomtomData.congestionLevel}

PRIORITY INCIDENTS (sorted by impact, with distance from driver):
${incidents.slice(0, 15).map((inc, i) => {
  const dist = inc.distanceFromDriver !== null ? `${inc.distanceFromDriver}mi` : '?';
  return `${i+1}. [${inc.category}] ${inc.road || 'Local road'}: ${inc.from || ''} → ${inc.to || ''} (${dist} away, ${inc.magnitude} severity, ${inc.delayMinutes || 0}min delay)`;
}).join('\n')}

HIGHWAY CLOSURES & ACCIDENTS (CRITICAL):
${[...closures.filter(c => c.isHighway), ...accidents.filter(a => a.isHighway)].slice(0, 8).map(c =>
  `- ${c.road}: ${c.location} [${c.distanceFromDriver !== null ? c.distanceFromDriver + 'mi' : '?'}] - ${c.category}`
).join('\n') || 'None on major highways'}

Return ONLY a JSON object with this structure:
{
  "briefing": "2-3 sentences: (1) Overall traffic status with congestion level. (2) SPECIFIC highway/road issues that affect strategy with distances. (3) Recommended action or route adjustments. Be CONCISE and STRATEGIC.",
  "keyIssues": [
    "Highway/Road + issue + distance + impact (e.g., 'I-35 accident 3.2mi north - 15min delays')",
    "Highway/Road + issue + distance + impact",
    "Highway/Road + issue + distance + impact"
  ],
  "avoidAreas": [
    "Area/corridor to avoid: reason with distance",
    "Area/corridor to avoid: reason with distance"
  ],
  "driverImpact": "One strategic sentence: How this affects rideshare operations RIGHT NOW - best areas vs areas to avoid",
  "closuresSummary": "X closures within 10mi, most critical: [list top 2]",
  "constructionSummary": "Construction zones summary if any significant"
}

Focus on ACTIONABLE intelligence: what should the driver DO based on this traffic?`;

    const result = await ai.models.generateContent({
      model: trafficModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 2048,
        temperature: 0.2,
      }
    });

    const content = (result?.text || result?.response?.text?.() || '').trim();

    // Parse JSON from response
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Try extracting from code block
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonMatch = codeBlockMatch[1].match(/\{[\s\S]*\}/);
      }
    }

    if (!jsonMatch) {
      briefingLog.warn(1, `Gemini Flash traffic analysis returned non-JSON`, OP.AI);
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `${modelLabel} traffic analysis (${elapsedMs}ms)`, OP.AI);

    return {
      briefing: analysis.briefing,
      headline: analysis.briefing?.split('.')[0] + '.' || analysis.headline,
      keyIssues: analysis.keyIssues || [],
      avoidAreas: analysis.avoidAreas || [],
      driverImpact: analysis.driverImpact,
      closuresSummary: analysis.closuresSummary,
      constructionSummary: analysis.constructionSummary,
      analyzedAt: new Date().toISOString(),
      provider: trafficModel
    };
  } catch (err) {
    briefingLog.warn(1, `${modelLabel} traffic analysis failed: ${err.message}`, OP.AI);
    return null;
  }
}

/**
 * Fetch news using Claude web search (fallback when Gemini fails)
 */
async function fetchNewsWithClaudeWebSearch({ city, state, date }) {
  // 2026-01-05: Updated to match Gemini prompt - prioritize TODAY, require dates, explain relevance
  const prompt = `Search for news published TODAY (${date}) that MATTERS to rideshare drivers in ${city}, ${state}.

WHAT MATTERS TO RIDESHARE DRIVERS:
- Traffic disruptions, road closures, construction
- Weather events affecting driving conditions
- Major events (concerts, sports, conventions) that create ride demand
- Uber/Lyft policy changes, earnings updates, promotions
- Gas prices, toll changes, airport pickup rules
- Local regulations affecting gig workers

PRIORITY: News published TODAY (${date}). If no news from today, include yesterday's news.
Also search the broader market/metro area - news from nearby cities in the same metro is relevant.

Return a JSON object:
{
  "items": [
    {
      "title": "News Title",
      "summary": "One sentence explaining HOW this affects rideshare drivers",
      "published_date": "YYYY-MM-DD",
      "impact": "high" | "medium" | "low",
      "source": "Source Name",
      "link": "url"
    }
  ],
  "reason": null
}

CRITICAL REQUIREMENTS:
1. "published_date" is REQUIRED - extract the actual date from each article
2. If you cannot determine the publication date, DO NOT include that article
3. ONLY return articles from the last 3 days (prefer today's)
4. Each summary MUST explain why a rideshare driver should care
5. If NO news with valid dates found, return: {"items": [], "reason": "No rideshare-relevant news with publication dates found for ${city}, ${state} market today"}`;

  const system = `You are a news search assistant for rideshare drivers. Search for TODAY's news and return structured JSON with publication dates. Focus on news that impacts driver earnings, regulations, and working conditions. If no date can be extracted from an article, exclude it.`;

  try {
    // Uses BRIEFING_FALLBACK role (Claude with web_search) for news fallback
    const result = await callModel('BRIEFING_FALLBACK', { system, user: prompt });

    if (!result.ok) {
      briefingLog.warn(2, `Claude news failed: ${result.error}`, OP.FALLBACK);
      return { items: [], reason: result.error, provider: 'claude' };
    }

    const parsed = safeJsonParse(result.output);

    // 2026-01-05: Handle new format {items, reason} or old format [array]
    const newsArray = Array.isArray(parsed) ? parsed : (parsed?.items || []);
    const llmReason = parsed?.reason || null;

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      return { items: [], reason: llmReason || 'No news found via Claude web search', provider: 'claude' };
    }

    // Filter out stale news (older than 7 days) as safety net
    const filteredNews = filterRecentNews(newsArray, date);

    briefingLog.done(2, `Claude: ${filteredNews.length} news items (${newsArray.length - filteredNews.length} filtered), ${result.citations?.length || 0} citations`, OP.FALLBACK);
    return { items: filteredNews, citations: result.citations, reason: llmReason, provider: 'claude' };
  } catch (err) {
    briefingLog.error(2, `Claude news failed`, err, OP.FALLBACK);
    return { items: [], reason: err.message, provider: 'claude' };
  }
}

const inFlightBriefings = new Map(); // In-memory dedup for concurrent calls within same process

/**
 * Safely parse JSON from Gemini responses
 * Handles unescaped newlines, markdown blocks, and other formatting issues
 */
function safeJsonParse(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error('JSON parse failed: input is empty or not a string');
  }

  // Helper to clean markdown and normalize the string
  function cleanMarkdown(str) {
    let cleaned = str.trim();
    // Remove markdown code blocks (```json ... ``` or ``` ... ```)
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }
    // Also handle inline code blocks that might appear mid-string
    cleaned = cleaned.replace(/```json/g, '').replace(/```/g, '').trim();
    return cleaned;
  }

  // Helper to fix common JSON issues from LLMs
  function fixCommonJsonIssues(str) {
    let fixed = str;

    // Convert single-quoted strings to double-quoted
    // This regex matches single-quoted property names and values
    fixed = fixed.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

    // Fix unquoted property names (e.g., {title: "foo"} -> {"title": "foo"})
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');

    // Fix escaped newlines within strings
    fixed = fixed.replace(/\r\n/g, '\\n').replace(/\r/g, '\\n');

    // Replace actual newlines inside strings with escaped newlines
    // This is tricky - we need to be careful not to break JSON structure
    // Only replace newlines that appear between quotes
    fixed = fixed.replace(/"([^"]*)\n([^"]*)"/g, (match, p1, p2) => `"${p1}\\n${p2}"`);

    // Fix tabs
    fixed = fixed.replace(/\t/g, '\\t');

    return fixed;
  }

  const cleaned = cleanMarkdown(jsonString);

  // Attempt 1: Direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_e1) {
    // Continue to next attempt
  }

  // Attempt 2: Parse with common fixes applied
  try {
    const fixed = fixCommonJsonIssues(cleaned);
    return JSON.parse(fixed);
  } catch (_e2) {
    // Continue to next attempt
  }

  // Attempt 3: Extract JSON array or object and try again
  const jsonMatch = jsonString.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_e3) {
      // Try with fixes
      try {
        const fixedExtracted = fixCommonJsonIssues(jsonMatch[0]);
        return JSON.parse(fixedExtracted);
      } catch (e4) {
        console.error('[BriefingService] Failed to parse extracted JSON:', e4.message);
        console.error('[BriefingService] Problematic JSON (first 500 chars):', jsonMatch[0].substring(0, 500));
      }
    }
  }

  // If all else fails, throw with the original error
  throw new Error(`JSON parse failed: Expected double-quoted property name - raw response may contain malformed JSON`);
}

const LocalEventSchema = z.object({
  title: z.string(),
  summary: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  source: z.string(),
  event_type: z.enum(['concert', 'game', 'comedy', 'live_music', 'festival', 'sports', 'performance', 'other']).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distance_miles: z.number().optional(),
  event_date: z.string().optional(),
  event_time: z.string().optional(),
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
    const timeLabel = e.event_date && e.event_time ? `${e.event_date} ${e.event_time}` : e.event_date || e.event_time || '';
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
      event_date: e.event_date,
      event_time: e.event_time,
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
 * PARALLEL EVENT CATEGORIES - Each category is searched independently for better coverage
 * This replaces the single monolithic search with 5 focused parallel searches
 */
const EVENT_CATEGORIES = [
  {
    name: 'concerts_music',
    searchTerms: (city, state, date) => `concerts live music shows ${city} ${state} ${date}`,
    eventTypes: ['concert', 'live_music', 'festival']
  },
  {
    name: 'sports',
    searchTerms: (city, state, date) => `sports games ${city} ${state} ${date} NBA NFL NHL MLB MLS college`,
    eventTypes: ['sports', 'game']
  },
  {
    name: 'comedy_theater',
    searchTerms: (city, state, date) => `comedy shows theater performances ${city} ${state} ${date}`,
    eventTypes: ['comedy', 'performance']
  },
  {
    name: 'nightlife',
    searchTerms: (city, state, date) => `nightclub events bar events ${city} ${state} tonight ${date}`,
    eventTypes: ['nightlife', 'club']
  },
  {
    name: 'community',
    searchTerms: (city, state, date) => `festivals parades community events ${city} ${state} ${date}`,
    eventTypes: ['festival', 'parade', 'community']
  }
];

/**
 * Fetch events for a single category - used in parallel
 * Uses lower thinking level for speed since these are focused searches
 */
async function fetchEventCategory({ category, city, state, lat, lng, date, timezone }) {
  const prompt = `Find ${category.name.replace('_', ' ')} events in ${city}, ${state} TODAY (${date}).

SEARCH: "${category.searchTerms(city, state, date)}"

Return JSON array (max 3 events):
[{"title":"Event","venue":"Venue","address":"Address","event_time":"7 PM","subtype":"${category.eventTypes[0]}","impact":"high"}]

Return [] if none found.`;

  try {
    const system = `You are an event discovery assistant. Search for local events and return structured JSON data.`;
    // Uses BRIEFING_EVENTS_DISCOVERY role (Gemini with google_search)
    const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user: prompt });

    if (!result.ok) {
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

  // GEMINI 3 PRO PREVIEW (PRIMARY) - uses Google Search grounding
  if (!process.env.GEMINI_API_KEY) {
    // Try Claude web search as fallback if Gemini not configured
    if (process.env.ANTHROPIC_API_KEY) {
      briefingLog.ai(2, 'Claude', `events for ${city}, ${state} (${date}) - web search fallback`);
      return fetchEventsWithClaudeWebSearch({ snapshot, city, state, date, lat, lng, timezone });
    }
    briefingLog.error(2, `Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY set`, null, OP.AI);
    return { items: [], reason: 'No API keys configured for event search' };
  }

  briefingLog.ai(2, 'Gemini', `events for ${city}, ${state} (${date}) - 5 parallel searches`);

  // PARALLEL CATEGORY SEARCHES - 5 simultaneous searches for better coverage
  // Each category runs independently, results are merged and deduplicated
  const startTime = Date.now();

  const categoryPromises = EVENT_CATEGORIES.map(category =>
    fetchEventCategory({ category, city, state, lat, lng, date, timezone })
  );

  const categoryResults = await Promise.all(categoryPromises);

  // Merge results from all categories
  const allEvents = [];
  const seenTitles = new Set();
  let totalFound = 0;

  for (const result of categoryResults) {
    totalFound += result.items.length;
    for (const event of result.items) {
      // Deduplicate by title (case-insensitive)
      const titleKey = event.title?.toLowerCase().trim();
      if (titleKey && !seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        allEvents.push(event);
      }
    }
    if (result.error) {
      briefingLog.warn(2, `Category ${result.category} failed: ${result.error}`, OP.AI);
    }
  }

  const elapsedMs = Date.now() - startTime;
  briefingLog.done(2, `Gemini: ${allEvents.length} unique events (${totalFound} total from 5 searches) in ${elapsedMs}ms`, OP.AI);

  if (allEvents.length === 0) {
    // TRY CLAUDE WEB SEARCH AS FALLBACK
    if (process.env.ANTHROPIC_API_KEY) {
      briefingLog.warn(2, `Gemini returned 0 events - trying Claude web search`, OP.FALLBACK);
      return fetchEventsWithClaudeWebSearch({ snapshot, city, state, date, lat, lng, timezone });
    }
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
  const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });

  const system = `You are an event discovery assistant. Search for local events and return structured JSON data.`;
  const user = `Find events in ${city}, ${state} ${timeContext} (${date}, ${dayOfWeek}).
Return JSON array of events with title, venue, address, event_time, event_end_time, subtype, impact.`;

  // Uses BRIEFING_EVENTS_DISCOVERY role (Gemini with google_search)
  const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

  if (!result.ok) {
    if (result.error?.includes('Empty response')) {
      return { items: [], reason: 'Gemini returned empty response' };
    }
    throw new Error(`Gemini events API failed: ${result.error}`);
  }

  try {
    const parsed = safeJsonParse(result.output);
    const events = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    return { items: events.filter(e => e.title && e.venue), reason: null };
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

  // Get date range: today to 7 days out
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const endDateStr = weekFromNow.toISOString().split('T')[0];

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
      const normalized = discoveryResult.items.map(e => normalizeEvent(e));
      const validated = validateEventsHard(normalized);

      for (const event of validated) {
        try {
          const hash = generateEventHash(event);
          await db.insert(discovered_events).values({
            title: event.title,
            venue_name: event.venue || event.location,
            address: event.address,
            city: city,
            state: state,
            event_start_date: event.event_start_date,
            event_start_time: event.event_start_time,
            event_end_time: event.event_end_time,
            lat: event.latitude || event.lat,
            lng: event.longitude || event.lng,
            category: event.event_type || event.category || 'other',
            expected_attendance: event.impact === 'high' ? 'high' : event.impact === 'low' ? 'low' : 'medium',
            source_model: 'gemini-3-pro',
            event_hash: hash
          }).onConflictDoUpdate({
            target: discovered_events.event_hash,
            set: { updated_at: sql`NOW()` }
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
  try {
    // 2026-01-10: Use symmetric field names (event_start_date)
    const events = await db.select()
      .from(discovered_events)
      .where(and(
        eq(discovered_events.city, city),
        eq(discovered_events.state, state),
        gte(discovered_events.event_start_date, todayStr),
        lte(discovered_events.event_start_date, endDateStr),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_start_date)
      .limit(50);

    if (events.length > 0) {
      // Map discovered_events format to the briefing events format
      // 2026-01-10: DB columns are now event_start_date, event_start_time
      // BriefingEvent output uses event_start_date, event_start_time for consistency
      const normalizedEvents = events.map(e => ({
        title: e.title,
        summary: [e.title, e.venue_name, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
        impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : 'medium',
        source: e.source_model,
        event_type: e.category,
        subtype: e.category, // For EventsComponent category grouping
        event_start_date: e.event_start_date,
        event_start_time: e.event_start_time,
        event_end_time: e.event_end_time,
        address: e.address,
        venue: e.venue_name,
        location: e.venue_name ? `${e.venue_name}, ${e.address || ''}`.trim() : e.address,
        latitude: e.lat,
        longitude: e.lng
      }));

      // 2026-01-05: Deduplicate events with similar names, addresses, and times
      // Fixes issue where LLMs discover same event multiple times with slight name variations
      const deduplicatedEvents = deduplicateEvents(normalizedEvents);

      // 2026-01-08: HARD FILTER - Remove events with TBD/Unknown in critical fields
      // Replaces old "smart" confirmTBDEventDetails - we no longer try to repair, just remove
      const cleanEvents = filterInvalidEvents(deduplicatedEvents);

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

export async function fetchWeatherForecast({ snapshot }) {
  if (!snapshot?.city || !snapshot?.state || !snapshot?.date) {
    return { current: null, forecast: [], error: 'Missing location/date' };
  }

  const { city, state, date } = snapshot;
  const system = `You are a weather intelligence assistant. Search for current weather conditions and return structured JSON data. Be accurate with temperature and conditions.`;
  const user = `Get the 4-6 hour weather forecast for ${city}, ${state} for ${date}. Return ONLY valid JSON:
{
  "current": {
    "tempF": number,
    "conditions": "string",
    "humidity": number,
    "windSpeed": number
  },
  "forecast": [
    {"time": "HH:MM", "tempF": number, "conditions": "string", "precipitationProbability": number}
  ]
}`;

  // Uses BRIEFING_WEATHER role (Gemini with google_search)
  const result = await callModel('BRIEFING_WEATHER', { system, user });

  if (!result.ok) {
    briefingLog.warn(1, `Weather forecast failed: ${result.error}`, OP.AI);
    return { current: null, forecast: [] };
  }

  try {
    const weatherData = safeJsonParse(result.output);
    briefingLog.done(1, `Weather forecast: ${weatherData.forecast?.length || 0} hours`, OP.AI);
    return weatherData;
  } catch (parseErr) {
    briefingLog.warn(1, `Weather parse failed: ${parseErr.message}`, OP.AI);
    return { current: null, forecast: [] };
  }
}

function usesMetric(country) {
  const imperialCountries = ['US', 'United States', 'Bahamas', 'Cayman Islands', 'Palau', 'Marshall Islands', 'Myanmar'];
  return !country || !imperialCountries.some(c => country?.toUpperCase().includes(c.toUpperCase()));
}

function formatTemperature(tempC, country) {
  const metric = usesMetric(country);
  if (metric) {
    return {
      tempC: Math.round(tempC),
      tempF: Math.round((tempC * 9/5) + 32),
      displayTemp: Math.round(tempC),
      unit: '°C'
    };
  } else {
    const tempF = Math.round((tempC * 9/5) + 32);
    return {
      tempC: Math.round(tempC),
      tempF: tempF,
      displayTemp: tempF,
      unit: '°F'
    };
  }
}

function formatWindSpeed(windSpeedMs, country) {
  if (!windSpeedMs) return undefined;
  const metric = usesMetric(country);
  if (metric) {
    return Math.round(windSpeedMs * 3.6);
  } else {
    return Math.round(windSpeedMs * 2.237);
  }
}

export async function fetchWeatherConditions({ snapshot }) {
  if (!GOOGLE_MAPS_API_KEY) {
    briefingLog.warn(1, `GOOGLE_MAPS_API_KEY not set - skipping weather`, OP.API);
    return { current: null, forecast: [], error: 'GOOGLE_MAPS_API_KEY not configured' };
  }

  if (!snapshot?.lat || !snapshot?.lng) {
    return { current: null, forecast: [], error: 'Missing coordinates' };
  }

  const { lat, lng, country } = snapshot;
  const metric = usesMetric(country);

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_MAPS_API_KEY}`),
      fetch(`https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=6&key=${GOOGLE_MAPS_API_KEY}`)
    ]);

    let current = null;
    let forecast = [];

    if (currentRes.ok) {
      const currentData = await currentRes.json();
      const tempC = currentData.temperature?.degrees ?? currentData.temperature;
      const feelsLikeC = currentData.feelsLikeTemperature?.degrees ?? currentData.feelsLikeTemperature;
      const windSpeedMs = currentData.windSpeed?.value ?? currentData.windSpeed;

      const tempData = formatTemperature(tempC, country);
      const feelsData = formatTemperature(feelsLikeC, country);
      const windSpeedDisplay = formatWindSpeed(windSpeedMs, country);

      current = {
        temperature: tempData.displayTemp,
        tempF: tempData.tempF,
        tempC: tempData.tempC,
        tempUnit: tempData.unit,
        feelsLike: feelsData.displayTemp,
        feelsLikeF: feelsData.tempF,
        feelsLikeC: feelsData.tempC,
        conditions: currentData.weatherCondition?.description?.text,
        conditionType: currentData.weatherCondition?.type,
        humidity: currentData.relativeHumidity?.value ?? currentData.relativeHumidity,
        windSpeed: windSpeedDisplay,
        windSpeedUnit: metric ? 'km/h' : 'mph',
        windDirection: currentData.wind?.direction?.cardinal,
        uvIndex: currentData.uvIndex,
        precipitation: currentData.precipitation,
        visibility: currentData.visibility,
        isDaytime: currentData.isDaytime,
        observedAt: currentData.currentTime,
        country: country
      };
    }

    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      forecast = (forecastData.forecastHours || []).map((hour, idx) => {
        const tempC = hour.temperature?.degrees ?? hour.temperature;
        const windSpeedMs = hour.windSpeed?.value ?? hour.wind?.speed;
        const tempData = formatTemperature(tempC, country);
        const windSpeedDisplay = formatWindSpeed(windSpeedMs, country);

        let timeValue = hour.time;
        if (!timeValue || isNaN(new Date(timeValue).getTime())) {
          const forecastTime = new Date();
          forecastTime.setHours(forecastTime.getHours() + idx);
          timeValue = forecastTime.toISOString();
        }

        return {
          time: timeValue,
          temperature: tempData.displayTemp,
          tempF: tempData.tempF,
          tempC: tempData.tempC,
          tempUnit: tempData.unit,
          conditions: hour.condition?.text ?? hour.weatherCondition?.description?.text,
          conditionType: hour.weatherCondition?.type,
          precipitationProbability: hour.precipitationProbability?.value ?? hour.precipitation?.probability?.percent,
          windSpeed: windSpeedDisplay,
          windSpeedUnit: metric ? 'km/h' : 'mph',
          isDaytime: hour.isDaytime
        };
      });
    }

    return { current, forecast, fetchedAt: new Date().toISOString() };
  } catch (error) {
    briefingLog.error(1, `Weather API error`, error, OP.API);
    return { current: null, forecast: [], error: error.message };
  }
}

export async function fetchSchoolClosures({ snapshot }) {
  if (!process.env.GEMINI_API_KEY || !snapshot?.city || !snapshot?.state) return [];

  const { city, state, lat, lng, country } = snapshot;
  const context = getSchoolSearchTerms(country);

  // Build a context-aware prompt using market + location context
  // Gemini discovers institutions dynamically based on the location (no hardcoded anchors)
  const prompt = `Analyze academic schedules and closures for ${city}, ${state}${country !== 'US' ? `, ${country}` : ''} for the next 30 days.

TARGET COORDINATES: ${lat}, ${lng}
SEARCH RADIUS: 15 miles

TASK 1: K-12 PUBLIC SCHOOLS (${context.authority})
Search for: ${context.terms}
Look for local school districts/boards using regional naming conventions (e.g., "ISD" in Texas, "Parish Schools" in Louisiana, "School Board" in Canada).

TASK 2: UNIVERSITIES & COLLEGES
Search for major universities within 15 miles. Look for breaks, move-in/out days, commencement, finals week.

TASK 3: PRIVATE & RELIGIOUS SCHOOLS
Check for major private academies with different schedules than public schools.

IMPORTANT: Each institution type may have DIFFERENT calendars. Public schools can be closed while private schools are open (and vice versa).

Return ONLY a valid JSON array with institutions that are CLOSED or closing soon:
[
  {
    "schoolName": "Name of district or institution",
    "type": "public" | "private" | "college",
    "closureStart": "YYYY-MM-DD",
    "reopeningDate": "YYYY-MM-DD",
    "reason": "Holiday Name / Break / Professional Development",
    "impact": "high" | "medium" | "low",
    "lat": 32.xxx,
    "lng": -96.xxx
  }
]

NOTES:
- Include approximate lat/lng coordinates for each institution (for distance calculation)
- "impact" should be "high" for large districts/universities, "medium" for mid-size, "low" for small private schools
- If no closures are found, return an empty array []`;

  const system = `You are a school calendar research assistant. Search for school closures, holidays, and academic schedules. Return structured JSON data.`;
  // Uses BRIEFING_SCHOOLS role (Gemini with google_search)
  const result = await callModel('BRIEFING_SCHOOLS', { system, user: prompt });

  if (!result.ok) {
    briefingLog.warn(2, `School closures failed: ${result.error}`, OP.AI);
    return [];
  }

  try {
    const closures = safeJsonParse(result.output);
    const closuresArray = Array.isArray(closures) ? closures : [];

    if (closuresArray.length === 0) {
      briefingLog.info(`No school closures found for ${city}, ${state}`);
      return [];
    }

    // Enrich with distance data using Gemini-provided coordinates
    const enriched = closuresArray.map((c) => {
      let distanceFromDriver = null;
      if (c.lat && c.lng && lat && lng) {
        distanceFromDriver = parseFloat(haversineDistanceMiles(lat, lng, c.lat, c.lng).toFixed(1));
      }
      return { ...c, distanceFromDriver };
    });

    // Filter to closures within 15 miles (keep ones without coordinates with warning)
    const nearbyClosures = enriched.filter((c) => {
      if (c.distanceFromDriver === null || c.distanceFromDriver === undefined) {
        // No coordinates - include but log warning
        briefingLog.warn(2, `School ${c.schoolName} has no coordinates - including anyway`, OP.AI);
        return true;
      }
      return c.distanceFromDriver <= 15;
    });

    const filteredOutCount = enriched.length - nearbyClosures.length;
    if (filteredOutCount > 0) {
      briefingLog.phase(2, `School closures: filtered ${filteredOutCount} beyond 15mi`, OP.AI);
    }

    if (nearbyClosures.length > 0) {
      briefingLog.done(2, `${nearbyClosures.length} school closures found for ${city}, ${state}`, OP.AI);
    }

    return nearbyClosures;
  } catch (parseErr) {
    briefingLog.warn(2, `School closures parse failed: ${parseErr.message}`, OP.AI);
    return [];
  }
}

export async function fetchTrafficConditions({ snapshot }) {
  // Require valid location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data in snapshot - cannot fetch traffic', OP.AI);
    return {
      summary: null,
      incidents: [],
      congestionLevel: null,
      reason: 'Location data not available'
    };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const timezone = snapshot.timezone;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // Default fallback traffic data
  const fallbackTraffic = {
    summary: `Traffic conditions for ${city}, ${state} unavailable - using default`,
    incidents: [],
    congestionLevel: 'medium',
    highDemandZones: [],
    repositioning: null,
    surgePricing: false,
    safetyAlert: null,
    fetchedAt: new Date().toISOString(),
    isFallback: true
  };

  // TRY TOMTOM FIRST (if configured + has coordinates) - real-time traffic data
  if (process.env.TOMTOM_API_KEY && lat && lng) {
    try {
      const tomtomResult = await getTomTomTraffic({
        lat,
        lon: lng,
        city,
        state,
        radiusMiles: 15,        // 15-mile bounding box for API query
        maxDistanceMiles: 10    // Filter to 10 miles from driver's actual position
      });

      if (tomtomResult.traffic && !tomtomResult.error) {
        // Map TomTom congestion levels to our format
        const congestionMap = {
          'light': 'low',
          'moderate': 'medium',
          'heavy': 'high',
          'unknown': 'medium'
        };

        const traffic = tomtomResult.traffic;
        const formattedAddress = snapshot?.formatted_address || `${city}, ${state}`;

        // Analyze traffic with AI for strategic, driver-focused briefing
        // Uses configured model (default: Gemini Flash - fast & cost-effective)
        const analysis = await analyzeTrafficWithAI({
          tomtomData: traffic,
          city,
          state,
          formattedAddress,
          driverLat: lat,
          driverLon: lng
        });

        // Format incidents for display (prioritized, within 10mi)
        const prioritizedIncidents = traffic.incidents.slice(0, 10).map(inc => ({
          description: inc.displayDescription || `${inc.category}: ${inc.location}`,
          severity: inc.magnitude === 'Major' ? 'high' : inc.magnitude === 'Moderate' ? 'medium' : 'low',
          category: inc.category,
          road: inc.road,
          location: inc.location,
          isHighway: inc.isHighway,
          priority: inc.priority,
          delayMinutes: inc.delayMinutes,
          lengthMiles: inc.lengthMiles,
          distanceFromDriver: inc.distanceFromDriver  // Distance in miles from driver's position
        }));

        // Separate closures for expandable section (also filtered by distance)
        const allClosures = (traffic.allIncidents || traffic.incidents)
          .filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed')
          .map(c => ({
            road: c.road,
            location: c.location,
            isHighway: c.isHighway,
            severity: c.magnitude === 'Major' ? 'high' : c.magnitude === 'Moderate' ? 'medium' : 'low',
            distanceFromDriver: c.distanceFromDriver
          }));

        return {
          // AI analysis (strategic, driver-focused briefing)
          briefing: analysis?.briefing || traffic.summary,  // Full 2-3 sentence briefing
          headline: analysis?.headline || traffic.summary,  // First sentence (backwards compat)
          keyIssues: analysis?.keyIssues || [],
          avoidAreas: analysis?.avoidAreas || [],
          driverImpact: analysis?.driverImpact || null,
          closuresSummary: analysis?.closuresSummary || `${traffic.closures} road closures`,
          constructionSummary: analysis?.constructionSummary || null,

          // Legacy summary for backwards compatibility
          summary: analysis?.briefing || analysis?.headline || traffic.summary,

          // Prioritized incidents (top 10 by impact) - for collapsed "Active Incidents" section
          incidents: prioritizedIncidents,
          incidentsCount: traffic.totalIncidents,

          // Expandable closures list
          closures: allClosures,
          closuresCount: allClosures.length,

          // Stats for UI display
          stats: traffic.stats || {
            total: traffic.totalIncidents,
            highways: 0,
            construction: 0,
            closures: traffic.closures,
            jams: traffic.jams,
            accidents: 0
          },

          congestionLevel: congestionMap[traffic.congestionLevel] || 'medium',
          totalIncidents: traffic.totalIncidents,
          jams: traffic.jams,
          highDemandZones: [],
          repositioning: null,
          surgePricing: traffic.congestionLevel === 'heavy',
          safetyAlert: traffic.jams > 3 ? `${traffic.jams} active traffic jams in the area` : null,
          fetchedAt: traffic.fetchedAt,
          provider: 'tomtom',
          analyzed: !!analysis
        };
      }

      briefingLog.warn(1, `TomTom traffic failed - trying Gemini`, OP.FALLBACK);
    } catch (tomtomErr) {
      briefingLog.warn(1, `TomTom traffic error: ${tomtomErr.message} - trying Gemini`, OP.FALLBACK);
    }
  }

  // GEMINI 3 PRO PREVIEW (SECONDARY) - uses Google Search grounding
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.warn(1, `No traffic providers available - using fallback traffic`, OP.AI);
    return fallbackTraffic;
  }

  briefingLog.ai(1, 'Gemini', `traffic for ${city}, ${state}`);

  const system = `You are a traffic intelligence assistant for rideshare drivers. Search for current traffic conditions and return structured JSON data.`;
  const user = `Search for current traffic conditions in ${city}, ${state} as of today ${date}. Return traffic data as JSON ONLY with ALL these fields:

{
  "summary": "One sentence about overall traffic status",
  "congestionLevel": "low" | "medium" | "high",
  "incidents": [{"description": "I-35 construction", "severity": "medium"}],
  "highDemandZones": [{"zone": "Downtown", "reason": "Event/Concert crowd"}],
  "repositioning": "Specific advice on where to reposition for surge opportunities",
  "surgePricing": true,
  "safetyAlert": "Any safety warnings for drivers"
}

CRITICAL: Include highDemandZones and repositioning.`;

  // Uses BRIEFING_TRAFFIC role (Gemini with google_search)
  const result = await callModel('BRIEFING_TRAFFIC', { system, user });

  // Graceful fallback if Gemini fails (don't crash waterfall)
  if (!result.ok) {
    briefingLog.warn(1, `Gemini traffic failed - using fallback`, OP.FALLBACK);
    return fallbackTraffic;
  }

  try {
    const parsed = safeJsonParse(result.output);
    briefingLog.done(1, `Gemini traffic: ${parsed.congestionLevel || 'unknown'} congestion`, OP.AI);

    return {
      summary: parsed.summary,
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      congestionLevel: parsed.congestionLevel || 'medium',
      highDemandZones: Array.isArray(parsed.highDemandZones) ? parsed.highDemandZones : [],
      repositioning: parsed.repositioning || null,
      surgePricing: parsed.surgePricing || false,
      safetyAlert: parsed.safetyAlert || null,
      fetchedAt: new Date().toISOString(),
      provider: 'gemini'
    };
  } catch (parseErr) {
    briefingLog.warn(1, `Gemini traffic parse failed - using fallback`, OP.FALLBACK);
    return fallbackTraffic;
  }
}

/**
 * Fetch airport conditions using Gemini with Google Search
 * Includes flight delays, arrivals, departures, and airport recommendations for drivers
 * @param {Object} params - Parameters object
 * @param {Object} params.snapshot - Snapshot with location data
 * @returns {Promise<Object>} Airport conditions data
 */
async function fetchAirportConditions({ snapshot }) {
  // Require valid location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data in snapshot - cannot fetch airport conditions', OP.AI);
    return {
      airports: [],
      busyPeriods: [],
      recommendations: null,
      reason: 'Location data not available'
    };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const timezone = snapshot.timezone;
  const lat = snapshot.lat;
  const lng = snapshot.lng;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // Fallback for API failures (not missing data)
  const fallbackAirport = {
    airports: [],
    busyPeriods: [],
    recommendations: null,
    fetchedAt: new Date().toISOString(),
    isFallback: true
  };

  // GEMINI 3 PRO PREVIEW (PRIMARY) - uses Google Search grounding
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.warn(2, `GEMINI_API_KEY not set - skipping airport search`, OP.AI);
    return fallbackAirport;
  }

  try {
    briefingLog.ai(2, 'Gemini', `airport conditions for ${city}, ${state}`);

    const system = `You are an airport conditions assistant. Search for current flight status and airport conditions. Return structured JSON data.`;
    const user = `Search for current airport conditions near ${city}, ${state} as of ${date}.

Find airports within 50 miles and report:
1. Flight delays and cancellations
2. Busy arrival/departure periods today
3. Recommendations for rideshare drivers (best pickup spots, busy times)

Return JSON (use actual airport codes and names for the location):
{
  "airports": [
    {
      "code": "<IATA_CODE>",
      "name": "<Full Airport Name>",
      "delays": "<description of current delays>",
      "status": "normal" | "delays" | "severe_delays",
      "busyTimes": ["<time range>", "<time range>"]
    }
  ],
  "busyPeriods": ["<description of busy period>"],
  "recommendations": "<driver tips for airport pickups>"
}`;

    // Uses BRIEFING_AIRPORT role (Gemini with google_search)
    const result = await callModel('BRIEFING_AIRPORT', { system, user });

    if (!result.ok) {
      briefingLog.warn(2, `Gemini airport failed: ${result.error}`, OP.FALLBACK);
      return fallbackAirport;
    }

    const parsed = safeJsonParse(result.output);
    briefingLog.done(2, `Gemini airport: ${parsed.airports?.length || 0} airports`, OP.AI);

    return {
      airports: Array.isArray(parsed.airports) ? parsed.airports : [],
      busyPeriods: Array.isArray(parsed.busyPeriods) ? parsed.busyPeriods : [],
      recommendations: parsed.recommendations || null,
      fetchedAt: new Date().toISOString(),
      provider: 'gemini'
    };
  } catch (err) {
    briefingLog.warn(2, `Gemini airport error: ${err.message}`, OP.FALLBACK);
    return fallbackAirport;
  }
}

/**
 * Filter news items to only include articles from the last 7 days
 * Safety net in case AI returns outdated articles despite prompt instructions
 * @param {Array} newsItems - Array of news items with optional published_date field
 * @param {string} todayDate - Today's date in YYYY-MM-DD format
 * @returns {Array} Filtered news items
 */
function filterRecentNews(newsItems, todayDate) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return newsItems;
  }

  const today = new Date(todayDate);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const filtered = newsItems.filter(item => {
    // If no published_date, include with warning (can't verify freshness)
    if (!item.published_date) {
      briefingLog.warn(2, `News item missing date: "${item.title?.slice(0, 40)}..."`, OP.AI);
      return true; // Include but log warning
    }

    try {
      const pubDate = new Date(item.published_date);
      if (isNaN(pubDate.getTime())) {
        briefingLog.warn(2, `Invalid date format: ${item.published_date}`, OP.AI);
        return true; // Include but log warning
      }

      const isRecent = pubDate >= sevenDaysAgo;
      if (!isRecent) {
        briefingLog.warn(2, `Filtered stale news (${item.published_date}): "${item.title?.slice(0, 40)}..."`, OP.AI);
      }
      return isRecent;
    } catch (err) {
      return true; // Include on error
    }
  });

  if (filtered.length < newsItems.length) {
    briefingLog.info(`Filtered ${newsItems.length - filtered.length} stale news items`, OP.AI);
  }

  return filtered;
}

/**
 * Fetch rideshare news using Gemini 3.0 Pro with Google Search tools
 * 2026-01-10: CONSOLIDATED to Gemini-only (removed GPT-5.2 parallel fetch)
 * Single-model approach for simpler pipeline, lower cost, cleaner data
 *
 * @param {Object} params
 * @param {Object} params.snapshot - Snapshot with city, state, timezone
 * @returns {Promise<{items: Array, reason?: string, provider: string}>}
 */
export async function fetchRideshareNews({ snapshot }) {
  // 2026-01-09: Require ALL location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data (city/state/timezone) - cannot fetch news', OP.AI);
    return { items: [], reason: 'Location data not available (missing timezone)' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const timezone = snapshot.timezone;  // NO FALLBACK - timezone is required

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // 2026-01-05: Look up market from us_market_cities table
  let market = null;
  try {
    const [marketResult] = await db
      .select({ market_name: us_market_cities.market_name })
      .from(us_market_cities)
      .where(and(
        ilike(us_market_cities.city, city),
        eq(us_market_cities.state, state)
      ))
      .limit(1);

    if (marketResult?.market_name) {
      market = marketResult.market_name;
      briefingLog.info(`Market resolved: ${city}, ${state} → ${market}`, OP.DB);
    } else {
      // Fallback: use city name as market (e.g., "Dallas" for Dallas, TX)
      market = city;
      briefingLog.info(`No market found for ${city}, ${state} - using city as market`, OP.DB);
    }
  } catch (dbErr) {
    briefingLog.warn(2, `Market lookup failed (non-fatal): ${dbErr.message}`, OP.DB);
    market = city; // Fallback to city
  }

  // Build the enhanced prompt with Market, City, Airport, Headlines
  // 2026-01-10: Updated prompt to strip source citations for cleaner UI
  const newsPrompt = buildNewsPrompt({ city, state, market, date });
  const system = `You are a rideshare news research assistant for drivers on platforms like Uber, Lyft, ridehail, taxis, and private car services. Search for recent news and return structured JSON with publication dates. Focus on news that IMPACTS driver earnings, strategy, and working conditions. DO NOT include source citations, URLs, or "[Source: ...]" text in your summaries - return CLEAN text suitable for display.`;

  // 2026-01-10: Consolidated to single Briefer model (configured via BRIEFING_NEWS_MODEL)
  // Single-model approach: simpler pipeline, lower cost, cleaner data
  briefingLog.phase(2, `News fetch: ${city}, ${state} (market: ${market})`, OP.AI);

  if (!process.env.GEMINI_API_KEY) {
    briefingLog.warn(2, `BRIEFING_NEWS model not configured (requires GEMINI_API_KEY)`, OP.AI);
    return { items: [], reason: 'Briefer model not configured' };
  }

  try {
    const result = await callModel('BRIEFING_NEWS', { system, user: newsPrompt });

    if (!result.ok) {
      briefingLog.warn(2, `News fetch failed: ${result.error}`, OP.AI);
      return { items: [], reason: `News fetch failed: ${result.error}`, provider: 'briefer' };
    }

    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : (parsed?.items || []);

    if (newsArray.length === 0) {
      briefingLog.info(`No news items found for ${market}`, OP.AI);
      return { items: [], reason: `No rideshare news found for ${market} market`, provider: 'briefer' };
    }

    // Filter recent news + sort by impact
    const filtered = filterRecentNews(newsArray, date);
    const sorted = filtered.sort((a, b) => {
      const impactOrder = { high: 0, medium: 1, low: 2 };
      return (impactOrder[a.impact] ?? 2) - (impactOrder[b.impact] ?? 2);
    });

    briefingLog.done(2, `News: ${sorted.length} items for ${market}`, OP.AI);

    return {
      items: sorted,
      reason: null,
      provider: 'briefer'
    };
  } catch (err) {
    briefingLog.error(2, `News fetch error: ${err.message}`, err, OP.AI);
    return { items: [], reason: `News fetch error: ${err.message}`, provider: 'briefer' };
  }
}

/**
 * Build the enhanced news prompt with Market, City, Airport, Headlines
 * 2026-01-05: Expanded scope for rideshare drivers
 * 2026-01-10: GEMINI-ONLY - Updated to strip source citations for cleaner UI
 */
function buildNewsPrompt({ city, state, market, date }) {
  return `Search for news relevant to RIDESHARE DRIVERS (Uber, Lyft, ridehail, taxi, private car service).

LOCATION CONTEXT:
- City: ${city}, ${state}
- Market: ${market} (search the entire ${market} metro area)
- Date: ${date}

SEARCH SCOPE - Include ALL of these:
1. AIRPORT NEWS: Delays, TSA changes, pickup/dropoff rules, terminal construction, airline schedules affecting ${market} airports
2. MAJOR HEADLINES: Big local news that creates ride demand (sports events, concerts, conventions, protests, emergencies)
3. TRAFFIC & ROAD: Road closures, construction, accidents, new toll roads, bridge closures in ${market} area
4. UBER/LYFT UPDATES: Platform policy changes, earnings bonuses, promotions, rate changes, deactivation news
5. GIG ECONOMY: Regulations, lawsuits, union activity, insurance changes affecting rideshare drivers
6. WEATHER IMPACTS: Severe weather that affects driving conditions or creates surge opportunities
7. GAS & COSTS: Fuel prices, EV charging news, vehicle costs that impact driver earnings

SEARCH THE ENTIRE ${market.toUpperCase()} MARKET - not just ${city}. News from nearby cities in the metro is highly relevant.

PUBLICATION DATE REQUIREMENT:
- Include news from the last 48 hours (prefer TODAY ${date})
- EVEN IF older, include if STILL RELEVANT to drivers (e.g., ongoing construction, multi-day events)
- Each item MUST have a published_date - if you can't determine the date, exclude it

Return JSON (NO source citations, NO URLs in summary text, CLEAN display-ready content):
{
  "items": [
    {
      "title": "News Title (clean, no source attribution)",
      "summary": "HOW this affects rideshare drivers - be specific about impact on earnings or strategy. NO [Source: ...] or URL references.",
      "published_date": "YYYY-MM-DD",
      "impact": "high" | "medium" | "low",
      "category": "airport" | "traffic" | "event" | "platform" | "regulation" | "weather" | "cost"
    }
  ],
  "reason": null
}

REQUIREMENTS:
1. published_date is REQUIRED - extract from each article
2. summary MUST explain the DRIVER IMPACT (not just what happened)
3. Return 3-8 items maximum, sorted by impact (high first)
4. NO source citations, NO URLs, NO "[Source: ...]" text - keep summaries CLEAN for mobile display
5. If no news found: {"items": [], "reason": "No rideshare-relevant news for ${market} market"}`;
}

/**
 * Consolidate news items from multiple providers
 * Deduplicates by title similarity, filters stale news, sorts by impact
 *
 * @param {Array} items - All news items from all providers
 * @param {string} todayDate - Today's date in YYYY-MM-DD format
 * @returns {Array} Consolidated, deduplicated news items
 */
function consolidateNewsItems(items, todayDate) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  // Step 1: Deduplicate by title similarity (fuzzy match)
  const seen = new Map(); // normalized title -> item
  const deduplicated = [];

  for (const item of items) {
    if (!item.title) continue;

    // Normalize title for comparison
    const normalizedTitle = item.title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim()
      .substring(0, 50);       // First 50 chars for matching

    // Check if we've seen a similar title
    let isDuplicate = false;
    for (const [seenTitle] of seen) {
      // Simple Jaccard-like similarity: shared words / total words
      const seenWords = new Set(seenTitle.split(' '));
      const itemWords = new Set(normalizedTitle.split(' '));
      const intersection = [...seenWords].filter(w => itemWords.has(w)).length;
      const union = new Set([...seenWords, ...itemWords]).size;
      const similarity = intersection / union;

      if (similarity > 0.6) { // 60% word overlap = duplicate
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(normalizedTitle, item);
      deduplicated.push(item);
    }
  }

  // Step 2: Filter out very stale news (older than 7 days) unless still relevant
  const filtered = filterRecentNews(deduplicated, todayDate);

  // Step 3: Sort by impact (high > medium > low), then by date
  const impactOrder = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => {
    const impactA = impactOrder[a.impact] ?? 2;
    const impactB = impactOrder[b.impact] ?? 2;
    if (impactA !== impactB) return impactA - impactB;

    // Secondary sort by date (newest first)
    const dateA = a.published_date || '0000-00-00';
    const dateB = b.published_date || '0000-00-00';
    return dateB.localeCompare(dateA);
  });

  // Step 4: Limit to 8 items max
  return filtered.slice(0, 8);
}

export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  // Dedup 1: Check if already in flight in this process (concurrent calls)
  if (inFlightBriefings.has(snapshotId)) {
    briefingLog.info(`Already in flight for ${snapshotId.slice(0, 8)} - waiting`, OP.CACHE);
    return inFlightBriefings.get(snapshotId);
  }

  // Dedup 2: Check database state - if briefing exists with ALL populated fields, skip regeneration
  // NULL fields = generation in progress or needs refresh
  // Populated fields = data ready, don't regenerate
  const existing = await getBriefingBySnapshotId(snapshotId);
  if (existing) {
    const hasTraffic = existing.traffic_conditions !== null;
    const hasEvents = existing.events !== null && (Array.isArray(existing.events) ? existing.events.length > 0 : existing.events?.items?.length > 0 || existing.events?.reason);
    const hasNews = existing.news !== null;
    const hasClosures = existing.school_closures !== null;

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

  const briefingPromise = generateBriefingInternal({ snapshotId, snapshot });
  inFlightBriefings.set(snapshotId, briefingPromise);

  briefingPromise.finally(() => {
    inFlightBriefings.delete(snapshotId);
  });

  return briefingPromise;
}

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
    console.error(`[BriefingService] ⚠️ Snapshot ${snapshotId} missing required location data (city/state/timezone)`);
    return { success: false, error: 'Snapshot missing required location data' };
  }

  briefingLog.start(`${snapshot.city}, ${snapshot.state} (${snapshotId.slice(0, 8)})`);

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

  let weatherResult, trafficResult, eventsResult, airportResult, newsResult;
  try {
    [weatherResult, trafficResult, eventsResult, airportResult, newsResult] = await Promise.all([
      fetchWeatherConditions({ snapshot }),
      fetchTrafficConditions({ snapshot }),
      snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.reject(new Error('Snapshot required for events')),
      fetchAirportConditions({ snapshot }),
      fetchRideshareNews({ snapshot })
    ]);
  } catch (freshErr) {
    console.error(`[BriefingService] ❌ FAIL-FAST: Fresh data fetch failed:`, freshErr.message);
    throw freshErr;
  }

  // Step 3: Get cached school closures or fetch fresh if cache miss
  let schoolClosures;

  if (cachedDailyData) {
    // CACHE HIT: Use cached closures
    schoolClosures = cachedDailyData.school_closures?.items || cachedDailyData.school_closures || [];
  } else {
    // CACHE MISS: Fetch closures from Gemini
    briefingLog.phase(2, `Fetching school closures`, OP.AI);
    try {
      schoolClosures = await fetchSchoolClosures({ snapshot });
    } catch (dailyErr) {
      console.error(`[BriefingService] ❌ FAIL-FAST: Closures fetch failed:`, dailyErr.message);
      throw dailyErr;
    }
  }

  let eventsItems = eventsResult?.items || [];
  const newsItems = newsResult?.items || [];

  const airportCount = airportResult?.airports?.length || 0;
  const forecastHours = weatherResult?.forecast?.length || 0;
  briefingLog.done(2, `weather=${forecastHours}hr, events=${eventsItems.length}, news=${newsItems.length}, traffic=${trafficResult?.congestionLevel || 'ok'}, airports=${airportCount}`, OP.AI);

  const weatherCurrent = weatherResult?.current || null;

  const briefingData = {
    snapshot_id: snapshotId,
    // Location (city, state, formatted_address) available via snapshot_id JOIN
    news: {
      items: newsItems,
      reason: newsResult?.reason || null
    },
    weather_current: weatherCurrent,
    weather_forecast: weatherResult?.forecast || [],
    traffic_conditions: trafficResult,
    events: eventsItems.length > 0 ? eventsItems : { items: [], reason: eventsResult?.reason || 'No events found' },
    school_closures: schoolClosures.length > 0 ? schoolClosures : { items: [], reason: 'No school closures found' },
    airport_conditions: airportResult || { airports: [], busyPeriods: [], recommendations: null, isFallback: true },
    created_at: new Date(),
    updated_at: new Date()
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
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
    } else {
      await db.insert(briefings).values(briefingData);
    }
    briefingLog.complete(`${city}, ${state}`, OP.DB);

    // Notify clients that briefing data is ready (SSE event)
    try {
      const payload = JSON.stringify({ snapshot_id: snapshotId });
      await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
      briefingLog.info(`📢 NOTIFY briefing_ready sent for ${snapshotId.slice(0, 8)}`, OP.SSE);
    } catch (notifyErr) {
      briefingLog.warn(1, `Failed to send NOTIFY: ${notifyErr.message}`, OP.SSE);
    }

    // Dump last briefing row to file for debugging
    dumpLastBriefingRow().catch(err => 
      briefingLog.warn(1, `Failed to dump briefing: ${err.message}`, OP.DB)
    );

    return {
      success: true,
      briefing: briefingData
    };
  } catch (error) {
    console.error('[BriefingService] Database error:', error);
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
    console.error('[BriefingService] Error fetching briefing:', error);
    return null;
  }
}

/**
 * Check if daily briefing is stale (different calendar day in user's timezone)
 * Daily briefing = news, closures, construction (refreshes at midnight)
 * @param {object} briefing - Briefing row from database
 * @param {string} timezone - User's IANA timezone (REQUIRED - no fallback)
 * @returns {boolean} True if briefing is from a different calendar day
 */
function isDailyBriefingStale(briefing, timezone) {
  // NO FALLBACK - timezone is required for accurate date comparison
  if (!timezone) {
    briefingLog.warn(1, 'isDailyBriefingStale called without timezone - treating as stale', OP.CACHE);
    return true;
  }
  if (!briefing?.updated_at) return true;

  const updatedAt = new Date(briefing.updated_at);
  const now = new Date();

  // Get calendar date strings in user's timezone
  const briefingDate = updatedAt.toLocaleDateString('en-US', { timeZone: timezone });
  const todayDate = now.toLocaleDateString('en-US', { timeZone: timezone });

  // Stale if it's a different calendar day
  return briefingDate !== todayDate;
}

/**
 * Check if events data is stale (older than 4 hours)
 * Events need more frequent refresh than other daily data because:
 * - Event schedules change (cancellations, time changes)
 * - New events get announced
 * - "Tonight" events need accurate verification
 * @param {object} briefing - Briefing row from database
 * @returns {boolean} True if events are older than 4 hours
 */
function isEventsStale(briefing) {
  if (!briefing?.updated_at) return true;

  const updatedAt = new Date(briefing.updated_at);
  const now = new Date();
  const ageMs = now - updatedAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  // Events stale after 4 hours (vs 24h for news/closures)
  const EVENTS_CACHE_HOURS = 4;
  return ageHours > EVENTS_CACHE_HOURS;
}

/**
 * Traffic always needs refresh (no caching)
 * Traffic conditions change rapidly and any incidents need immediate visibility
 * @returns {boolean} Always true - traffic must be fresh on every call
 */
function isTrafficStale() {
  return true; // Traffic always needs refresh - no caching
}

/**
 * Check if events are empty/missing - triggers immediate fetch
 * Events are critical for rideshare demand, so empty = fetch now
 * @param {object} briefing - Briefing row from database
 * @returns {boolean} True if events array is empty or missing
 */
function areEventsEmpty(briefing) {
  if (!briefing?.events) return true;

  // Handle array format
  if (Array.isArray(briefing.events)) {
    return briefing.events.length === 0;
  }

  // Handle {items: [], reason: string} format
  if (briefing.events?.items && Array.isArray(briefing.events.items)) {
    return briefing.events.items.length === 0;
  }

  return true;
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
  // - Events are stored in discovered_events table by sync-events.mjs
  // - Multiple re-fetch attempts mask upstream bugs instead of surfacing them

  return briefing;
}
