
import { db } from '../../db/drizzle.js';
import { briefings, snapshots, discovered_events } from '../../../shared/schema.js';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
// Event validation disabled - Gemini handles event discovery, Claude is fallback only
// import { validateEventSchedules, filterVerifiedEvents } from './event-schedule-validator.js';
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { briefingLog, OP } from '../../logger/workflow.js';
// Centralized AI adapter - use for all model calls
import { callModel } from '../ai/adapters/index.js';
// SerpAPI + GPT-5.2 event discovery (replaces Gemini for events)
import { syncEventsForLocation } from '../../scripts/sync-events.mjs';
// Dump last briefing row to file for debugging
import { dumpLastBriefingRow } from './dump-last-briefing.js';

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

    const prompt = `You are a traffic analyst for rideshare drivers. Analyze this traffic data and provide a comprehensive briefing.

DRIVER LOCATION: ${formattedAddress}
CITY: ${city}, ${state}

TRAFFIC STATISTICS:
- Total incidents: ${stats.total || 0}
- Highway incidents: ${stats.highways || 0}
- Road closures: ${stats.closures || 0}
- Construction zones: ${stats.construction || 0}
- Traffic jams: ${stats.jams || 0}
- Accidents: ${stats.accidents || 0}
- Overall congestion: ${tomtomData.congestionLevel}

HIGHEST PRIORITY INCIDENTS (sorted by driver impact):
${incidents.slice(0, 20).map((inc, i) =>
  `${i+1}. [${inc.category}] ${inc.road || ''} ${inc.location} (severity: ${inc.magnitude}, delay: ${inc.delayMinutes || 0}min)`
).join('\n')}

ROAD CLOSURES (${closures.length} total):
${closures.slice(0, 15).map(c => `- ${c.road || ''}: ${c.location}`).join('\n') || 'None reported'}

CONSTRUCTION ZONES (${construction.length} total):
${construction.slice(0, 8).map(c => `- ${c.road || ''}: ${c.location}`).join('\n') || 'None reported'}

ACTIVE TRAFFIC JAMS (${jams.length} total):
${jams.slice(0, 10).map(j => `- ${j.road || ''}: ${j.location}`).join('\n') || 'None reported'}

Return a JSON object with this EXACT structure:
{
  "briefing": "3-4 sentence traffic briefing focused on DRIVER IMPACT. First sentence: overall congestion level and incident count. Second sentence: which specific corridors/highways are worst affected and delays. Third sentence: secondary impacts and alternative routes. Fourth sentence (optional): time-sensitive info (rush hour ending, event traffic clearing). Be SPECIFIC with highway names, interchange names, and delay times.",
  "keyIssues": [
    "Specific issue 1 - road name, problem, and delay impact",
    "Specific issue 2 - road name, problem, and delay impact",
    "Specific issue 3 - road name, problem, and delay impact"
  ],
  "avoidAreas": [
    "Road/area to avoid: specific reason (e.g., '20+ min delays')",
    "Another road/area: specific reason"
  ],
  "driverImpact": "One sentence: How this specifically affects rideshare drivers - impact on pickup times, areas to avoid for efficient routing, expected delay ranges",
  "closuresSummary": "Summary of road closures - count and most impactful ones",
  "constructionSummary": "Summary of construction zones if significant"
}

IMPORTANT: The "briefing" field should be 3-4 sentences that a driver can read in 10 seconds to understand the traffic situation and make routing decisions. Focus on DRIVER IMPACT - which roads to avoid, expected delays, and alternative routing suggestions.`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 2048,
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
      briefing: analysis.briefing,  // Full 2-3 sentence traffic briefing
      headline: analysis.briefing?.split('.')[0] + '.' || analysis.headline,  // First sentence for backwards compat
      keyIssues: analysis.keyIssues || [],
      avoidAreas: analysis.avoidAreas || [],
      driverImpact: analysis.driverImpact,
      closuresSummary: analysis.closuresSummary,
      constructionSummary: analysis.constructionSummary,
      analyzedAt: new Date().toISOString()
    };
  } catch (err) {
    // Check if this is a credit exhaustion error - try GPT-5.2 fallback
    const isCreditError = err.message?.includes('credit balance') ||
                          err.message?.includes('insufficient_quota') ||
                          err.status === 400 || err.status === 402;

    if (isCreditError && openaiClient) {
      briefingLog.warn(1, `Claude traffic analysis failed (credits) - trying GPT-5.2 fallback`, OP.FALLBACK);

      // Try GPT-5.2 fallback
      const fallbackResult = await analyzeTrafficWithGPT52({ tomtomData, city, state, formattedAddress });
      const fallbackSucceeded = fallbackResult !== null;

      // Send email alert about the credit error
      sendModelErrorAlert({
        model: 'claude-opus-4-5-20251101',
        errorType: 'credit_exhaustion',
        errorMessage: err.message || 'Credit balance too low to access Anthropic API',
        context: 'traffic_analysis',
        fallbackSucceeded,
        fallbackModel: fallbackSucceeded ? 'gpt-5.2' : null
      }).catch(emailErr => console.error('Email alert failed:', emailErr.message));

      return fallbackResult;
    }

    // Send email alert for other errors too
    sendModelErrorAlert({
      model: 'claude-opus-4-5-20251101',
      errorType: 'api_error',
      errorMessage: err.message,
      context: 'traffic_analysis',
      fallbackSucceeded: false
    }).catch(emailErr => console.error('Email alert failed:', emailErr.message));

    briefingLog.warn(1, `Claude traffic analysis failed: ${err.message}`, OP.FALLBACK);
    return null;
  }
}

