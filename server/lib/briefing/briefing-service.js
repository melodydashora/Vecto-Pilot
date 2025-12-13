
import { db } from '../../db/drizzle.js';
import { briefings, snapshots } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
// Event validation disabled - Gemini handles event discovery, Claude is fallback only
// import { validateEventSchedules, filterVerifiedEvents } from './event-schedule-validator.js';
import Anthropic from "@anthropic-ai/sdk";
import { briefingLog, OP } from '../../logger/workflow.js';
// NOTE: Perplexity replaced by Gemini 3 Pro Preview with Google Search grounding
// Perplexity imports removed - using Gemini as primary, Claude as fallback

// TomTom Traffic API for real-time traffic conditions (primary provider)
import { getTomTomTraffic } from '../external/tomtom-traffic.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Claude Opus fallback configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 8192;
const FALLBACK_TEMPERATURE = 0.2;

// Initialize Anthropic client for Claude web search
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Call Claude Opus with web_search tool for grounded responses
 * Used as secondary fallback for news, events, and other web searches
 * @param {Object} params - { system, prompt, maxTokens, temperature }
 * @returns {Promise<{ok: boolean, output: string, citations?: array, error?: string}>}
 */
async function callClaudeWithWebSearch({ system, prompt, maxTokens = 4096, temperature = 0.2 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    briefingLog.warn(2, `ANTHROPIC_API_KEY not configured`, OP.AI);
    return { ok: false, output: '', citations: [], error: 'ANTHROPIC_API_KEY not configured' };
  }

  try {
    briefingLog.ai(2, 'Claude Opus', `web search with ${maxTokens} tokens`);

    // Use assistant prefill to force JSON array output
    const messages = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '[' }
    ];

    const res = await anthropicClient.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5
        }
      ]
    });

    // Extract text from response (may have tool_use blocks interspersed)
    let output = '';
    const citations = [];

    for (const block of res?.content || []) {
      if (block.type === 'text') {
        output += block.text;
        if (block.citations) {
          citations.push(...block.citations);
        }
      }
    }

    // Prepend the opening bracket from prefill
    output = '[' + output.trim();

    briefingLog.done(2, `Claude Opus: ${output.length} chars, ${citations.length} citations`, OP.AI);

    return output
      ? { ok: true, output, citations }
      : { ok: false, output: '', citations: [], error: 'Empty response from Claude' };
  } catch (err) {
    briefingLog.error(2, `Claude web search failed: ${err.message}`, err, OP.AI);
    return { ok: false, output: '', citations: [], error: err.message };
  }
}

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
      const result = await callClaudeWithWebSearch({ system, prompt, maxTokens: 2048 });

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

/**
 * Analyze TomTom traffic data with Claude to produce human-readable briefing
 * Takes raw prioritized incidents and creates a dispatcher-style summary
 */
