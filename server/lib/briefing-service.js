import { db } from '../db/drizzle.js';
import { briefings, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

// Briefing Service Architecture:
// ================================
// This service generates and stores briefings linked to snapshots (snapshot_id).
// Snapshots serve as the central connector across all data sources for ML purposes:
// - Each briefing is uniquely tied to a snapshot's point-in-time context
// - Location data (lat/lng/city/state) is resolved from snapshot + fallback to user location
// - All API calls (weather, traffic, news) are logged with snapshot_id for training data
// - This enables full traceability and supervised learning on driver behavior patterns

// Google APIs: Split keys based on API requirements
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Places, Geocoding, Weather, Routes, etc.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Generative Language API (requires separate project)

// Zod validation schema for local events
const LocalEventSchema = z.object({
  title: z.string().describe('Event name'),
  summary: z.string().describe('One sentence event description with driver impact'),
  impact: z.enum(['high', 'medium', 'low']).describe('Impact level on rideshare demand/routing'),
  source: z.string().describe('Event source/discovery method'),
  event_type: z.enum(['concert', 'game', 'comedy', 'live_music', 'festival', 'sports', 'performance', 'other']).optional(),
  latitude: z.number().optional().describe('Event latitude coordinate'),
  longitude: z.number().optional().describe('Event longitude coordinate'),
  distance_miles: z.number().optional().describe('Distance from user location in miles'),
  event_date: z.string().optional().describe('Event date/time in ISO format'),
  event_time: z.string().optional().describe('Event start time (e.g., 7:00 PM)'),
  location: z.string().optional().describe('Event venue name and address'),
  link: z.string().optional().describe('Source link or ticket link'),
  staging_area: z.string().optional().describe('Recommended staging/pickup area for rideshare drivers'),
  place_id: z.string().optional().describe('Google Places ID for detailed venue info'),
});

const LocalEventsArraySchema = z.array(LocalEventSchema);

// Map raw Gemini 3 Pro events into our LocalEventSchema so the UI can use them
function mapGeminiEventsToLocalEvents(rawEvents, { lat, lng }) {
  if (!Array.isArray(rawEvents)) return [];

  const mapped = rawEvents.map((e, idx) => {
    const subtype = (e.subtype || '').toLowerCase();
    const type = (e.type || '').toLowerCase();

    // Decide event_type used by the UI
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

    const location =
      e.venue && e.address
        ? `${e.venue}, ${e.address}`
        : e.venue || e.address || undefined;

    const timeLabel =
      e.event_date && e.event_time
        ? `${e.event_date} ${e.event_time}`
        : e.event_date || e.event_time || '';

    // Simple one-line summary for the UI
    const summaryParts = [
      e.title,
      e.venue || null,
      timeLabel || null,
      e.impact ? `Impact: ${e.impact}` : null,
    ].filter(Boolean);

    const summary =
      summaryParts.join(' • ') ||
      `Local event ${idx + 1}`;

    // Derive staging_area from recommended_driver_action when it's a reposition hint
    let staging_area;
    if (typeof e.recommended_driver_action === 'string' &&
        e.recommended_driver_action.startsWith('reposition_to:')) {
      staging_area = e.recommended_driver_action
        .split(':')[1]
        .replace(/_/g, ' ')
        .trim();
    }

    return {
      title: e.title || `Event ${idx + 1}`,
      summary,
      impact: (e.impact === 'high' || e.impact === 'low') ? e.impact : 'medium',
      source: e.source || 'Gemini Web Search',
      event_type,
      latitude: e.latitude ?? undefined,
      longitude: e.longitude ?? undefined,
      distance_miles: typeof e.estimated_distance_miles === 'number'
        ? e.estimated_distance_miles
        : undefined,
      event_date: e.event_date,
      event_time: e.event_time,
      location,
      link: e.source,
      staging_area,
    };
  });

  // Validate against schema, but don't crash if there are issues
  const validated = LocalEventsArraySchema.safeParse(mapped);
  if (!validated.success) {
    console.warn('[BriefingService] mapGeminiEventsToLocalEvents validation errors:', validated.error.issues);
    return mapped; // return best-effort anyway
  }

  return validated.data;
}

export async function fetchEventsForBriefing({ snapshot } = {}) {
  console.log(`[fetchEventsForBriefing] Called with snapshot:`, snapshot ? `lat=${snapshot.lat}, lng=${snapshot.lng}, tz=${snapshot.timezone}, date=${snapshot.date}` : 'null');
  
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] Gemini API key not configured');
    return [];
  }

  if (!snapshot) {
    console.warn('[BriefingService] No snapshot provided');
    return [];
  }

  try {
    // Use Gemini 3 Pro Preview with web search for event discovery
    const events = await fetchEventsWithGemini3ProPreview({
      lat: snapshot.lat,
      lng: snapshot.lng,
      timezone: snapshot.timezone,
      date: snapshot.date
    });
    
    console.log(`[fetchEventsForBriefing] Returning ${events.length} events`);
    return events || [];
  } catch (error) {
    console.error('[BriefingService] Event discovery error:', error.message, error.stack);
    return [];
  }
}