/**
 * Analyze TomTom traffic data with GPT-5.2 (fallback when Claude fails)
 * Takes raw prioritized incidents and creates a dispatcher-style summary
 */
async function analyzeTrafficWithGPT52({ tomtomData, city, state, formattedAddress }) {
  if (!openaiClient) {
    briefingLog.warn(1, `GPT-5.2 fallback unavailable - no OPENAI_API_KEY`, OP.FALLBACK);
    return null;
  }

  const startTime = Date.now();
  briefingLog.ai(1, 'GPT-5.2', `analyzing traffic for ${city}, ${state} (fallback)`);

  try {
    // Prepare incident summary (same as Claude version)
    const stats = tomtomData.stats || {};
    const incidents = tomtomData.incidents || [];

    // Group incidents by category for analysis
    const closures = incidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const construction = incidents.filter(i => i.category === 'Road Works');
    const jams = incidents.filter(i => i.category === 'Jam');

    const prompt = `You are a traffic analyst for rideshare drivers. Analyze this traffic data and provide a comprehensive briefing.

DRIVER LOCATION: ${formattedAddress}
CITY: ${city}, ${state}

TRAFFIC STATISTICS:
- Total incidents: ${stats.total || 0}
- Highway incidents: ${stats.highways || 0}
- Road closures: ${stats.closures || 0}
- Construction zones: ${stats.construction || 0}
- Traffic jams: ${stats.jams || 0}
- Accidents: ${stats.accidents || 0}
- Overall congestion: ${tomtomData.congestionLevel}

HIGHEST PRIORITY INCIDENTS (sorted by driver impact):
${incidents.slice(0, 20).map((inc, i) =>
  `${i+1}. [${inc.category}] ${inc.road || ''} ${inc.location} (severity: ${inc.magnitude}, delay: ${inc.delayMinutes || 0}min)`
).join('\n')}

ROAD CLOSURES (${closures.length} total):
${closures.slice(0, 15).map(c => `- ${c.road || ''}: ${c.location}`).join('\n') || 'None reported'}

CONSTRUCTION ZONES (${construction.length} total):
${construction.slice(0, 8).map(c => `- ${c.road || ''}: ${c.location}`).join('\n') || 'None reported'}

ACTIVE TRAFFIC JAMS (${jams.length} total):
${jams.slice(0, 10).map(j => `- ${j.road || ''}: ${j.location}`).join('\n') || 'None reported'}

Return a JSON object with this EXACT structure:
{
  "briefing": "3-4 sentence traffic briefing focused on DRIVER IMPACT. First sentence: overall congestion level and incident count. Second sentence: which specific corridors/highways are worst affected and delays. Third sentence: secondary impacts and alternative routes. Fourth sentence (optional): time-sensitive info (rush hour ending, event traffic clearing). Be SPECIFIC with highway names, interchange names, and delay times.",
  "keyIssues": [
    "Specific issue 1 - road name, problem, and delay impact",
    "Specific issue 2 - road name, problem, and delay impact",
    "Specific issue 3 - road name, problem, and delay impact"
  ],
  "avoidAreas": [
    "Road/area to avoid: specific reason (e.g., '20+ min delays')",
    "Another road/area: specific reason"
  ],
  "driverImpact": "One sentence: How this specifically affects rideshare drivers - impact on pickup times, areas to avoid for efficient routing, expected delay ranges",
  "closuresSummary": "Summary of road closures - count and most impactful ones",
  "constructionSummary": "Summary of construction zones if significant"
}

IMPORTANT: Return ONLY valid JSON. The "briefing" field should be 3-4 sentences that a driver can read in 10 seconds.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-5.2',
      max_completion_tokens: 2048,
      reasoning_effort: 'medium',
      messages: [
        { role: 'system', content: 'You are a traffic analyst assistant. Return only valid JSON responses.' },
        { role: 'user', content: prompt }
      ]
    });

    const content = response.choices[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      briefingLog.warn(1, `GPT-5.2 traffic analysis returned non-JSON`, OP.FALLBACK);
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `GPT-5.2 traffic analysis (${elapsedMs}ms) - fallback success`, OP.FALLBACK);

    return {
      briefing: analysis.briefing,
      headline: analysis.briefing?.split('.')[0] + '.' || analysis.headline,
      keyIssues: analysis.keyIssues || [],
      avoidAreas: analysis.avoidAreas || [],
      driverImpact: analysis.driverImpact,
      closuresSummary: analysis.closuresSummary,
      constructionSummary: analysis.constructionSummary,
      analyzedAt: new Date().toISOString(),
      fallbackProvider: 'gpt-5.2'
    };
  } catch (err) {
    briefingLog.warn(1, `GPT-5.2 traffic analysis failed: ${err.message}`, OP.FALLBACK);
    return null;
  }
}

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

DRIVER POSITION: ${formattedAddress} (${driverLat?.toFixed(4) || 'N/A'}, ${driverLon?.toFixed(4) || 'N/A'})
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
  const prompt = `Search the web for RECENT rideshare-relevant news in ${city}, ${state}. Today is ${date}.

CRITICAL: Only return news from the LAST 7 DAYS. Do NOT return outdated articles.

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
    "published_date": "YYYY-MM-DD",
    "impact": "high" | "medium" | "low",
    "source": "Source Name",
    "link": "url"
  }
]