async function analyzeTrafficWithClaude({ tomtomData, city, state, formattedAddress }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null; // Fall back to raw data
  }

  const startTime = Date.now();
  briefingLog.ai(1, 'Claude', `analyzing traffic for ${city}, ${state}`);

  try {
    const anthropic = new Anthropic();

    // Prepare incident summary for Claude
    const stats = tomtomData.stats || {};
    const incidents = tomtomData.incidents || [];

    // Group incidents by category for analysis
    const closures = incidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const construction = incidents.filter(i => i.category === 'Road Works');
    const jams = incidents.filter(i => i.category === 'Jam');
    const accidents = incidents.filter(i => i.category === 'Accident');

    const prompt = `Analyze this traffic data for a rideshare driver located at: ${formattedAddress}

TRAFFIC STATS:
- Total incidents: ${stats.total || 0}
- Highway incidents: ${stats.highways || 0}
- Road closures: ${stats.closures || 0}
- Construction zones: ${stats.construction || 0}
- Traffic jams: ${stats.jams || 0}
- Accidents: ${stats.accidents || 0}
- Congestion level: ${tomtomData.congestionLevel}

TOP PRIORITY INCIDENTS (sorted by impact to driver):
${incidents.slice(0, 15).map((inc, i) =>
  `${i+1}. [${inc.category}] ${inc.road || ''} ${inc.location} (${inc.magnitude}, priority: ${inc.priority})`
).join('\n')}

ROAD CLOSURES:
${closures.slice(0, 10).map(c => `- ${c.road || ''} ${c.location}`).join('\n') || 'None reported'}

CONSTRUCTION:
${construction.slice(0, 5).map(c => `- ${c.road || ''} ${c.location}`).join('\n') || 'None reported'}

Return a JSON object with this EXACT structure:
{
  "headline": "One sentence traffic overview (e.g., 'Heavy congestion on I-35E with multiple jams; avoid downtown exits')",
  "keyIssues": ["Issue 1 - specific road and problem", "Issue 2", "Issue 3"],
  "avoidAreas": ["Road/area to avoid and why"],
  "driverImpact": "One sentence on how this affects the driver's routes/earnings",
  "closuresSummary": "X road closures, mostly on local streets" or "Major closure on I-35",
  "constructionSummary": "X construction zones" or null if none significant
}

Be specific with road names. Focus on what matters to a driver navigating this area RIGHT NOW.`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      briefingLog.warn(1, `Claude traffic analysis returned non-JSON`, OP.AI);
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Claude traffic analysis (${elapsedMs}ms)`, OP.AI);

    return {
      headline: analysis.headline,
      keyIssues: analysis.keyIssues || [],
      avoidAreas: analysis.avoidAreas || [],
      driverImpact: analysis.driverImpact,
      closuresSummary: analysis.closuresSummary,
      constructionSummary: analysis.constructionSummary,
      analyzedAt: new Date().toISOString()
    };
  } catch (err) {
    briefingLog.warn(1, `Claude traffic analysis failed: ${err.message}`, OP.FALLBACK);
    return null;
  }
}

/**
 * Fetch news using Claude web search (fallback when Gemini fails)
 */
async function fetchNewsWithClaudeWebSearch({ city, state, date }) {
  const prompt = `Search the web for rideshare-relevant news in ${city}, ${state} as of ${date}.

SEARCH FOR:
1. "${city} ${state} rideshare driver news today"
2. "Uber Lyft driver earnings ${city}"
3. "${state} gig economy news rideshare"
4. "rideshare regulation update ${state}"

Return a JSON array of 2-5 news items:
[
  {
    "title": "News Title",
    "summary": "One sentence summary with driver impact",
    "impact": "high" | "medium" | "low",
    "source": "Source Name",
    "link": "url"
  }
]

If no rideshare-specific news found, return general local news affecting drivers.`;

  const system = `You are a news search assistant for rideshare drivers. Search the web for relevant news and return structured JSON data. Focus on news that impacts driver earnings, regulations, and working conditions.`;

  try {
    const result = await callClaudeWithWebSearch({ system, prompt, maxTokens: 2048 });

    if (!result.ok) {
      briefingLog.warn(2, `Claude news failed: ${result.error}`, OP.FALLBACK);
      return { items: [], reason: result.error, provider: 'claude' };
    }

    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : [];

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      return { items: [], reason: 'No news found via Claude web search', provider: 'claude' };
    }

    briefingLog.done(2, `Claude: ${newsArray.length} news items, ${result.citations?.length || 0} citations`, OP.FALLBACK);
    return { items: newsArray, citations: result.citations, reason: null, provider: 'claude' };
  } catch (err) {
    briefingLog.error(2, `Claude news failed`, err, OP.FALLBACK);
    return { items: [], reason: err.message, provider: 'claude' };
  }
}

/**
 * Claude Opus fallback when Gemini fails
 * Uses web search tool for grounded responses
 */
async function callClaudeOpusFallback({ prompt, maxTokens = FALLBACK_MAX_TOKENS }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured for fallback' };
  }

  try {
    briefingLog.phase(2, `Claude fallback for events`, OP.FALLBACK);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await client.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: maxTokens,
      temperature: FALLBACK_TEMPERATURE,
      system: "You are a helpful assistant that provides accurate, real-time information. Return responses as valid JSON only, no markdown formatting.",
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5
        }
      ]
    });

    // Extract text from response
    let output = "";
    for (const block of res?.content || []) {
      if (block.type === "text") {
        output += block.text;
      }
    }
    output = output.trim();

    if (!output) {
      return { ok: false, error: 'Empty response from Claude fallback' };
    }

    // Clean markdown if present
    const cleanOutput = output.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    briefingLog.done(2, `Claude fallback: ${cleanOutput.length} chars`, OP.FALLBACK);
    return { ok: true, output: cleanOutput, usedFallback: true };

  } catch (err) {
    briefingLog.error(2, `Claude fallback failed`, err, OP.FALLBACK);
    return { ok: false, error: `Claude fallback failed: ${err.message}` };
  }
}

/**
 * Unified helper for Gemini 3.0 Pro calls with Retry Logic
 * Handles authentication, safety settings, JSON parsing, and 503/429 backoff
 */
async function callGeminiWithSearch({ prompt, maxTokens = 4096, temperature = 0.1, responseMimeType = "application/json" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    briefingLog.error(2, `GEMINI_API_KEY not configured`, null, OP.AI);
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  // RETRY CONFIGURATION: 3 attempts with 2s, 4s, 8s delays
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      if (attempt > 1) {
        briefingLog.phase(2, `Gemini retry ${attempt-1}/${MAX_RETRIES}`, OP.RETRY);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
                thinkingLevel: "HIGH"
              },
              temperature,
              maxOutputTokens: maxTokens,
              responseMimeType
            }
          })
        }
      );

      // Handle Overloaded (503) or Rate Limited (429)
      if (response.status === 503 || response.status === 429) {
        if (attempt <= MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          briefingLog.warn(2, `Gemini ${response.status} - retry in ${delay}ms`, OP.RETRY);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return { ok: false, error: `Gemini Overloaded after ${MAX_RETRIES} retries` };
      }

      if (!response.ok) {
        const err = await response.text();
        return { ok: false, error: `Gemini API ${response.status}: ${err}` };
      }

      const data = await response.json();

      const candidate = data.candidates?.[0];
      if (!candidate) {
        briefingLog.error(2, `No candidates in Gemini response`, null, OP.AI);
        return { ok: false, error: `No candidates in response: ${data.error?.message || 'unknown'}` };
      }

      if (candidate.finishReason === 'SAFETY') {
        briefingLog.warn(2, `Gemini response blocked by safety filter`, OP.AI);
        return { ok: false, error: `Response blocked by safety filter` };
      }

      // With thinkingConfig enabled, text may be in different parts
      // Look for the actual text content (not thinking content)
      const parts = candidate.content?.parts || [];
      let text = null;

      for (const part of parts) {
        // Skip thinking parts (they have a 'thought' field)
        if (part.thought) continue;
        // Get the text content
        if (part.text) {
          text = part.text;
          break;
        }
      }

      if (!text) {
        briefingLog.error(2, `Empty Gemini response (finishReason: ${candidate.finishReason}, parts: ${parts.length})`, null, OP.AI);
        return { ok: false, error: `Empty response from Gemini (finishReason: ${candidate.finishReason || 'unknown'}, parts: ${parts.length})` };
      }

      const cleanText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      return { ok: true, output: cleanText };

    } catch (error) {
      if (attempt <= MAX_RETRIES) {
        briefingLog.warn(2, `Gemini network error - retry ${attempt}/${MAX_RETRIES}`, OP.RETRY);
        await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS));
        continue;
      }
      briefingLog.error(2, `Gemini network error`, error, OP.AI);
      return { ok: false, error: error.message };
    }
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
    // Use callGeminiForEvents with LOW thinking for speed (parallel searches)
    const result = await callGeminiForEvents({ prompt, maxTokens: 4096 });

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

/**
 * Specialized Gemini call for event searches - uses LOW thinking for speed
 */
async function callGeminiForEvents({ prompt, maxTokens = 4096 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              thinkingLevel: "LOW"  // LOW for speed in parallel searches
            },
            temperature: 0.1,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return { ok: false, error: `Gemini API ${response.status}: ${err.substring(0, 100)}` };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (!candidate) {
      return { ok: false, error: 'No candidates in response' };
    }

    if (candidate.finishReason === 'MAX_TOKENS') {
      // Still try to extract what we got
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.text && !part.thought) {
          return { ok: true, output: part.text, truncated: true };
        }
      }
      return { ok: false, error: `Empty response from Gemini (finishReason: MAX_TOKENS, parts: ${parts.length})` };
    }

    // Extract text content (skip thinking parts)
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.text && !part.thought) {
        return { ok: true, output: part.text };
      }
    }

    return { ok: false, error: `Empty response from Gemini (finishReason: ${candidate.finishReason}, parts: ${parts.length})` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchEventsWithGemini3ProPreview({ snapshot }) {
  const city = snapshot?.city || 'Frisco';
  const state = snapshot?.state || 'TX';
  const lat = snapshot?.lat || 33.1285;
  const lng = snapshot?.lng || -96.8756;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot?.timezone || 'America/Chicago';

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

  const city = snapshot?.city || 'Frisco';
  const state = snapshot?.state || 'TX';
  const lat = snapshot?.lat || 33.1285;
  const lng = snapshot?.lng || -96.8756;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot?.timezone || 'America/Chicago';

  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  const timeContext = hour >= 17 ? 'tonight' : 'today';
  const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });

  const prompt = `Find events in ${city}, ${state} ${timeContext} (${date}, ${dayOfWeek}).
Return JSON array of events with title, venue, address, event_time, event_end_time, subtype, impact.`;

  const result = await callGeminiWithSearch({ prompt, maxTokens: 4096 });

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

  // Delegate to Gemini 3 Pro (the actual implementation)
  const result = await fetchEventsWithGemini3ProPreview({ snapshot });

  if (result.items && result.items.length > 0) {
    const normalizedEvents = mapGeminiEventsToLocalEvents(result.items, { lat: snapshot.lat, lng: snapshot.lng });
    return { items: normalizedEvents, reason: null };
  }

  return { items: [], reason: result.reason || 'No events found' };
}

export async function confirmTBDEventDetails(events) {
  if (!process.env.GEMINI_API_KEY) return events;

  const tbdEvents = events.filter(e => e.location?.includes('TBD') || e.event_time?.includes('TBD') || e.location === 'TBD');
  if (tbdEvents.length === 0) return events;

  briefingLog.phase(2, `Confirming ${tbdEvents.length} TBD events`, OP.AI);

  const eventDetails = tbdEvents.map(e => `- Title: "${e.title}"\n  Location: "${e.location || 'TBD'}"\n  Time: "${e.event_time || 'TBD'}"`).join('\n\n');
  const prompt = `Review these events with incomplete data and provide confirmed details. For each event, return JSON:
{
  "title": "exact event name",
  "confirmed_venue": "full venue name and address or 'Unable to confirm'",
  "confirmed_time": "start time like '7:00 PM' or 'Unable to confirm'",
  "confidence": "high/medium/low"
}

Events:
${eventDetails}

Return JSON array with one object per event.`;

  const result = await callGeminiWithSearch({ prompt, temperature: 0.2, maxTokens: 2048 });

  if (!result.ok) {
    briefingLog.warn(2, `TBD confirmation failed: ${result.error}`, OP.AI);
    return events;
  }

  try {
    const confirmed = safeJsonParse(result.output);
    return events.map(event => {
      const match = confirmed.find(c => c.title === event.title);
      if (match && match.confidence !== 'low') {
        return {
          ...event,
          location: match.confirmed_venue !== 'Unable to confirm' ? match.confirmed_venue : event.location,
          event_time: match.confirmed_time !== 'Unable to confirm' ? match.confirmed_time : event.event_time,
          gemini_confirmed: true
        };
      }
      return event;
    });
  } catch (e) {
    briefingLog.warn(2, `TBD parse failed: ${e.message}`, OP.AI);
    return events;
  }
}

export async function fetchWeatherForecast({ snapshot }) {
  if (!snapshot?.city || !snapshot?.state || !snapshot?.date) {
    return { current: null, forecast: [], error: 'Missing location/date' };
  }

  const { city, state, date } = snapshot;
  const prompt = `Get the 4-6 hour weather forecast for ${city}, ${state} for ${date}. Return ONLY valid JSON:
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

  const result = await callGeminiWithSearch({ prompt, maxTokens: 1000 });

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

  const { city, state, lat, lng } = snapshot;
  const prompt = `Find upcoming school closures/breaks for ${city}, ${state} within 15 miles of coordinates (${lat}, ${lng}) for the next 30 days.

Include:
1. School district closures (winter break, spring break, professional development days)
2. Local college/university closures
3. Closure dates and reopening dates

Return ONLY valid JSON array:
[
  {
    "schoolName": "District Name or University Name",
    "closureStart": "YYYY-MM-DD",
    "reopeningDate": "YYYY-MM-DD",
    "type": "district" | "college",
    "reason": "Winter Break",
    "impact": "high" | "medium" | "low"
  }
]`;

  const result = await callGeminiWithSearch({ prompt, maxTokens: 8192 });

  if (!result.ok) {
    briefingLog.warn(2, `School closures failed: ${result.error}`, OP.AI);
    return [];
  }

  try {
    const closures = safeJsonParse(result.output);
    const closuresArray = Array.isArray(closures) ? closures : [];
    if (closuresArray.length > 0) {
      briefingLog.done(2, `${closuresArray.length} school closures found`, OP.AI);
    }
    return closuresArray;
  } catch (parseErr) {
    briefingLog.warn(2, `School closures parse failed: ${parseErr.message}`, OP.AI);
    return [];
  }
}

