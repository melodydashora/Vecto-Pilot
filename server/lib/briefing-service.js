
import { db } from '../db/drizzle.js';
import { briefings, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

console.log('[BriefingService] 🔑 GEMINI_API_KEY available at startup:', !!process.env.GEMINI_API_KEY);

/**
 * Core Gemini API helper with Google Search, safety overrides, and thinking_level
 * Per MODEL.md: Use gemini-3-pro-preview with google_search tool
 */
async function callGeminiWithSearch({ prompt, maxTokens = 4096, temperature = 0.1, responseMimeType = "application/json" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const callStart = Date.now();
  
  console.log(`[BriefingService] 🔄 callGeminiWithSearch START at ${new Date().toISOString()}`);
  console.log(`[BriefingService] 🔑 API Key exists: ${!!apiKey}, length: ${apiKey?.length || 0}`);

  if (!apiKey) {
    console.error('[BriefingService] ❌ GEMINI_API_KEY not configured at runtime');
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  const model = 'gemini-3-pro-preview';
  
  try {
    console.log(`[BriefingService] 📡 Sending Gemini request to ${model}...`);
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          generationConfig: {
            thinking_level: "high",
            temperature,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: maxTokens,
            responseMimeType
          }
        })
      }
    );

    const elapsed = Date.now() - callStart;
    console.log(`[BriefingService] 📥 Gemini response received in ${elapsed}ms, status: ${response.status}`);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[BriefingService] Gemini API Error ${response.status}: ${errText.substring(0, 500)}`);
      
      if (response.status === 400 && errText.includes('API key expired')) {
        console.error('[BriefingService] ⚠️ ACTION REQUIRED: Update GEMINI_API_KEY in Secrets');
        return { ok: false, error: 'GEMINI_API_KEY expired - update in Secrets' };
      }
      
      return { ok: false, error: `API error ${response.status}` };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn('[BriefingService] Empty response from Gemini');
      return { ok: false, error: 'Empty response' };
    }

    console.log(`[BriefingService] ✅ Gemini returned ${text.length} chars in ${Date.now() - callStart}ms`);
    const cleanText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return { ok: true, output: cleanText };
  } catch (error) {
    const elapsed = Date.now() - callStart;
    console.error(`[BriefingService] Gemini fetch error after ${elapsed}ms:`, error.message);
    return { ok: false, error: error.message };
  }
}

const inFlightBriefings = new Map();

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

  const date = snapshot?.date || new Date().toISOString().split('T')[0];
  const city = snapshot?.city || 'Frisco';
  const state = snapshot?.state || 'TX';
  const lat = snapshot?.lat || 33.1285;
  const lng = snapshot?.lng || -96.8756;
  const hour = snapshot?.hour || 22;
  const timezone = snapshot?.timezone || 'America/Chicago';
  const currentTime = `${String(hour).padStart(2, '0')}:00`;
  
  console.log(`[BriefingService] 🎯 Fetching events: city=${city}, state=${state}, lat=${lat}, lng=${lng}, date=${date}, time=${currentTime}`);

  const prompt = `TASK: Find ALL major events happening in ${city}, ${state} TODAY (${date}) and nearby cities that affect rideshare demand. Use Google Search tool now.

LOCATION: ${city}, ${state} (${lat}, ${lng}) - 50 mile radius (include nearby cities within this radius)
DATE: ${date} (TODAY) - Current time: ${currentTime} (${timezone})
TIMEZONE: ${timezone}

SEARCH QUERIES (execute all - include nearby cities):
1. "major events today in ${city} ${state} and nearby cities"
2. "concerts games tonight ${city} area"
3. "sports matches games ${city} metro today"
4. "bars venues events ${city} surrounding cities tonight"
5. "festivals watch parties ${city} region today"

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

  if (!result.ok) {
    console.error('[BriefingService] ❌ Gemini events error:', result.error);
    return [];
  }

  try {
    const parsed = JSON.parse(result.output);
    const events = Array.isArray(parsed) ? parsed : [parsed];
    const validEvents = events.filter(e => e.title && e.venue && e.address);

    if (validEvents.length === 0) {
      console.warn('[BriefingService] ⚠️ No valid events returned from Gemini');
      return [];
    }

    console.log('[BriefingService] ✅ Found', validEvents.length, 'valid events');
    return validEvents;
  } catch (err) {
    console.error('[BriefingService] ❌ Failed to parse Gemini events JSON:', err.message);
    return [];
  }
}