IMPORTANT:
- The "published_date" field is REQUIRED - extract the actual publication date
- Only include articles published within the last 7 days
- If you cannot determine the publication date, DO NOT include that article
- If no recent news found, return empty array []`;

  const system = `You are a news search assistant for rideshare drivers. Search the web for RECENT relevant news (last 7 days only) and return structured JSON data with publication dates. Focus on news that impacts driver earnings, regulations, and working conditions. Do NOT return outdated articles.`;

  try {
    // Uses BRIEFING_FALLBACK role (Claude with web_search) for news fallback
    const result = await callModel('BRIEFING_FALLBACK', { system, user: prompt });

    if (!result.ok) {
      briefingLog.warn(2, `Claude news failed: ${result.error}`, OP.FALLBACK);
      return { items: [], reason: result.error, provider: 'claude' };
    }

    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : [];

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      return { items: [], reason: 'No news found via Claude web search', provider: 'claude' };
    }

    // Filter out stale news (older than 7 days) as safety net
    const filteredNews = filterRecentNews(newsArray, date);

    briefingLog.done(2, `Claude: ${filteredNews.length} news items (${newsArray.length - filteredNews.length} filtered), ${result.citations?.length || 0} citations`, OP.FALLBACK);
    return { items: filteredNews, citations: result.citations, reason: null, provider: 'claude' };
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
  // Require valid location data - no hardcoded defaults for global app
  if (!snapshot?.city || !snapshot?.state) {
    briefingLog.warn(2, 'Missing city/state in snapshot - cannot fetch events', OP.AI);
    return { items: [], reason: 'Location data not available' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  // Require valid location data - no hardcoded defaults for global app
  if (!snapshot?.city || !snapshot?.state) {
    briefingLog.warn(2, 'Missing city/state in snapshot - cannot fetch events (legacy)', OP.AI);
    return { items: [], reason: 'Location data not available' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const hour = snapshot?.hour ?? new Date().getHours();
  const timezone = snapshot?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  briefingLog.ai(2, 'SerpAPI+GPT-5.2', `events for ${city}, ${state} (${todayStr})`);

  try {
    // Run SerpAPI + GPT-5.2 event discovery (isDaily=false = fast mode)
    // This stores discovered events in the discovered_events table
    const syncResult = await syncEventsForLocation(
      { city, state, lat, lng },
      false // isDaily=false means SerpAPI + GPT-5.2 only
    );

    briefingLog.done(2, `Sync: ${syncResult.events.length} found, ${syncResult.inserted} new`, OP.AI);
  } catch (syncErr) {
    briefingLog.warn(2, `Event sync failed: ${syncErr.message}`, OP.AI);
    // Continue - we can still read cached events from DB
  }

  // Read events from discovered_events table for this city/state and date range
  try {
    const events = await db.select()
      .from(discovered_events)
      .where(and(
        eq(discovered_events.city, city),
        eq(discovered_events.state, state),
        gte(discovered_events.event_date, todayStr),
        lte(discovered_events.event_date, endDateStr),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_date)
      .limit(50);

    if (events.length > 0) {
      // Map discovered_events format to the briefing events format
      const normalizedEvents = events.map(e => ({
        title: e.title,
        summary: [e.title, e.venue_name, e.event_date, e.event_time].filter(Boolean).join(' • '),
        impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : 'medium',
        source: e.source_model,
        event_type: e.category,
        subtype: e.category, // For EventsComponent category grouping
        event_date: e.event_date,
        event_time: e.event_time,
        event_end_time: e.event_end_time,
        address: e.address,
        venue: e.venue_name,
        location: e.venue_name ? `${e.venue_name}, ${e.address || ''}`.trim() : e.address,
        latitude: e.lat,
        longitude: e.lng
      }));

      briefingLog.done(2, `Events: ${normalizedEvents.length} from discovered_events table`, OP.DB);
      return { items: normalizedEvents, reason: null, provider: 'discovered_events' };
    }

    briefingLog.info(`No events found for ${city}, ${state}`);
    return { items: [], reason: 'No events found for this location', provider: 'discovered_events' };
  } catch (dbErr) {
    briefingLog.error(2, `Events DB read failed: ${dbErr.message}`, dbErr, OP.DB);
    return { items: [], reason: `Database error: ${dbErr.message}`, provider: 'discovered_events' };
  }
}

export async function confirmTBDEventDetails(events) {
  if (!process.env.GEMINI_API_KEY) return events;

  const tbdEvents = events.filter(e => e.location?.includes('TBD') || e.event_time?.includes('TBD') || e.location === 'TBD');
  if (tbdEvents.length === 0) return events;

  briefingLog.phase(2, `Confirming ${tbdEvents.length} TBD events`, OP.AI);

  const eventDetails = tbdEvents.map(e => `- Title: "${e.title}"\n  Location: "${e.location || 'TBD'}"\n  Time: "${e.event_time || 'TBD'}"`).join('\n\n');
  const system = `You are an event verification assistant. Search to confirm event details and return structured JSON data.`;
  const user = `Review these events with incomplete data and provide confirmed details. For each event, return JSON:
{
  "title": "exact event name",
  "confirmed_venue": "full venue name and address or 'Unable to confirm'",
  "confirmed_time": "start time like '7:00 PM' or 'Unable to confirm'",
  "confidence": "high/medium/low"
}