export async function fetchTrafficConditions({ snapshot }) {
  const city = snapshot?.city || 'Unknown';
  const state = snapshot?.state || 'Unknown';
  const lat = snapshot?.lat;
  const lng = snapshot?.lng;
  const timezone = snapshot?.timezone || 'America/Chicago';

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
        radiusMiles: 15  // 15-mile radius for city-wide coverage
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

        // Analyze traffic with Claude for human-readable briefing
        const analysis = await analyzeTrafficWithClaude({
          tomtomData: traffic,
          city,
          state,
          formattedAddress
        });

        // Format incidents for display (prioritized)
        const prioritizedIncidents = traffic.incidents.slice(0, 10).map(inc => ({
          description: inc.displayDescription || `${inc.category}: ${inc.location}`,
          severity: inc.magnitude === 'Major' ? 'high' : inc.magnitude === 'Moderate' ? 'medium' : 'low',
          category: inc.category,
          road: inc.road,
          location: inc.location,
          isHighway: inc.isHighway,
          priority: inc.priority,
          delayMinutes: inc.delayMinutes,
          lengthMiles: inc.lengthMiles
        }));

        // Separate closures for expandable section
        const allClosures = (traffic.allIncidents || traffic.incidents)
          .filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed')
          .map(c => ({
            road: c.road,
            location: c.location,
            isHighway: c.isHighway,
            severity: c.magnitude === 'Major' ? 'high' : c.magnitude === 'Moderate' ? 'medium' : 'low'
          }));

        return {
          // Claude analysis (human-readable)
          headline: analysis?.headline || traffic.summary,
          keyIssues: analysis?.keyIssues || [],
          avoidAreas: analysis?.avoidAreas || [],
          driverImpact: analysis?.driverImpact || null,
          closuresSummary: analysis?.closuresSummary || `${traffic.closures} road closures`,
          constructionSummary: analysis?.constructionSummary || null,

          // Legacy summary for backwards compatibility
          summary: analysis?.headline || traffic.summary,

          // Prioritized incidents (top 10 by impact)
          incidents: prioritizedIncidents,

          // Expandable closures list
          closures: allClosures,
          closuresCount: allClosures.length,

          // Stats
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

  const prompt = `Search for current traffic conditions in ${city}, ${state} as of today ${date}. Return traffic data as JSON ONLY with ALL these fields:

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

  const result = await callGeminiWithSearch({ prompt, maxTokens: 8192 });

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
  const city = snapshot?.city || 'Unknown';
  const state = snapshot?.state || 'Unknown';
  const timezone = snapshot?.timezone || 'America/Chicago';
  const lat = snapshot?.lat;
  const lng = snapshot?.lng;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // Default fallback airport data
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

    const prompt = `Search for current airport conditions near ${city}, ${state} as of ${date}.

Find airports within 50 miles and report:
1. Flight delays and cancellations
2. Busy arrival/departure periods today
3. Recommendations for rideshare drivers (best pickup spots, busy times)

Return JSON:
{
  "airports": [
    {
      "code": "DFW",
      "name": "Dallas/Fort Worth International",
      "delays": "Minor delays (15-30 min) on arrivals",
      "status": "normal" | "delays" | "severe_delays",
      "busyTimes": ["6-8 AM", "5-7 PM"]
    }
  ],
  "busyPeriods": ["Morning rush 6-9 AM", "Evening rush 4-8 PM"],
  "recommendations": "Position near Terminal D for international arrivals after 2 PM"
}`;

    const result = await callGeminiWithSearch({ prompt, maxTokens: 4096 });

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

async function fetchRideshareNews({ snapshot }) {
  const city = snapshot?.city || 'Frisco';
  const state = snapshot?.state || 'TX';
  const timezone = snapshot?.timezone || 'America/Chicago';

  // Get current date in user's timezone
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
      briefingLog.ai(2, 'Claude', `news for ${city}, ${state} - web search fallback`);
      return fetchNewsWithClaudeWebSearch({ city, state, date });
    }
    briefingLog.warn(2, `Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY set`, OP.AI);
    return { items: [], reason: 'No API keys configured for news search' };
  }

  briefingLog.ai(2, 'Gemini', `news for ${city}, ${state}`);

  const prompt = `You MUST search for and find rideshare-relevant news. Search the web NOW.

Location: ${city}, ${state}
Date: ${date}

MANDATORY SEARCH QUERIES:
1. Search: "${city} ${state} rideshare driver news today"
2. Search: "Uber Lyft driver earnings ${city}"
3. Search: "${state} gig economy news rideshare"
4. Search: "rideshare regulation update ${state}"

Return JSON array:
[
  {
    "title": "Event/News Title",
    "summary": "One sentence summary with driver impact",
    "impact": "high" | "medium" | "low",
    "source": "Source Name",
    "link": "url"
  }
]

Return 2-5 items if found. If no rideshare-specific news found, return general local news affecting drivers.`;

  const result = await callGeminiWithSearch({ prompt, maxTokens: 2048 });

  // Graceful degradation - try Claude fallback
  if (!result.ok) {
    if (process.env.ANTHROPIC_API_KEY) {
      briefingLog.warn(2, `Gemini news failed - trying Claude web search`, OP.FALLBACK);
      return fetchNewsWithClaudeWebSearch({ city, state, date });
    }
    briefingLog.warn(2, `Gemini news failed: ${result.error}`, OP.FALLBACK);
    return { items: [], reason: `News fetch failed: ${result.error}`, provider: 'gemini' };
  }

  try {
    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : [];

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      // TRY CLAUDE WEB SEARCH AS FALLBACK
      if (process.env.ANTHROPIC_API_KEY) {
        briefingLog.warn(2, `Gemini returned 0 news - trying Claude web search`, OP.FALLBACK);
        return fetchNewsWithClaudeWebSearch({ city, state, date });
      }
      briefingLog.info(`No news found for ${city}, ${state}`);
      return { items: [], reason: 'No rideshare news found for this location', provider: 'gemini' };
    }

    briefingLog.done(2, `Gemini: ${newsArray.length} news items`, OP.AI);
    return { items: newsArray, reason: null, provider: 'gemini' };
  } catch (parseErr) {
    // TRY CLAUDE WEB SEARCH AS FALLBACK
    if (process.env.ANTHROPIC_API_KEY) {
      briefingLog.warn(2, `Gemini news parse failed - trying Claude web search`, OP.FALLBACK);
      return fetchNewsWithClaudeWebSearch({ city, state, date });
    }
    briefingLog.error(2, `Gemini news parse failed`, parseErr, OP.AI);
    return { items: [], reason: `Parse error: ${parseErr.message}`, provider: 'gemini' };
  }
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

    // ALL fields must be populated for dedup to apply
    if (hasTraffic && hasEvents && hasNews && hasClosures) {
      // Check freshness - only skip if data is < 60 seconds old
      const ageMs = Date.now() - new Date(existing.updated_at).getTime();
      if (ageMs < 60000) {
        briefingLog.info(`Cache hit (${Math.round(ageMs/1000)}s old) - skipping`, OP.CACHE);
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
        console.warn(`[BriefingService] ⚠️ Placeholder insert warning: ${insertErr.message}`);
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
        console.warn(`[BriefingService] ⚠️ Snapshot ${snapshotId} not found in DB`);
        return { success: false, error: 'Snapshot not found' };
      }
    } catch (err) {
      console.warn('[BriefingService] Could not fetch snapshot:', err.message);
      return { success: false, error: err.message };
    }
  }

  briefingLog.start(`${snapshot.city}, ${snapshot.state} (${snapshotId.slice(0, 8)})`);

  const { city, state } = snapshot;

  // SPLIT CACHE STRATEGY:
  // - ALWAYS refresh (every call): traffic, events
  // - Cached by city+state+day: news, school_closures

  // Step 1: Check for existing briefing by city+state (daily cache is city-level)
  // Events, news, concerts, closures are the same for all users in the same city
  // JOIN briefings with snapshots to get city/state (briefings table no longer stores location)
  let cachedDailyData = null;
  try {
    // Exclude current snapshotId - we want cached data from OTHER snapshots in same city
    // Also exclude placeholder rows (NULL news) by checking in the result
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
        sql`${briefings.news} IS NOT NULL`,  // Exclude placeholder rows
        sql`${briefings.school_closures} IS NOT NULL`  // Require school_closures too
      ))
      .orderBy(desc(briefings.updated_at))  // DESC = newest first
      .limit(1);

    if (existingBriefings.length > 0) {
      const existing = existingBriefings[0].briefing; // Access briefing from join result
      const userTimezone = snapshot.timezone || 'America/Chicago';

      // Check if cached data actually has content (not just empty arrays)
      const newsItems = existing.news?.items || [];
      const closureItems = existing.school_closures?.items || existing.school_closures || [];
      const hasActualNewsContent = Array.isArray(newsItems) && newsItems.length > 0;
      const hasActualClosuresContent = Array.isArray(closureItems) && closureItems.length > 0;

      // Only use cache if it has ACTUAL content AND is same day
      if (!isDailyBriefingStale(existing, userTimezone) && (hasActualNewsContent || hasActualClosuresContent)) {
        briefingLog.info(`Cache hit: news=${newsItems.length}, closures=${closureItems.length}`, OP.CACHE);
        cachedDailyData = {
          news: existing.news,
          school_closures: existing.school_closures
        };
      }
    }
  } catch (cacheErr) {
    console.warn(`[BriefingService] Cache lookup failed:`, cacheErr.message);
  }

  // Step 2: Get weather from snapshot
  let weatherResult = null;
  let existingWeather = null;
  try {
    existingWeather = typeof snapshot.weather === 'string' ? JSON.parse(snapshot.weather) : snapshot.weather;
  } catch (e) {
    console.warn('[BriefingService] Failed to parse snapshot weather:', e.message);
  }

  if (existingWeather && (existingWeather.tempF !== undefined || existingWeather.temperature !== undefined)) {
    weatherResult = {
      current: existingWeather,
      forecast: existingWeather.forecast || []
    };
  } else {
    weatherResult = { current: null, forecast: [] };
  }

  // Step 3: ALWAYS fetch fresh traffic, events, AND airport conditions (every snapshot)
  briefingLog.phase(1, `Fetching traffic + events + airport`, OP.AI);

  let trafficResult, eventsResult, airportResult;
  try {
    [trafficResult, eventsResult, airportResult] = await Promise.all([
      fetchTrafficConditions({ snapshot }),
      snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.reject(new Error('Snapshot required for events')),
      fetchAirportConditions({ snapshot })
    ]);
  } catch (freshErr) {
    console.error(`[BriefingService] ❌ FAIL-FAST: Traffic/Events/Airport fetch failed:`, freshErr.message);
    throw freshErr;
  }

  // Step 4: Get cached data (news, closures) or fetch fresh if cache miss
  let newsResult, schoolClosures;

  if (cachedDailyData) {
    // CACHE HIT: Use cached news and closures only
    newsResult = { items: cachedDailyData.news?.items || [] };
    schoolClosures = cachedDailyData.school_closures?.items || cachedDailyData.school_closures || [];
  } else {
    // CACHE MISS: Fetch news and closures from Gemini
    briefingLog.phase(2, `Fetching news + closures`, OP.AI);
    try {
      [newsResult, schoolClosures] = await Promise.all([
        fetchRideshareNews({ snapshot }),
        fetchSchoolClosures({ snapshot })
      ]);
    } catch (dailyErr) {
      console.error(`[BriefingService] ❌ FAIL-FAST: News/Closures fetch failed:`, dailyErr.message);
      throw dailyErr;
    }
  }

  let eventsItems = eventsResult?.items || [];
  const newsItems = newsResult?.items || [];

  const airportCount = airportResult?.airports?.length || 0;
  briefingLog.done(2, `events=${eventsItems.length}, news=${newsItems.length}, traffic=${trafficResult?.congestionLevel || 'ok'}, airports=${airportCount}`, OP.AI);

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
 * @param {string} timezone - User's timezone (e.g., 'America/Chicago')
 * @returns {boolean} True if briefing is from a different calendar day
 */
function isDailyBriefingStale(briefing, timezone = 'America/Chicago') {
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
 * Get existing briefing or generate if missing/stale
 * SPLIT CACHE STRATEGY:
 * - Daily briefing (news, events, closures): 24-hour cache
 * - Traffic: Always refreshes on app open or manual refresh
 * 
 * @param {string} snapshotId 
 * @param {object} snapshot - Full snapshot object
 * @param {object} options - Options for cache behavior
 * @param {boolean} options.forceRefresh - Force full regeneration even if cached (default: false)
 * @returns {Promise<object|null>} Parsed briefing data with fresh traffic
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
  } else if (!isDailyBriefingStale(briefing)) {
    // Daily briefing is still fresh (within 24h)
    briefing = await refreshTrafficInBriefing(briefing, snapshot);

    // CRITICAL: If events are EMPTY, fetch immediately
    if (areEventsEmpty(briefing)) {
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    } else if (isEventsStale(briefing)) {
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

  // FINAL SAFETY NET: If events are STILL empty after all paths, fetch now
  if (briefing && areEventsEmpty(briefing)) {
    try {
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    } catch (eventsErr) {
      briefingLog.warn(2, `Safety net events failed: ${eventsErr.message}`, OP.AI);
    }
  }

  return briefing;
}