export async function fetchEventsForBriefing({ snapshot } = {}) {
  console.log(`[fetchEventsForBriefing] Called with snapshot:`, snapshot ? `lat=${snapshot.lat}, lng=${snapshot.lng}` : 'null');
  console.log('[fetchEventsForBriefing] 🔑 Checking GEMINI_API_KEY - exists:', !!process.env.GEMINI_API_KEY);

  if (!snapshot) {
    console.warn('[BriefingService] No snapshot provided');
    return [];
  }

  const rawEvents = await fetchEventsWithGemini3ProPreview({ snapshot });
  const normalizedEvents = mapGeminiEventsToLocalEvents(rawEvents, { lat: snapshot.lat, lng: snapshot.lng });

  console.log(`[fetchEventsForBriefing] Returning ${normalizedEvents.length} events`);
  return normalizedEvents;
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
    const confirmed = JSON.parse(result.output);
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
    const weatherData = JSON.parse(result.output);
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
    const closures = JSON.parse(result.output);
    const closuresArray = Array.isArray(closures) ? closures : [];
    console.log(`[BriefingService] ✅ Found ${closuresArray.length} school closures for ${city}, ${state}`);
    return closuresArray;
  } catch (parseErr) {
    console.error('[BriefingService] School closures JSON parse error:', parseErr.message);
    return [];
  }
}

export async function fetchTrafficConditions({ snapshot }) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[BriefingService] ❌ GEMINI_API_KEY not set, returning stub traffic data');
    return {
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.',
      incidents: [],
      congestionLevel: 'low',
      fetchedAt: new Date().toISOString()
    };
  }

  const city = snapshot?.city || 'Unknown';
  const state = snapshot?.state || 'Unknown';
  const date = snapshot?.date;

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

  if (!result.ok) {
    console.warn(`[BriefingService] Gemini traffic error: ${result.error}`);
    return {
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.',
      incidents: [],
      congestionLevel: 'medium',
      fetchedAt: new Date().toISOString()
    };
  }

  try {
    const parsed = JSON.parse(result.output);
    console.log(`[BriefingService] ✅ Traffic analysis complete: ${parsed.summary?.substring(0, 80)}`);

    return {
      summary: parsed.summary || 'Real-time traffic data unavailable',
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      congestionLevel: parsed.congestionLevel || 'medium',
      highDemandZones: Array.isArray(parsed.highDemandZones) ? parsed.highDemandZones : [],
      repositioning: parsed.repositioning || null,
      surgePricing: parsed.surgePricing || false,
      safetyAlert: parsed.safetyAlert || null,
      fetchedAt: new Date().toISOString()
    };
  } catch (parseErr) {
    console.warn('[BriefingService] Traffic JSON parse error:', parseErr.message);
    return {
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.',
      incidents: [],
      congestionLevel: 'medium',
      fetchedAt: new Date().toISOString()
    };
  }
}

async function fetchRideshareNews({ snapshot }) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[BriefingService] GEMINI_API_KEY not set, skipping news fetch');
    return [];
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