Events:
${eventDetails}

Return JSON array with one object per event.`;

  // Uses BRIEFING_EVENTS_DISCOVERY role for TBD confirmation
  const result = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

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

export async function fetchRideshareNews({ snapshot }) {
  // Require valid location data - no hardcoded defaults for global app
  if (!snapshot?.city || !snapshot?.state) {
    briefingLog.warn(2, 'Missing city/state in snapshot - cannot fetch news', OP.AI);
    return { items: [], reason: 'Location data not available' };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const timezone = snapshot?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  const prompt = `You MUST search for and find RECENT rideshare-relevant news. Search the web NOW.

Location: ${city}, ${state}
Today's Date: ${date}

CRITICAL: Only return news from the LAST 7 DAYS. Do NOT return outdated articles.

MANDATORY SEARCH QUERIES:
1. Search: "${city} ${state} rideshare driver news today"
2. Search: "Uber Lyft driver earnings ${city}"
3. Search: "${state} gig economy news rideshare"
4. Search: "rideshare regulation update ${state}"

Return JSON array:
[
  {
    "title": "News Title",
    "summary": "One sentence summary with driver impact",
    "published_date": "YYYY-MM-DD",
    "impact": "high" | "medium" | "low",
    "source": "Source Name",
    "link": "url"
  }
]