function buildEventsPrompt({ lat, lng, date, timezone }) {
  return `
You are an event finder agent. Use live web search (Google Search tool).

Assume:
- location = (${lat}, ${lng})
- radius = 50 miles
- date = ${date}
- timezone = ${timezone}

Find any events on that date within the radius. Events include:
- concerts
- sporting games
- watch-parties
- festivals
- road-closures
- special local events
- anything likely to affect rideshare demand or routing.

Return exactly ONE JSON array (no explanation, no markdown).
Each item in the array should include as many of these fields as you can discover:

- title
- venue
- address (if available)
- event_date (YYYY-MM-DD)
- event_time (HH:MM local, if available)
- type — one of: demand_event, road_closure, other
- subtype — optional; if known, a more detailed category (concert, sports, watch_party, festival, parade, theater, etc.)
- estimated_distance_miles — approximate distance from (${lat}, ${lng}), rounded to one decimal (if you can estimate)
- impact — high / medium / low (if you can estimate)
- recommended_driver_action — go_now / avoid_area / reposition_to:<area> / wait (if you can estimate)
- confidence — high / medium / low (if you can estimate)

If a field is missing because you couldn't find it, you may omit that field.
But include the event if at least "title" is present.

Important formatting rules:
- Output ONLY a valid JSON array. No backticks, no \`\`\`json fences, no extra text.
- Do NOT output any internal metadata, IDs, reasoning tokens, or debug info.
`.trim();
}

async function fetchEventsWithGemini3ProPreview({ lat, lng, timezone, date }) {
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] GEMINI_API_KEY is not set; skipping events lookup.');
    return [];
  }

  const prompt = buildEventsPrompt({ lat, lng, date, timezone });

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      topK: 40
    }
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify(body)
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[BriefingService] Gemini events API error:', res.status, errText.substring(0, 200));
      return [];
    }

    const data = await res.json();

    let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

    // Strip accidental ```json fences if the model still adds them
    rawText = rawText
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();

    // If there's extra junk, try to grab the first JSON array substring
    let jsonToParse = rawText;
    if (!rawText.trim().startsWith('[')) {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) {
        jsonToParse = match[0];
      }
    }

    try {
      const parsed = JSON.parse(jsonToParse);
      const result = Array.isArray(parsed) ? parsed : [parsed];
      console.log(`[BriefingService] ✅ Found ${result.length} events from Gemini`);
      return result;
    } catch (err) {
      console.error('[BriefingService] Failed to parse Gemini events JSON:', err.message, 'rawText:', rawText.substring(0, 300));
      return [];
    }
  } catch (error) {
    console.error('[BriefingService] Event discovery error:', error.message);
    return [];
  }
}

