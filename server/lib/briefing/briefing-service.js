
import { db } from '../../db/drizzle.js';
import { briefings, snapshots } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
// Event validation disabled - Gemini handles event discovery, Claude is fallback only
// import { validateEventSchedules, filterVerifiedEvents } from './event-schedule-validator.js';
import Anthropic from "@anthropic-ai/sdk";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Claude Opus fallback configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 8192;
const FALLBACK_TEMPERATURE = 0.2;

console.log('[BriefingService] 🔑 GEMINI_API_KEY available at startup:', !!process.env.GEMINI_API_KEY);
console.log('[BriefingService] 🔑 ANTHROPIC_API_KEY available for fallback:', !!process.env.ANTHROPIC_API_KEY);

/**
 * Claude Opus fallback when Gemini fails
 * Uses web search tool for grounded responses
 */
async function callClaudeOpusFallback({ prompt, maxTokens = FALLBACK_MAX_TOKENS }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured for fallback' };
  }

  try {
    console.log(`[BriefingService] 🔄 Calling Claude Opus fallback...`);
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
    console.log(`[BriefingService] ✅ Claude Opus fallback succeeded (${cleanOutput.length} chars)`);
    return { ok: true, output: cleanOutput, usedFallback: true };

  } catch (err) {
    console.error('[BriefingService] ❌ Claude fallback error:', err.message);
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
    console.error('[BriefingService] ❌ GEMINI_API_KEY not configured');
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  // RETRY CONFIGURATION: 3 attempts with 2s, 4s, 8s delays
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[BriefingService] ⏳ Retry attempt ${attempt-1}/${MAX_RETRIES} due to overload...`);
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
        const errText = await response.text();
        console.warn(`[BriefingService] ⚠️ Gemini Busy (Status ${response.status}): ${errText.substring(0, 100)}`);
        
        if (attempt <= MAX_RETRIES) {
          // Wait before retrying (Exponential Backoff)
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); 
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry loop
        }
        return { ok: false, error: `Gemini Overloaded after ${MAX_RETRIES} retries` };
      }

      if (!response.ok) {
        const err = await response.text();
        return { ok: false, error: `Gemini API ${response.status}: ${err}` };
      }

      const data = await response.json();

      // Debug: Log full response structure when there's an issue
      const candidate = data.candidates?.[0];
      if (!candidate) {
        console.error('[BriefingService] ❌ No candidates in Gemini response:', JSON.stringify(data, null, 2).substring(0, 500));
        return { ok: false, error: `No candidates in response: ${data.error?.message || 'unknown'}` };
      }

      // Check for safety blocking
      if (candidate.finishReason === 'SAFETY') {
        console.error('[BriefingService] ❌ Response blocked by safety filter:', candidate.safetyRatings);
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
        // Log comprehensive debug info for root cause analysis
        console.error('[BriefingService] ❌ EMPTY RESPONSE DEBUG:');
        console.error('[BriefingService]   Parts count:', parts.length);
        console.error('[BriefingService]   Parts keys:', JSON.stringify(parts.map(p => Object.keys(p))));
        console.error('[BriefingService]   finishReason:', candidate.finishReason);
        console.error('[BriefingService]   Content exists:', !!candidate.content);
        console.error('[BriefingService]   Raw parts:', JSON.stringify(parts).substring(0, 500));
        // Log full candidate for debugging (truncated)
        console.error('[BriefingService]   Full candidate:', JSON.stringify(candidate).substring(0, 1000));
        return { ok: false, error: `Empty response from Gemini (finishReason: ${candidate.finishReason || 'unknown'}, parts: ${parts.length})` };
      }

      const cleanText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      return { ok: true, output: cleanText };

    } catch (error) {
      console.error(`[BriefingService] Network error (Attempt ${attempt}):`, error.message);
      if (attempt <= MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS));
        continue;
      }
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

async function fetchEventsWithGemini3ProPreview({ snapshot }) {
  console.log(`[fetchEventsWithGemini3ProPreview] CALLED - GEMINI_API_KEY exists: ${!!process.env.GEMINI_API_KEY}`);

  if (!process.env.GEMINI_API_KEY) {
    console.error('[BriefingService] ❌ GEMINI_API_KEY is NOT set - cannot fetch events');
    return [];
  }

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
    // Compute today's date in the user's timezone
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format
  }
  const currentTime = `${String(hour).padStart(2, '0')}:00`;

  console.log(`[BriefingService] 📅 Events date computed:`, { date, localIso: snapshot?.local_iso, timezone, hour });
  
  console.log(`[BriefingService] 🎯 Fetching events: city=${city}, state=${state}, lat=${lat}, lng=${lng}, date=${date}, time=${currentTime}`);

  // Determine time context for search (today vs tonight)
  const timeContext = hour >= 17 ? 'tonight' : 'today';
  const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });

  const prompt = `TASK: Find ALL major events happening in ${city}, ${state} ${timeContext.toUpperCase()} (${date}) and nearby cities within 50 miles that affect rideshare demand. Use Google Search tool now.

LOCATION: ${city}, ${state} (${lat}, ${lng}) - 50 mile radius (include all nearby cities in this metro area)
DATE: ${date} (${dayOfWeek}) - Current time: ${currentTime} (${timezone})
TIMEZONE: ${timezone}

SEARCH QUERIES (execute ALL of these):
1. "events ${timeContext} ${city} ${state} ${date}"
2. "concerts shows ${timeContext} near ${city} ${state}"
3. "sports games ${timeContext} ${city} metro area ${date}"
4. "live music venues ${city} ${state} ${timeContext}"
5. "things to do ${timeContext} near ${city} ${state}"

EVENT TYPES TO FIND:
- Concerts, live music, festivals
- Sports games, matches, watch parties
- Comedy shows, theaters, performances
- Major venue events (bars, clubs, restaurants with events)
- Parades, street fairs, community events
- Anything with major expected crowd/rideshare demand TODAY

CRITICAL REQUIREMENTS FOR EACH EVENT:
✓ Event title (exact name)
✓ Venue name (specific location)
✓ Full street address (street, city, state, zip)
✓ Event start time (HH:MM AM/PM local time)
✓ Event end time (HH:MM AM/PM local time) - REQUIRED
✓ Estimated distance in miles from (${lat}, ${lng})
✓ Staging/parking area recommendations for rideshare drivers
✓ Impact level on rideshare demand (high/medium/low)

RETURN FORMAT (ONLY this JSON, no markdown):
[
  {
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "123 Main St, City, ST 12345",
    "event_date": "${date}",
    "event_time": "7:00 PM",
    "event_end_time": "11:00 PM",
    "type": "demand_event",
    "subtype": "concert",
    "estimated_distance_miles": 5.2,
    "impact": "high",
    "staging_area": "North parking lot",
    "recommended_driver_action": "reposition_now"
  }
]`;

  const result = await callGeminiWithSearch({ prompt, maxTokens: 4096 });

  // Handle empty response gracefully - Gemini sometimes returns OK with no content
  if (!result.ok) {
    if (result.error === 'Empty response' || result.error === 'Empty response from Gemini') {
      console.warn(`[BriefingService] ⚠️ Gemini returned empty events response for ${city}, ${state}`);
      return { items: [], reason: 'Gemini returned empty response - may be overloaded' };
    }
    const errorMsg = `Gemini events API failed: ${result.error}`;
    console.error(`[BriefingService] ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    console.log(`[BriefingService] 📥 Raw Gemini events output (first 500 chars):`, result.output?.substring(0, 500));

    const parsed = safeJsonParse(result.output);
    const events = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    const validEvents = events.filter(e => e.title && e.venue && e.address);

    if (validEvents.length === 0) {
      console.log('[BriefingService] ℹ️ No valid events found. Raw parsed:', JSON.stringify(parsed)?.substring(0, 300));
      console.log('[BriefingService] ℹ️ Events before filter:', events.length, 'After filter:', validEvents.length);
      if (events.length > 0 && events[0]) {
        console.log('[BriefingService] ℹ️ First event missing fields:', {
          hasTitle: !!events[0].title,
          hasVenue: !!events[0].venue,
          hasAddress: !!events[0].address,
          keys: Object.keys(events[0])
        });
      }
      return { items: [], reason: 'No events found for this location and time' };
    }

    console.log('[BriefingService] ✅ Found', validEvents.length, 'valid events:', validEvents.map(e => e.title).join(', '));
    return { items: validEvents, reason: null };
  } catch (err) {
    const errorMsg = `Failed to parse Gemini events response: ${err.message}`;
    console.error(`[BriefingService] ❌ ${errorMsg}. Raw output:`, result.output?.substring(0, 300));
    throw new Error(errorMsg);
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

  console.log(`[BriefingService] Found ${tbdEvents.length} events with TBD details, confirming...`);

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
    console.error('[BriefingService] Gemini confirmation error:', result.error);
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
    console.error('[BriefingService] Gemini response parse error:', e.message);
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
    console.warn(`[fetchWeatherForecast] Gemini error: ${result.error}`);
    return { current: null, forecast: [] };
  }

  try {
    const weatherData = safeJsonParse(result.output);
    console.log('[fetchWeatherForecast] ✅ Got forecast:', { current: !!weatherData.current, forecast_hours: weatherData.forecast?.length || 0 });
    return weatherData;
  } catch (parseErr) {
    console.error('[fetchWeatherForecast] Parse error:', parseErr.message);
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
    console.warn('[BriefingService] GOOGLE_MAPS_API_KEY not set, skipping weather fetch');
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
    console.error('[BriefingService] Weather fetch error:', error);
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
    console.warn(`[BriefingService] School closures error: ${result.error}`);
    return [];
  }

  try {
    const closures = safeJsonParse(result.output);
    const closuresArray = Array.isArray(closures) ? closures : [];
    console.log(`[BriefingService] ✅ Found ${closuresArray.length} school closures for ${city}, ${state}`);
    return closuresArray;
  } catch (parseErr) {
    console.error('[BriefingService] School closures JSON parse error:', parseErr.message);
    return [];
  }
}