IMPORTANT:
- The "published_date" field is REQUIRED - extract the actual publication date from the article
- Only include articles published within the last 7 days of ${date}
- If you cannot determine the publication date, DO NOT include that article
- Return 2-5 items if found. If no recent news found, return empty array []`;

  const system = `You are a rideshare news research assistant. Search for recent news relevant to rideshare drivers and return structured JSON data with publication dates.`;
  // Uses BRIEFING_NEWS role (Gemini with google_search)
  const result = await callModel('BRIEFING_NEWS', { system, user: prompt });

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

    // Filter out stale news (older than 7 days) as safety net
    const filteredNews = filterRecentNews(newsArray, date);

    briefingLog.done(2, `Gemini: ${filteredNews.length} news items (${newsArray.length - filteredNews.length} filtered as stale)`, OP.AI);
    return { items: filteredNews, reason: null, provider: 'gemini' };
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

  // Require valid location data - no fallbacks for global app
  if (!snapshot.city || !snapshot.state || !snapshot.timezone) {
    console.error(`[BriefingService] ⚠️ Snapshot ${snapshotId} missing required location data (city/state/timezone)`);
    return { success: false, error: 'Snapshot missing required location data' };
  }

  briefingLog.start(`${snapshot.city}, ${snapshot.state} (${snapshotId.slice(0, 8)})`);

  const { city, state } = snapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // BRIEFING CACHING STRATEGY:
  // ═══════════════════════════════════════════════════════════════════════════
  // ALWAYS FRESH (every request):  Weather (4-hr forecast), Traffic, Events, Airport
  // CACHED (24-hour, same city):   News, School Closures
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 1: Check for cached NEWS + SCHOOL CLOSURES only (city-level, 24-hour cache)
  // Weather, traffic, events, and airport are NEVER cached - always fetched fresh
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
      // NO FALLBACK - timezone is required and validated at entry
      const userTimezone = snapshot.timezone;

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

  // Step 2: ALWAYS fetch fresh weather (4-hour forecast), traffic, events, AND airport conditions
  // NOTE: The snapshot has current conditions from location resolution, but the briefing needs the 4-hour forecast
  // which must be fetched fresh from Google Weather API - just like traffic, events, and airport.
  briefingLog.phase(1, `Fetching weather + traffic + events + airport`, OP.AI);

  let weatherResult, trafficResult, eventsResult, airportResult;
  try {
    [weatherResult, trafficResult, eventsResult, airportResult] = await Promise.all([
      fetchWeatherConditions({ snapshot }),
      fetchTrafficConditions({ snapshot }),
      snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.reject(new Error('Snapshot required for events')),
      fetchAirportConditions({ snapshot })
    ]);
  } catch (freshErr) {
    console.error(`[BriefingService] ❌ FAIL-FAST: Weather/Traffic/Events/Airport fetch failed:`, freshErr.message);
    throw freshErr;
  }

  // Step 3: Get cached data (news, closures) or fetch fresh if cache miss
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
      console.warn(`[BriefingService] ⚠️ Failed to send NOTIFY: ${notifyErr.message}`);
    }

    // Dump last briefing row to file for debugging
    dumpLastBriefingRow().catch(err => 
      console.warn(`[BriefingService] ⚠️ Failed to dump briefing: ${err.message}`)
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
    console.warn('[BriefingService] isDailyBriefingStale called without timezone - treating as stale');
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