// Enhance events with Google Places API data (address, staging area)
async function enhanceEventsWithPlacesAPI(events, userLat, userLng) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[BriefingService] Google Maps API key not configured, skipping Places enhancement');
    return events;
  }

  const enhanced = [];
  
  for (const event of events) {
    try {
      // Search for venue in Google Places
      const searchQuery = encodeURIComponent(event.location || event.title);
      const placesResponse = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}&key=${GOOGLE_MAPS_API_KEY}`
      );

      if (placesResponse.ok) {
        const placesData = await placesResponse.json();
        const place = placesData.results?.[0];

        if (place) {
          // Get detailed place info including address and staging recommendations
          const detailsResponse = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_address,name,business_status&key=${GOOGLE_MAPS_API_KEY}`
          );

          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const placeDetails = detailsData.result;

            // Generate staging area recommendation based on venue type and location
            let stagingArea = event.location;
            if (placeDetails.formatted_address) {
              stagingArea = placeDetails.formatted_address;
            }

            enhanced.push({
              ...event,
              location: placeDetails.formatted_address || event.location,
              place_id: place.place_id,
              staging_area: `Recommended staging: ${stagingArea}. Confirm exact pickup location with rider.`,
              latitude: place.geometry?.location?.lat || event.latitude,
              longitude: place.geometry?.location?.lng || event.longitude
            });
          } else {
            enhanced.push({ ...event, place_id: place.place_id });
          }
        } else {
          enhanced.push(event);
        }
      } else {
        enhanced.push(event);
      }
    } catch (error) {
      console.warn(`[BriefingService] Places API error for ${event.title}:`, error.message);
      enhanced.push(event);
    }
  }

  return enhanced;
}

async function fetchEventsFromSerpAPI(city, state, lat, lng) {
  try {
    // Try Google Events engine first (structured event listings)
    const searchQuery = encodeURIComponent(`games concerts live music comedy shows performances ${city}`);
    let url = `https://serpapi.com/search.json?engine=google_events&q=${searchQuery}&location=${city},${state}&gl=us&api_key=${SERP_API_KEY}`;
    
    let response = await fetch(url);
    if (!response.ok) throw new Error(`SerpAPI events ${response.status}`);
    
    let data = await response.json();
    let results = data.events_results || [];
    
    // Fallback to Google News if no events found
    if (results.length === 0) {
      console.log('[BriefingService] No google_events results, trying news fallback');
      url = `https://serpapi.com/search.json?engine=google&q=${searchQuery}&tbm=nws&tbs=qdr:d&api_key=${SERP_API_KEY}`;
      response = await fetch(url);
      if (!response.ok) throw new Error(`SerpAPI news ${response.status}`);
      
      data = await response.json();
      results = data.news_results || [];
      
      if (results.length === 0) return { items: [], filtered: [] };
      
      const items = results.slice(0, 8).map(item => ({
        title: item.title,
        source: item.source,
        date: item.date || item.published_at,
        link: item.link,
        snippet: item.snippet
      }));
      
      const filtered = await convertNewsToEvents(items, city, state, lat, lng);
      return { items, filtered };
    }
    
    // Convert events to our schema
    const items = results.slice(0, 8).map(event => ({
      title: event.title || event.name,
      location: event.address || event.location,
      event_date: event.date,
      event_time: event.start_time,
      link: event.link,
      source: 'SerpAPI Events'
    }));
    
    const filtered = await convertNewsToEvents(items, city, state, lat, lng);
    return { items, filtered };
  } catch (error) {
    console.error('[BriefingService] SerpAPI error:', error.message);
    return { items: [], filtered: [] };
  }
}