export async function fetchTrafficConditions({ snapshot }) {
  const city = snapshot?.city || 'Unknown';
  const state = snapshot?.state || 'Unknown';
  const date = snapshot?.date;

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

  if (!process.env.GEMINI_API_KEY) {
    console.warn('[BriefingService] ⚠️ GEMINI_API_KEY not configured - using fallback traffic');
    return fallbackTraffic;
  }

  console.log(`[BriefingService] 🚗 Analyzing traffic for ${city}, ${state}...`);

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
    console.warn(`[BriefingService] ⚠️ Gemini traffic API failed: ${result.error} - using fallback`);
    return fallbackTraffic;
  }

  try {
    const parsed = safeJsonParse(result.output);
    console.log(`[BriefingService] ✅ Traffic analysis complete: ${parsed.summary?.substring(0, 80)}`);

    return {
      summary: parsed.summary,
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      congestionLevel: parsed.congestionLevel || 'medium',
      highDemandZones: Array.isArray(parsed.highDemandZones) ? parsed.highDemandZones : [],
      repositioning: parsed.repositioning || null,
      surgePricing: parsed.surgePricing || false,
      safetyAlert: parsed.safetyAlert || null,
      fetchedAt: new Date().toISOString()
    };
  } catch (parseErr) {
    console.warn(`[BriefingService] ⚠️ Failed to parse traffic response: ${parseErr.message} - using fallback`);
    return fallbackTraffic;
  }
}