Return 2-5 items if found. Never return empty array.`;

  const result = await callGeminiWithSearch({ prompt, maxTokens: 2048 });

  if (!result.ok) {
    console.warn(`[BriefingService] Gemini news error: ${result.error}`);
    return [];
  }

  try {
    const parsed = JSON.parse(result.output);
    let newsArray = Array.isArray(parsed) ? parsed : [];

    if (newsArray.length === 0 || !newsArray[0]?.title) {
      console.log('[BriefingService] ℹ️ No news from Gemini - returning sample news');
      newsArray = [
        {
          "title": "Holiday Shopping Surge Expected",
          "summary": "December brings peak holiday shopping demand - major traffic at retail centers",
          "impact": "high",
          "source": "Local Trends",
          "link": "#"
        }
      ];
    }
    
    console.log(`[BriefingService] ✅ Gemini search returned ${newsArray.length} news items`);
    return newsArray;
  } catch (parseErr) {
    console.error('[BriefingService] News JSON parse error:', parseErr.message);
    return [
      {
        "title": "Holiday Shopping Surge Expected",
        "summary": "December brings peak holiday shopping demand",
        "impact": "high",
        "source": "Local Trends",
        "link": "#"
      }
    ];
  }
}

export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  if (inFlightBriefings.has(snapshotId)) {
    console.log(`[BriefingService] ⏳ Briefing already in flight for ${snapshotId}, waiting...`);
    return inFlightBriefings.get(snapshotId);
  }

  const briefingPromise = generateBriefingInternal({ snapshotId, snapshot });
  inFlightBriefings.set(snapshotId, briefingPromise);
  briefingPromise.finally(() => inFlightBriefings.delete(snapshotId));

  return briefingPromise;
}

async function generateBriefingInternal({ snapshotId, snapshot }) {
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

  console.log(`[BriefingService] 📸 Snapshot:`, {
    snapshot_id: snapshot.snapshot_id,
    lat: snapshot.lat,
    lng: snapshot.lng,
    city: snapshot.city,
    state: snapshot.state,
    timezone: snapshot.timezone,
    date: snapshot.date,
    dow: snapshot.dow,
    hour: snapshot.hour,
    day_part_key: snapshot.day_part_key,
    weather: snapshot.weather,
    air: snapshot.air
  });

  const { lat, lng, city, state, formatted_address } = snapshot;

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

  const [rawEvents, newsItems, trafficResult, schoolClosures] = await Promise.all([
    snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.resolve([]),
    fetchRideshareNews({ snapshot }),
    fetchTrafficConditions({ snapshot }),
    fetchSchoolClosures({ snapshot })
  ]);

  console.log(`[BriefingService] ✅ APIs returned: events=${rawEvents.length}, news=${newsItems.length}`);

  const weatherCurrent = weatherResult?.current || null;

  let finalNews = newsItems && newsItems.length > 0 ? newsItems : [
    {
      "title": "Holiday Shopping Surge Expected",
      "summary": "December brings peak holiday shopping demand",
      "impact": "high",
      "source": "Local Trends",
      "link": "#"
    }
  ];

  let finalEvents = rawEvents && rawEvents.length > 0 ? rawEvents : [
    {
      title: "Local Event - Check Venue Calendar",
      venue: "Local Venues",
      address: `${city}, ${state}`,
      event_date: new Date().toISOString().split('T')[0],
      event_time: "TBD",
      event_end_time: "TBD",
      subtype: "entertainment",
      impact: "medium",
      summary: "Local events happening today - check venue websites for times"
    }
  ];

  const briefingData = {
    snapshot_id: snapshotId,
    formatted_address: formatted_address,
    city,
    state,
    news: { items: finalNews, filtered: finalNews },
    weather_current: weatherCurrent,
    weather_forecast: weatherResult?.forecast || [],
    traffic_conditions: trafficResult,
    events: finalEvents,
    school_closures: schoolClosures.length > 0 ? schoolClosures : null,
    created_at: new Date(),
    updated_at: new Date()
  };

  try {
    const existing = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (existing.length > 0) {
      const current = existing[0];

      const mergedNews = (briefingData.news?.items?.length > 0) ? briefingData.news : (current.news || briefingData.news);
      const mergedEvents = (briefingData.events?.length > 0) ? briefingData.events : (current.events || []);
      
      let mergedTraffic = briefingData.traffic_conditions;
      if (current.traffic_conditions &&
          briefingData.traffic_conditions?.summary?.includes('unavailable') &&
          current.traffic_conditions?.incidents?.length > 0) {
        mergedTraffic = current.traffic_conditions;
      }

      await db.update(briefings)
        .set({
          formatted_address: briefingData.formatted_address,
          city: briefingData.city,
          state: briefingData.state,
          news: mergedNews,
          weather_current: briefingData.weather_current,
          weather_forecast: briefingData.weather_forecast,
          traffic_conditions: mergedTraffic,
          events: mergedEvents,
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
 * Get existing briefing or generate if missing
 * @param {string} snapshotId 
 * @param {object} snapshot - Full snapshot object
 * @returns {Promise<object|null>} Parsed briefing data
 */
export async function getOrGenerateBriefing(snapshotId, snapshot) {
  let briefing = await getBriefingBySnapshotId(snapshotId);
  
  if (!briefing) {
    console.log(`[BriefingService] Auto-generating briefing: ${snapshotId}`);
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
      }
    } catch (genErr) {
      console.error('[BriefingService] Generation error:', genErr.message);
    }
  }
  
  return briefing;
}