async function fetchEventsFromNewsAPI(city, state, lat, lng) {
  try {
    const q = encodeURIComponent(`games concerts live music comedy shows performances`);
    // ✅ Optimal parameters: sortBy=publishedAt (most recent), searchIn deep search, today's articles
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&searchIn=title,description&language=en&pageSize=10&apiKey=${NEWS_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NewsAPI ${response.status}`);
    
    const data = await response.json();
    const articles = data.articles || [];
    
    if (articles.length === 0) return [];
    
    // Filter for articles from last 24 hours
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    return articles
      .filter(article => new Date(article.publishedAt) >= oneDayAgo)
      .map((article, idx) => ({
        title: article.title,
        summary: article.description || article.title,
        impact: 'medium',
        source: 'NewsAPI',
        event_type: 'performance',
        latitude: lat,
        longitude: lng,
        distance_miles: 0,
        event_date: article.publishedAt,
        link: article.url
      }));
  } catch (error) {
    console.error('[BriefingService] NewsAPI error:', error.message);
    return [];
  }
}

async function convertNewsToEvents(newsItems, city, state, lat, lng) {
  // Placeholder - would use Gemini to geocode and structure news as events
  return newsItems.map((item, idx) => ({
    title: item.title,
    summary: `Event coverage: ${item.snippet?.substring(0, 60) || item.title}`,
    impact: 'medium',
    source: item.source,
    event_type: 'other',
    latitude: lat,
    longitude: lng,
    distance_miles: 0,
    event_date: item.date,
    link: item.link
  }));
}

// Confirm TBD event details using Gemini 3.0 Pro (with fallback to 2.5 Pro)
export async function confirmTBDEventDetails(events) {
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] Gemini API key not configured, skipping TBD confirmation');
    return events;
  }

  // Filter events with TBD details
  const tbdEvents = events.filter(e => 
    e.location?.includes('TBD') || 
    e.event_time?.includes('TBD') || 
    e.location === 'TBD'
  );

  if (tbdEvents.length === 0) {
    return events; // No TBD events to confirm
  }

  console.log(`[BriefingService] Found ${tbdEvents.length} events with TBD details, confirming with Gemini 3.0 Pro...`);

  try {
    // Build prompt for Gemini to confirm event details
    const eventDetails = tbdEvents.map(e => 
      `- Title: "${e.title}"\n  Summary: "${e.summary}"\n  Location: "${e.location || 'TBD'}"\n  Time: "${e.event_time || 'TBD'}"`
    ).join('\n\n');

    const prompt = `You are an event information specialist. Review these events that have incomplete venue/time data and provide the most likely real-world details based on the title and context.

Events with TBD details:
${eventDetails}

For each event, provide ONLY a JSON object (no explanations) with:
{
  "title": "exact event name",
  "confirmed_venue": "full venue name and address or 'Unable to confirm'",
  "confirmed_time": "start time like '7:00 PM' or 'Unable to confirm'",
  "confidence": "high/medium/low"
}

Return a JSON array with one object per event. If you cannot confirm details, set to 'Unable to confirm'.`;

    // Try Gemini 3.0 Pro first (with 15s timeout)
    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 16000
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      console.log('[BriefingService] ✅ Gemini 3.0 Pro responded');
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[BriefingService] Gemini 3.0 Pro timeout, falling back to 2.5 Pro...');
      }
      // Fallback to Gemini 3 Pro Preview
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000
          }
        })
      });
      console.log('[BriefingService] Using Gemini 3 Pro Preview for TBD confirmation');
    }

    if (!response.ok) {
      console.error(`[BriefingService] Gemini API error: ${response.status}`);
      return events;
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('[BriefingService] No JSON array found in Gemini response');
        return events;
      }

      const confirmed = JSON.parse(jsonMatch[0]);
      console.log(`[BriefingService] ✅ Gemini confirmed ${confirmed.length} events`);

      // Merge confirmed details back into events
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
  } catch (error) {
    console.error('[BriefingService] Gemini confirmation error:', error.message);
    return events; // Return unconfirmed events as fallback
  }
}

async function filterNewsWithGemini(newsItems, city, state, country, lat, lng) {
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] GEMINI_API_KEY not set, returning all news');
    return newsItems.map(n => ({
      title: n.title,
      summary: n.snippet || n.title,
      impact: 'medium',
      source: n.source,
      link: n.link
    }));
  }

  try {
    if (!newsItems || newsItems.length === 0) {
      console.warn('[BriefingService] No news items to filter');
      return [];
    }

    const newsText = newsItems.map((n, i) => 
      `${i + 1}. ${n.title} (${n.source}, ${n.date})\n${n.snippet || ''}`
    ).join('\n\n');

    const prompt = `You are a rideshare driver intelligence system. Analyze TODAY'S news for ${city}, ${state}, ${country} and identify what matters for rideshare drivers.

USER LOCATION: ${lat}, ${lng}

NEWS DATA:
${newsText}

INSTRUCTIONS:
1. **FILTER TO TODAY ONLY**: Exclude past events or historical news. Only include events happening TODAY.
2. **50-MILE RADIUS**: Filter events to within 50 miles of coordinates (${lat}, ${lng}). Include distance in miles if available.
3. **FOCUS ON**: 
   - Road closures caused by events (protests, accidents, construction)
   - Demand-driving events: concerts, games, parades, conferences, festivals (TODAY only)
   - Policy changes affecting airport pickups or rideshare regulations
   - Major traffic incidents blocking major roads
4. **FOR EACH EVENT**: Provide actionable driver insight and include coordinates if available.
5. **RETURN ONLY valid JSON array** (no markdown, no explanation, no extra text)

RESPONSE FORMAT:
[
  {
    "title": "headline here",
    "summary": "one sentence actionable insight for drivers",
    "impact": "high" or "medium" or "low",
    "source": "news source name",
    "event_type": "road_closure" | "demand_event" | "policy_change" | "accident" | "other",
    "latitude": null,
    "longitude": null,
    "distance_miles": null,
    "event_date": "2025-12-01T00:00:00Z",
    "link": "source URL if available"
  }
]

If no relevant items, return: []`;

    console.log(`[BriefingService] ===== CALLING GEMINI FOR ${city}, ${state}, ${country} =====`);
    console.log(`[BriefingService] News items to filter: ${newsItems.length}`);
    console.log(`[BriefingService] First item: ${newsItems[0]?.title.substring(0, 80) || 'N/A'}`);
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048, topP: 1 }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errData}`);
    }

    const data = await response.json();
    console.log(`[BriefingService] Gemini raw response:`, JSON.stringify(data).substring(0, 300));
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    console.log(`[BriefingService] Gemini text response length: ${text.length}`);
    console.log(`[BriefingService] Gemini text (first 300 chars): ${text.substring(0, 300)}`);
    
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate against schema
        const validatedResult = RideshareNewsArraySchema.safeParse(parsed);
        
        if (!validatedResult.success) {
          console.warn('[BriefingService] Validation errors:', validatedResult.error.issues);
          // Return parsed data even if validation fails, but log the issues
          return parsed.slice(0, 10);
        }
        
        const filtered = validatedResult.data;
        console.log('[BriefingService] Validated and filtered to', filtered.length, 'news items');
        return filtered;
      }
    } catch (parseErr) {
      console.error('[BriefingService] JSON parse error:', parseErr, 'text:', text.substring(0, 200));
    }
    
    return [];
  } catch (error) {
    console.error('[BriefingService] Gemini filter error:', error);
    // Fallback: return unfiltered as structured items
    return newsItems.slice(0, 3).map(n => ({
      title: n.title,
      summary: n.snippet || n.title,
      impact: 'medium',
      source: n.source,
      link: n.link
    }));
  }
}