async function fetchRideshareNews({ snapshot }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured - cannot fetch news');
  }

  const city = snapshot?.city || 'Frisco';
  const state = snapshot?.state || 'TX';
  const date = snapshot?.date || new Date().toISOString().split('T')[0];
  
  console.log(`[BriefingService] 📰 Fetching news: city=${city}, state=${state}, date=${date}`);

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

  // FAIL-FAST: If Gemini API fails, throw and fail entire flow
  if (!result.ok) {
    throw new Error(`Gemini news API failed: ${result.error}`);
  }

  try {
    const parsed = safeJsonParse(result.output);
    const newsArray = Array.isArray(parsed) ? parsed : [];

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      console.log('[BriefingService] ℹ️ Gemini returned no news for this location/time');
      return { items: [], reason: 'No rideshare news found for this location' };
    }
    
    console.log(`[BriefingService] ✅ Gemini search returned ${newsArray.length} news items`);
    return { items: newsArray, reason: null };
  } catch (parseErr) {
    throw new Error(`Failed to parse Gemini news response: ${parseErr.message}`);
  }
}

export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  // Dedup 1: Check if already in flight in this process (concurrent calls)
  if (inFlightBriefings.has(snapshotId)) {
    console.log(`[BriefingService] ⏳ Briefing already in flight for ${snapshotId}, waiting...`);
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
        console.log(`[BriefingService] ⚡ DEDUP: Briefing for ${snapshotId} exists with ALL data (${Math.round(ageMs/1000)}s old), skipping regeneration`);
        return { success: true, briefing: existing, deduplicated: true };
      }
    } else if (hasTraffic || hasEvents) {
      // Partial data exists - log which fields are missing and continue to regenerate
      console.log(`[BriefingService] ⚠️ Partial briefing exists for ${snapshotId}: traffic=${hasTraffic}, events=${hasEvents}, news=${hasNews}, closures=${hasClosures} - will regenerate`);
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
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log(`[BriefingService] 📝 Created placeholder briefing row for ${snapshotId}`);
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
        updated_at: new Date()
      })
      .where(eq(briefings.snapshot_id, snapshotId));
    console.log(`[BriefingService] 🔄 Cleared traffic/events fields for refresh: ${snapshotId}`);
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

  console.log(`[BriefingService] 📸 Snapshot:`, {
    snapshot_id: snapshot.snapshot_id,
    lat: snapshot.lat,
    lng: snapshot.lng,
    city: snapshot.city,
    state: snapshot.state,
    formatted_address: snapshot.formatted_address,  // CRITICAL: Must be present for strategists
    timezone: snapshot.timezone,
    date: snapshot.date,
    dow: snapshot.dow,
    hour: snapshot.hour,
    day_part_key: snapshot.day_part_key,
    weather: snapshot.weather,
    air: snapshot.air
  });

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
        const ageMinutes = Math.round((Date.now() - new Date(existing.updated_at).getTime()) / 60000);
        console.log(`[BriefingService] ⚡ CACHE HIT: Reusing cached data for ${city}, ${state} (same day, ${ageMinutes}min old, news=${newsItems.length}, closures=${closureItems.length})`);
        // Only cache news and school_closures - events/traffic refresh every call
        cachedDailyData = {
          news: existing.news,
          school_closures: existing.school_closures
        };
      } else if (!isDailyBriefingStale(existing, userTimezone)) {
        console.log(`[BriefingService] 🆕 CACHE SKIP: Cached briefing for ${city}, ${state} has no content (news=${newsItems.length}, closures=${closureItems.length}) - will fetch fresh`);
      } else {
        console.log(`[BriefingService] 📅 NEW DAY: Refreshing all cached data for ${city}, ${state}`);
      }
    } else {
      console.log(`[BriefingService] 🆕 CACHE MISS: No cached briefing for ${city}, ${state}`);
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
    console.log(`[BriefingService] ⚡ Reusing weather from snapshot - tempF=${existingWeather.tempF}`);
    weatherResult = {
      current: existingWeather,
      forecast: existingWeather.forecast || []
    };
  } else {
    console.log(`[BriefingService] ☁️ Snapshot has no weather data, skipping fetch`);
    weatherResult = { current: null, forecast: [] };
  }

  // Step 3: ALWAYS fetch fresh traffic AND events (every snapshot)
  console.log(`[BriefingService] 🚗 Fetching FRESH traffic for snapshot ${snapshotId}`);
  console.log(`[BriefingService] 📅 Fetching FRESH events for snapshot ${snapshotId}`);

  let trafficResult, eventsResult;
  try {
    [trafficResult, eventsResult] = await Promise.all([
      fetchTrafficConditions({ snapshot }),
      snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.reject(new Error('Snapshot required for events'))
    ]);
  } catch (freshErr) {
    console.error(`[BriefingService] ❌ FAIL-FAST: Traffic/Events fetch failed:`, freshErr.message);
    throw freshErr;
  }

  // Step 4: Get cached data (news, closures) or fetch fresh if cache miss
  let newsResult, schoolClosures;

  if (cachedDailyData) {
    // CACHE HIT: Use cached news and closures only
    console.log(`[BriefingService] ✅ Using CACHED data (news, closures)`);
    newsResult = { items: cachedDailyData.news?.items || [] };
    schoolClosures = cachedDailyData.school_closures?.items || cachedDailyData.school_closures || [];
  } else {
    // CACHE MISS: Fetch news and closures from Gemini
    console.log(`[BriefingService] 🔄 Fetching FRESH cached data (news, closures) from Gemini`);
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

  // NOTE: Event validation with Claude Opus disabled - Gemini handles event discovery
  // Claude Opus is used as a FALLBACK model when Gemini API fails (see callClaudeOpusFallback)
  // The EventValidator was causing events to be filtered out incorrectly

  console.log(`[BriefingService] ✅ Briefing data ready: events=${eventsItems.length}, news=${newsItems.length}, traffic=${!!trafficResult}, closures=${schoolClosures?.length || 0}`);
  console.log(`[BriefingService] 📊 Data sources: daily=${cachedDailyData ? 'CACHED' : 'FRESH'}, traffic=FRESH`);

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
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
      console.log(`[BriefingService] ✅ Updated briefing for ${snapshotId}`);
    } else {
      await db.insert(briefings).values(briefingData);
      console.log(`[BriefingService] ✅ Created briefing for ${snapshotId}`);
    }

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
  const isStale = briefingDate !== todayDate;

  if (isStale) {
    console.log(`[BriefingService] 📅 NEW DAY - Daily briefing stale: cached=${briefingDate}, today=${todayDate} (${timezone})`);
  } else {
    const ageMinutes = Math.round((now - updatedAt) / (1000 * 60));
    console.log(`[BriefingService] ✓ Same day briefing: ${briefingDate} (${ageMinutes} min old)`);
  }

  return isStale;
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
  const isStale = ageHours > EVENTS_CACHE_HOURS;

  if (isStale) {
    console.log(`[BriefingService] 🎭 Events stale: ${ageHours.toFixed(1)}h old (>${EVENTS_CACHE_HOURS}h threshold)`);
  }

  return isStale;
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
    console.log(`[BriefingService] 🎭 Refreshing events data (stale >4h)...`);

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

      console.log(`[BriefingService] ✅ Events refreshed: ${eventsItems.length} events for ${briefing.snapshot_id}`);
    } catch (dbErr) {
      console.warn('[BriefingService] ⚠️ Could not update events in DB:', dbErr.message);
    }

    return briefing;
  } catch (err) {
    console.warn('[BriefingService] ⚠️ Events refresh failed, keeping existing:', err.message);
    return briefing;
  }
}

/**
 * Refresh traffic data in existing briefing (always fetches fresh)
 * Traffic changes rapidly - fetch on every call
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated traffic_conditions
 */
async function refreshTrafficInBriefing(briefing, snapshot) {
  try {
    console.log(`[BriefingService] 🚗 Fetching fresh traffic data...`);

    const trafficResult = await fetchTrafficConditions({ snapshot });
    if (trafficResult) {
      // Update only the traffic data, keep daily briefing components cached
      briefing.traffic_conditions = trafficResult;
      briefing.updated_at = new Date();

      // Update database with fresh traffic
      try {
        await db.update(briefings)
          .set({
            traffic_conditions: trafficResult,
            updated_at: new Date()
          })
          .where(eq(briefings.snapshot_id, briefing.snapshot_id));

        console.log(`[BriefingService] ✅ Traffic refreshed for ${briefing.snapshot_id}`);
      } catch (dbErr) {
        console.warn('[BriefingService] ⚠️ Could not update traffic in DB:', dbErr.message);
      }
    }

    return briefing;
  } catch (err) {
    console.warn('[BriefingService] ⚠️ Traffic refresh failed, keeping existing:', err.message);
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
      console.log(`[BriefingService] ⏳ Briefing incomplete (${Math.round(placeholderAgeMs/1000)}s old), missing: [${missingFields.join(', ')}] - returning null`);
      return null; // Let frontend poll again
    } else {
      console.log(`[BriefingService] ⚠️ Stale incomplete briefing (${Math.round(placeholderAgeMs/1000)}s old), missing: [${missingFields.join(', ')}] - will regenerate`);
      briefing = null; // Force regeneration
    }
  }

  // Check if we need to regenerate: no briefing, or forced refresh
  const needsFullRegeneration = !briefing || forceRefresh;
  
  if (needsFullRegeneration) {
    const reason = !briefing ? 'missing' : 'forced';
    console.log(`[BriefingService] Regenerating full briefing (${reason}): ${snapshotId}`);
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
        console.log(`[BriefingService] ✅ Fresh briefing generated for ${snapshotId}`);
      }
    } catch (genErr) {
      console.error('[BriefingService] Generation error:', genErr.message);
      // If regeneration fails but we have stale data, return stale data as fallback
      if (briefing) {
        console.warn('[BriefingService] ⚠️ Returning stale briefing due to generation error');
      }
    }
  } else if (!isDailyBriefingStale(briefing)) {
    // Daily briefing is still fresh (within 24h), check if traffic needs refresh (>5min old)
    console.log(`[BriefingService] ✓ Cache hit (24h): daily briefing for ${snapshotId}`);
    briefing = await refreshTrafficInBriefing(briefing, snapshot);

    // CRITICAL: If events are EMPTY, fetch immediately (events are never "none" in a metro area)
    if (areEventsEmpty(briefing)) {
      console.log(`[BriefingService] 🎭 Events EMPTY - fetching immediately (events always exist in metro areas)...`);
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    }
    // Also check if events specifically are stale (4h vs 24h for other daily data)
    else if (isEventsStale(briefing)) {
      console.log(`[BriefingService] 🎭 Events stale within same day, refreshing events...`);
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    }
  } else {
    // Daily briefing is older than 24h, regenerate everything
    console.log(`[BriefingService] Daily briefing stale (>24h): ${snapshotId}, regenerating...`);
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
        console.log(`[BriefingService] ✅ Fresh daily briefing generated for ${snapshotId}`);
      }
    } catch (genErr) {
      console.error('[BriefingService] Generation error:', genErr.message);
      if (briefing) {
        console.warn('[BriefingService] ⚠️ Returning stale briefing due to generation error');
      }
    }
  }

  // FINAL SAFETY NET: If events are STILL empty after all paths, fetch now
  // This ensures we never return a briefing without attempting to get events
  if (briefing && areEventsEmpty(briefing)) {
    console.log(`[BriefingService] 🎭 SAFETY NET: Events still empty after briefing flow - fetching now...`);
    try {
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    } catch (eventsErr) {
      console.warn(`[BriefingService] ⚠️ Safety net events fetch failed: ${eventsErr.message}`);
    }
  }

  return briefing;
}