export async function fetchWeatherConditions({ lat, lng }) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[BriefingService] GOOGLE_MAPS_API_KEY not set, skipping weather fetch');
    return { current: null, forecast: [], error: 'GOOGLE_MAPS_API_KEY not configured' };
  }

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_MAPS_API_KEY}`),
      fetch(`https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=6&key=${GOOGLE_MAPS_API_KEY}`)
    ]);

    let current = null;
    let forecast = [];

    if (currentRes.ok) {
      const currentData = await currentRes.json();
      // Google Weather API returns Celsius - convert to Fahrenheit
      const tempF = currentData.temperature ? Math.round((currentData.temperature * 9/5) + 32) : null;
      const feelsLikeF = currentData.feelsLikeTemperature ? Math.round((currentData.feelsLikeTemperature * 9/5) + 32) : null;
      
      current = {
        temperature: tempF,
        tempF: tempF,
        feelsLike: feelsLikeF,
        conditions: currentData.weatherCondition?.description?.text,
        conditionType: currentData.weatherCondition?.type,
        humidity: currentData.relativeHumidity,
        windSpeed: currentData.wind?.speed,
        windDirection: currentData.wind?.direction?.cardinal,
        uvIndex: currentData.uvIndex,
        precipitation: currentData.precipitation,
        visibility: currentData.visibility,
        isDaytime: currentData.isDaytime,
        observedAt: currentData.currentTime
      };
    }

    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      forecast = (forecastData.forecastHours || []).map((hour, idx) => {
        // Google Weather API returns Celsius - convert to Fahrenheit
        const tempF = hour.temperature ? Math.round((hour.temperature * 9/5) + 32) : null;
        
        // Ensure time is a valid ISO string - use displayDateTime if valid, otherwise generate from current time
        let timeValue = hour.displayDateTime;
        if (!timeValue || isNaN(new Date(timeValue).getTime())) {
          // If displayDateTime is invalid, generate forecast time by adding hours to current time
          const forecastTime = new Date();
          forecastTime.setHours(forecastTime.getHours() + idx);
          timeValue = forecastTime.toISOString();
        }
        
        return {
          time: timeValue,
          temperature: tempF,
          tempF: tempF,
          conditions: hour.weatherCondition?.description?.text,
          conditionType: hour.weatherCondition?.type,
          precipitationProbability: hour.precipitation?.probability?.percent,
          windSpeed: hour.wind?.speed,
          isDaytime: hour.isDaytime
        };
      });
    }

    return {
      current,
      forecast,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[BriefingService] Weather fetch error:', error);
    return { current: null, forecast: [], error: error.message };
  }
}

export async function fetchSchoolClosures({ city, state, lat, lng }) {
  if (!GEMINI_API_KEY) {
    console.log('[BriefingService] Skipping school closures (no Gemini API key)');
    return [];
  }

  try {
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
]

RESPOND WITH ONLY VALID JSON ARRAY - NO EXPLANATION:`;

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('School closures timeout')), 120000)
    );

    const responsePromise = fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    if (!response.ok) {
      console.warn(`[BriefingService] School closures fetch failed (${response.status})`);
      return [];
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[BriefingService] Could not parse school closures response');
      return [];
    }

    const closures = JSON.parse(jsonMatch[0]);
    console.log(`[BriefingService] ✅ Found ${closures.length} school closures for ${city}, ${state}`);
    return closures;
  } catch (error) {
    console.error('[BriefingService] School closures fetch error:', error.message);
    return [];
  }
}

export async function fetchTrafficConditions({ lat, lng, city, state }) {
  try {
    // Import traffic intelligence from venue service
    const { getTrafficIntelligence } = await import('./venue-intelligence.js');
    
    // Add timeout to prevent hanging requests (120s max for Gemini)
    console.log('[BriefingService] 🚗 Starting traffic fetch for', city, state);
    const trafficPromise = getTrafficIntelligence({ lat, lng, city, state });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Traffic API timeout after 120s')), 120000)
    );
    
    let trafficIntel;
    try {
      console.log('[BriefingService] ⏳ Waiting for traffic intelligence...');
      const startTime = Date.now();
      trafficIntel = await Promise.race([trafficPromise, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`[BriefingService] ✅ Traffic intelligence received in ${duration}ms:`, trafficIntel?.density_level);
    } catch (timeoutErr) {
      const duration = Date.now() - startTime;
      console.warn(`[BriefingService] ⚠️ Traffic fetch failed after ${duration}ms:`, timeoutErr.message);
      // Return stub data on timeout instead of erroring
      trafficIntel = {
        density_level: 'medium',
        driver_advice: 'Real-time traffic data unavailable. Check Google Maps for current conditions.',
        congestion_areas: [],
        high_demand_zones: []
      };
    }
    
    // Convert venue traffic format to briefing format
    const incidents = (trafficIntel.congestion_areas || [])
      .filter(area => area && area.area && area.reason)
      .slice(0, 5) // Limit to 5 incidents
      .map(area => ({
        description: `${area.area}: ${area.reason}`,
        severity: area.severity > 7 ? 'high' : area.severity > 4 ? 'medium' : 'low'
      }));
    
    const summary = trafficIntel.driver_advice || 'No significant traffic issues';
    const congestionLevel = trafficIntel.density_level || 'low';
    
    return {
      summary,
      incidents,
      congestionLevel,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[BriefingService] Traffic fetch error:', error.message);
    // Return safe stub data on any error - don't break the briefing
    return { 
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.', 
      incidents: [], 
      congestionLevel: 'low',
      fetchedAt: new Date().toISOString()
    };
  }
}

export async function generateAndStoreBriefing({ snapshotId, lat, lng, city, state, formattedAddress, country = 'US' }) {
  console.log(`[BriefingService] Generating briefing for ${city}, ${state}, ${country} (${lat}, ${lng})`);
  
  // Fetch the full snapshot to get timezone and date for events discovery
  let snapshot = null;
  try {
    const snapshotResult = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (snapshotResult.length > 0) {
      snapshot = snapshotResult[0];
      console.log(`[BriefingService] ✅ Fetched snapshot: lat=${snapshot.lat}, lng=${snapshot.lng}, timezone=${snapshot.timezone}, date=${snapshot.date}`);
    } else {
      console.warn(`[BriefingService] ⚠️ Snapshot ${snapshotId} not found in DB`);
    }
  } catch (err) {
    console.warn('[BriefingService] Could not fetch snapshot for events discovery:', err.message);
  }

  // Fetch all briefing components in parallel
  console.log(`[BriefingService] 🔍 Fetching events... snapshot=${!!snapshot}`);
  const [rawEvents, weatherResult, trafficResult, schoolClosures] = await Promise.all([
    snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.resolve([]),
    fetchWeatherConditions({ lat, lng }),
    fetchTrafficConditions({ lat, lng, city, state }),
    fetchSchoolClosures({ city, state, lat, lng })
  ]);
  console.log(`[BriefingService] ✅ Events fetched from Gemini: ${rawEvents.length} raw events`);

  // 1) Normalize Gemini output into LocalEventSchema
  let normalizedEvents = mapGeminiEventsToLocalEvents(rawEvents, { lat, lng });

  // 2) Optionally enhance with Google Places (if key configured)
  try {
    normalizedEvents = await enhanceEventsWithPlacesAPI(normalizedEvents, lat, lng);
    console.log(`[BriefingService] ✅ Events enhanced with Places API: ${normalizedEvents.length}`);
  } catch (err) {
    console.warn('[BriefingService] Places enhancement failed, using normalized events only:', err.message);
  }

  const briefingData = {
    snapshot_id: snapshotId,
    formatted_address: formattedAddress,
    city,
    state,
    news: { items: [], filtered: [] },
    weather_current: weatherResult.current,
    weather_forecast: weatherResult.forecast,
    traffic_conditions: trafficResult,
    events: normalizedEvents || [],
    school_closures: schoolClosures.length > 0 ? schoolClosures : null,
    created_at: new Date(),
    updated_at: new Date()
  };

  try {
    const existing = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    if (existing.length > 0) {
      await db.update(briefings)
        .set({
          formatted_address: briefingData.formatted_address,
          city: briefingData.city,
          state: briefingData.state,
          news: briefingData.news,
          weather_current: briefingData.weather_current,
          weather_forecast: briefingData.weather_forecast,
          traffic_conditions: briefingData.traffic_conditions,
          events: briefingData.events,
          school_closures: briefingData.school_closures,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
      console.log(`[BriefingService] Updated existing briefing for snapshot ${snapshotId}`);
    } else {
      await db.insert(briefings).values(briefingData);
      console.log(`[BriefingService] Created new briefing for snapshot ${snapshotId}`);
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
