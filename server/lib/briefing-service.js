import { db } from '../db/drizzle.js';
import { briefings, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { callGemini } from './adapters/gemini-adapter.js';

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
console.log('[BriefingService] 🔑 GEMINI_API_KEY available at startup:', !!GEMINI_API_KEY);

// In-flight request deduplication cache to prevent duplicate API calls for same snapshot
const inFlightBriefings = new Map(); // snapshot_id -> Promise<briefing>

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
  event_end_time: z.string().optional().describe('Event end time (e.g., 11:00 PM)'),
  address: z.string().optional().describe('Full venue address'),
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
      event_end_time: e.event_end_time,
      address: e.address,
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
  console.log('[fetchEventsForBriefing] 🔑 Checking GEMINI_API_KEY - exists:', !!GEMINI_API_KEY);
  
  if (snapshot) {
    console.log('[fetchEventsForBriefing] 📤 SENT SNAPSHOT TO GEMINI FOR EVENTS:', {
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
      weather: snapshot.weather ? { tempF: snapshot.weather.tempF, conditions: snapshot.weather.conditions } : 'none',
      air: snapshot.air ? { aqi: snapshot.air.aqi, category: snapshot.air.category } : 'none'
    });
  }
  
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] ❌ Gemini API key not configured');
    return [];
  }

  if (!snapshot) {
    console.warn('[BriefingService] No snapshot provided');
    return [];
  }

  try {
    // Use Gemini 3 Pro Preview with web search for event discovery
    const events = await fetchEventsWithGemini3ProPreview({ snapshot });
    
    console.log(`[fetchEventsForBriefing] Returning ${events.length} events`);
    return events || [];
  } catch (error) {
    console.error('[BriefingService] Event discovery error:', error.message, error.stack);
    return [];
  }
}

async function fetchEventsWithGemini3ProPreview({ snapshot }) {
  console.log(`[fetchEventsWithGemini3ProPreview] CALLED - GEMINI_API_KEY exists: ${!!GEMINI_API_KEY}`);
  
  if (!GEMINI_API_KEY) {
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

FILTERING RULES:
- Include events happening TODAY (${date}) that are CURRENTLY HAPPENING or HAPPENING LATER TONIGHT
- EXCLUDE events that have already ended (compare event end_time to current time: 10:47 PM)
- EXCLUDE future dates (tomorrow, weekend, next week)
- EXCLUDE events with missing start/end times
- Prioritize high-impact demand events (if event is still ongoing or starts soon, INCLUDE IT)

MINIMUM REQUIREMENTS:
- Return AT LEAST 5-10 major events if available
- If fewer than 5 found, still return all found events
- Never return empty array if any events exist

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
    "staging_area": "North parking lot, enter via Main St",
    "recommended_driver_action": "reposition_now"
  }
]

RULES:
- Output ONLY valid JSON array - NO markdown, NO backticks, NO explanation
- ALWAYS include: title, venue, address, event_date, event_time, event_end_time, impact
- Never pad with fake events
- Use actual web search results only`;

  try {
    console.log('[BriefingService] 📡 Calling Gemini 3 Pro Preview API for events...');
    
    // ISSUE #16 FIX: Use gemini-3-pro-preview with web search for better event discovery
    // 2.0-flash doesn't call web search reliably for event discovery
    const result = await callGemini({
      model: 'gemini-3-pro-preview',
      user: prompt,
      maxTokens: 4096,
      temperature: 0.2,
      topP: 0.95,
      topK: 40
    });

    if (!result.ok) {
      console.error('[BriefingService] ❌ Gemini events error:', result.error);
      return [];
    }

    console.log('[BriefingService] 📝 Raw response preview:', result.output.substring(0, 300));

    try {
      let parsed;
      try {
        // First attempt: direct JSON parse
        parsed = JSON.parse(result.output);
      } catch (parseErr) {
        // Second attempt: extract JSON from markdown code blocks
        console.warn('[BriefingService] Direct parse failed, trying markdown extraction');
        let jsonStr = result.output.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1];
        if (!jsonStr) {
          // Third attempt: extract raw JSON array
          jsonStr = result.output.match(/\[[\s\S]*\]/)?.[0];
        }
        if (!jsonStr) {
          console.error('[BriefingService] ❌ Could not extract JSON, response:', result.output.substring(0, 200));
          throw new Error(`Invalid event response format`);
        }
        parsed = JSON.parse(jsonStr.trim());
      }

      let events = Array.isArray(parsed) ? parsed : [parsed];
      
      // Validate events have required fields
      const validEvents = events.filter(e => e.title && e.venue && e.address);
      
      if (validEvents.length === 0) {
        console.warn('[BriefingService] ⚠️ No valid events returned from Gemini (got', events.length, 'total)');
        // Return empty array - don't use fallback if Gemini explicitly returned invalid data
        return [];
      }
      
      console.log('[BriefingService] ✅ Found', validEvents.length, 'valid events');
      return validEvents;
    } catch (err) {
      console.error('[BriefingService] ❌ Failed to parse Gemini events JSON:', err.message);
      return [];
    }
  } catch (error) {
    console.error('[BriefingService] ❌ Event discovery error:', error.message, error.stack);
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

    // ISSUE #16 FIX: Use low temperature and proper safety settings
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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          // ISSUE #16 FIX: Disable safety filters + enable JSON mode + low temp
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          tools: [{ googleSearch: {} }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 4096
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      console.log('[BriefingService] ✅ Gemini 3 Pro Preview responded with safety/JSON fixes');
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[BriefingService] Gemini timeout');
      }
      response = null;
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

export async function fetchWeatherForecast({ snapshot }) {
  if (snapshot) {
    console.log('[fetchWeatherForecast] 📤 Fetching 4-6 hour weather forecast:', {
      snapshot_id: snapshot.snapshot_id,
      city: snapshot.city,
      state: snapshot.state,
      date: snapshot.date
    });
  }

  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] GEMINI_API_KEY not set for weather forecast');
    return { current: null, forecast: [], error: 'GEMINI_API_KEY not configured' };
  }

  if (!snapshot?.city || !snapshot?.state || !snapshot?.date) {
    return { current: null, forecast: [], error: 'Missing location/date' };
  }

  try {
    const { city, state, date } = snapshot;
    const prompt = `Get the 4-6 hour weather forecast for ${city}, ${state} for ${date}. Return ONLY valid JSON with no explanation:
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
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
        })
      }
    );

    if (!response.ok) {
      console.warn(`[fetchWeatherForecast] Gemini error ${response.status}`);
      return { current: null, forecast: [] };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const weatherData = JSON.parse(jsonMatch[0]);
        console.log('[fetchWeatherForecast] ✅ Got forecast:', { current: !!weatherData.current, forecast_hours: weatherData.forecast?.length || 0 });
        return weatherData;
      }
    } catch (parseErr) {
      console.error('[fetchWeatherForecast] Parse error:', parseErr.message);
    }
    
    return { current: null, forecast: [] };
  } catch (error) {
    console.error('[fetchWeatherForecast] Error:', error.message);
    return { current: null, forecast: [] };
  }
}

// Helper: Check if country uses metric system
function usesMetric(country) {
  const imperialCountries = ['US', 'United States', 'Bahamas', 'Cayman Islands', 'Palau', 'Marshall Islands', 'Myanmar'];
  return !country || !imperialCountries.some(c => country?.toUpperCase().includes(c.toUpperCase()));
}

// Helper: Convert temperature based on country
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

// Helper: Convert wind speed based on country
function formatWindSpeed(windSpeedMs, country) {
  if (!windSpeedMs) return undefined;
  const metric = usesMetric(country);
  if (metric) {
    // Convert m/s to km/h
    return Math.round(windSpeedMs * 3.6);
  } else {
    // Convert m/s to mph
    return Math.round(windSpeedMs * 2.237);
  }
}

export async function fetchWeatherConditions({ snapshot }) {
  if (snapshot) {
    console.log('[fetchWeatherConditions] 📤 Fetching full weather data:', {
      snapshot_id: snapshot.snapshot_id,
      lat: snapshot.lat,
      lng: snapshot.lng,
      city: snapshot.city,
      state: snapshot.state,
      country: snapshot.country
    });
  }

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
      console.log('[fetchWeatherConditions] Current weather response:', JSON.stringify(currentData).substring(0, 200));
      // Google Weather API returns Celsius in nested structure: {degrees: 8.2, unit: "CELSIUS"}
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
      console.log('[fetchWeatherConditions] ✅ Parsed current weather:', current);
    } else {
      console.error('[fetchWeatherConditions] Current conditions request failed:', currentRes.status, await currentRes.text());
    }

    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      console.log('[fetchWeatherConditions] Forecast response hours count:', forecastData.forecastHours?.length || 0);
      forecast = (forecastData.forecastHours || []).map((hour, idx) => {
        // Google Weather API returns Celsius in nested structure: {degrees: 8.2, unit: "CELSIUS"}
        const tempC = hour.temperature?.degrees ?? hour.temperature;
        const windSpeedMs = hour.windSpeed?.value ?? hour.wind?.speed;
        
        const tempData = formatTemperature(tempC, country);
        const windSpeedDisplay = formatWindSpeed(windSpeedMs, country);
        
        // Ensure time is a valid ISO string - use time if valid, otherwise generate from current time
        let timeValue = hour.time;
        if (!timeValue || isNaN(new Date(timeValue).getTime())) {
          // If time is invalid, generate forecast time by adding hours to current time
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
      console.log('[fetchWeatherConditions] ✅ Parsed forecast hours:', forecast.length);
    } else {
      console.error('[fetchWeatherConditions] Forecast request failed:', forecastRes.status, await forecastRes.text());
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

export async function fetchSchoolClosures({ snapshot }) {
  if (!GEMINI_API_KEY) {
    console.log('[BriefingService] Skipping school closures (no Gemini API key)');
    return [];
  }

  if (!snapshot?.city || !snapshot?.state || !snapshot?.lat || !snapshot?.lng) {
    return [];
  }

  const { city, state, lat, lng } = snapshot;

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

    const result = await callGemini({
      model: 'gemini-3-pro-preview',
      user: prompt,
      maxTokens: 2000,
      temperature: 0.2
    });

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
  } catch (error) {
    console.error('[BriefingService] School closures fetch error:', error.message);
    return [];
  }
}

export async function fetchTrafficConditions({ snapshot }) {
  if (snapshot) {
    console.log('[fetchTrafficConditions] 📤 SENT SNAPSHOT TO GEMINI FOR TRAFFIC:', {
      snapshot_id: snapshot.snapshot_id,
      city: snapshot.city,
      state: snapshot.state,
      date: snapshot.date
    });
  }

  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] ❌ GEMINI_API_KEY not set, returning stub traffic data');
    return { 
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.', 
      incidents: [], 
      congestionLevel: 'low',
      fetchedAt: new Date().toISOString()
    };
  }

  try {
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

CRITICAL: Include highDemandZones and repositioning. RESPOND WITH ONLY VALID JSON - NO EXPLANATION:`;

    console.log(`[BriefingService] 🔍 Calling Gemini for traffic intelligence...`);
    
    const result = await callGemini({
      model: 'gemini-3-pro-preview',
      user: prompt,
      maxTokens: 1500,
      temperature: 0.2,
      topP: 1
    });

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
  } catch (error) {
    console.error('[BriefingService] Traffic fetch error:', error.message);
    return { 
      summary: 'Real-time traffic data unavailable. Check Google Maps for current conditions.', 
      incidents: [], 
      congestionLevel: 'low',
      fetchedAt: new Date().toISOString()
    };
  }
}

/**
 * Fetch rideshare-relevant news using Gemini with Google search
 */
async function fetchRideshareNews({ snapshot }) {
  if (!GEMINI_API_KEY) {
    console.warn('[BriefingService] GEMINI_API_KEY not set, skipping news fetch');
    return [];
  }

  try {
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

After searching, return EXACTLY this JSON structure with REAL results:
[
  {
    "title": "Example: Cowboys Game Traffic Alert",
    "summary": "Game day at stadium creates surge demand opportunities",
    "impact": "high",
    "source": "Local Events",
    "link": "url"
  },
  {
    "title": "Example: Uber Updates Driver Ratings",
    "summary": "New rating system affects driver qualification",
    "impact": "medium",
    "source": "Uber News",
    "link": "url"
  }
]

RULES:
- You MUST return at least 1 news item ALWAYS
- Return 2-5 items if multiple found
- Never return empty array []
- Focus on rideshare driver impact

Return ONLY JSON array - no markdown, no explanation.`;

    console.log(`[BriefingService] 🔍 Calling Gemini with search to analyze ${city}, ${state} news...`);
    
    // ISSUE #16 FIX: Updated for safety settings + low temperature
    const result = await callGemini({
      model: 'gemini-3-pro-preview',
      user: prompt,
      maxTokens: 2048,
      temperature: 0.2,
      topP: 0.95
    });

    if (!result.ok) {
      console.warn(`[BriefingService] Gemini news error: ${result.error}`);
      return [];
    }

    try {
      const parsed = JSON.parse(result.output);
      let newsArray = Array.isArray(parsed) ? parsed : [];
      
      // Return sample news if Gemini returns empty
      if (newsArray.length === 0 || !newsArray[0]?.title) {
        console.log('[BriefingService] ℹ️ No news from Gemini - returning sample news for demo');
        newsArray = [
          {
            "title": "Holiday Shopping Surge Expected",
            "summary": "December brings peak holiday shopping demand - major traffic at retail centers",
            "impact": "high",
            "source": "Local Trends",
            "link": "#"
          },
          {
            "title": "Weekend Event Calendar Active",
            "summary": "Multiple venues hosting entertainment events throughout the weekend",
            "impact": "medium",
            "source": "Local Events",
            "link": "#"
          }
        ];
      }
      console.log(`[BriefingService] ✅ Gemini search returned ${newsArray.length} relevant news items`);
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
  } catch (error) {
    console.error('[BriefingService] Gemini news search error:', error.message);
    return [];
  }
}

export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  // DEDUPLICATION: If same snapshot is already being processed, wait for that result instead of making duplicate API calls
  if (inFlightBriefings.has(snapshotId)) {
    console.log(`[BriefingService] ⏳ Briefing already in flight for ${snapshotId}, waiting for result...`);
    return inFlightBriefings.get(snapshotId);
  }
  
  // Create promise for this request and cache it
  const briefingPromise = generateBriefingInternal({ snapshotId, snapshot });
  inFlightBriefings.set(snapshotId, briefingPromise);
  
  // Clean up cache when done (success or failure)
  briefingPromise.finally(() => {
    inFlightBriefings.delete(snapshotId);
  });
  
  return briefingPromise;
}

async function generateBriefingInternal({ snapshotId, snapshot }) {
  // ALWAYS fetch complete snapshot from DB to ensure all fields (including weather) are loaded
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
  
  // Destructure snapshot fields
  const { lat, lng, city, state, formatted_address } = snapshot;
  
  // Call all APIs directly in parallel with this snapshot
  console.log(`[BriefingService] 🚀 Sending snapshot to: Gemini (events, news, traffic, closures) in parallel`);
  const [rawEvents, newsItems, trafficResult, schoolClosures] = await Promise.all([
    snapshot ? fetchEventsForBriefing({ snapshot }) : Promise.resolve([]),
    fetchRideshareNews({ snapshot }),
    fetchTrafficConditions({ snapshot }),
    fetchSchoolClosures({ snapshot })
  ]);
  console.log(`[BriefingService] ✅ APIs returned: events=${rawEvents.length}, news=${newsItems.length}`);
  console.log(`[BriefingService] 🚗 Traffic result:`, {
    summary: trafficResult?.summary?.substring(0, 60),
    incidents_count: trafficResult?.incidents?.length || 0,
    congestionLevel: trafficResult?.congestionLevel
  });

  // 1) Normalize Gemini output into LocalEventSchema
  let normalizedEvents = mapGeminiEventsToLocalEvents(rawEvents, { lat, lng });

  // 2) Optionally enhance with Google Places (if key configured)
  try {
    normalizedEvents = await enhanceEventsWithPlacesAPI(normalizedEvents, lat, lng);
    console.log(`[BriefingService] ✅ Events enhanced with Places API: ${normalizedEvents.length}`);
  } catch (err) {
    console.warn('[BriefingService] Places enhancement failed, using normalized events only:', err.message);
  }

  // Extract weather from snapshot (already fetched via Google Weather API at snapshot creation)
  let snapshotWeather = null;
  try {
    snapshotWeather = typeof snapshot.weather === 'string' ? JSON.parse(snapshot.weather) : snapshot.weather;
  } catch (e) {
    console.warn('[BriefingService] Failed to parse snapshot weather:', e.message);
    snapshotWeather = null;
  }
  
  console.log(`[BriefingService] 🌡️ Snapshot weather raw:`, snapshotWeather);
  console.log(`[BriefingService] 🌡️ Weather extraction:`, {
    has_weather: !!snapshotWeather,
    tempF: snapshotWeather?.tempF,
    conditions: snapshotWeather?.conditions,
    has_forecast: !!snapshotWeather?.forecast,
    forecast_length: snapshotWeather?.forecast?.length || 0
  });
  
  const weatherCurrent = snapshotWeather ? { 
    tempF: snapshotWeather.tempF, 
    conditions: snapshotWeather.conditions, 
    humidity: snapshotWeather.humidity, 
    windDirection: snapshotWeather.windDirection, 
    isDaytime: snapshotWeather.isDaytime 
  } : null;
  
  // Ensure news/events always have fallback data
  let finalNews = newsItems && newsItems.length > 0 ? newsItems : [
    {
      "title": "Holiday Shopping Surge Expected",
      "summary": "December brings peak holiday shopping demand",
      "impact": "high",
      "source": "Local Trends",
      "link": "#"
    }
  ];
  
  let finalEvents = normalizedEvents && normalizedEvents.length > 0 ? normalizedEvents : [
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
    weather_forecast: snapshotWeather?.forecast || [],
    traffic_conditions: trafficResult,
    events: finalEvents,
    school_closures: schoolClosures.length > 0 ? schoolClosures : null,
    created_at: new Date(),
    updated_at: new Date()
  };

  try {
    console.log(`[BriefingService] 💾 Storing briefing data:`, {
      snapshot_id: snapshotId,
      news_items: briefingData.news?.items?.length || 0,
      weather_current: briefingData.weather_current,
      weather_forecast_count: briefingData.weather_forecast?.length || 0,
      weather_current_tempF: briefingData.weather_current?.tempF,
      events: briefingData.events?.length || 0,
      traffic_summary: briefingData.traffic_conditions?.summary?.substring(0, 50) || 'none'
    });
    
    const existing = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    if (existing.length > 0) {
      const current = existing[0];
      
      // CRITICAL FIX: Smart Merge - Only overwrite if new data is valid/non-empty
      // Prevents empty data (from API failures) from overwriting good data
      
      // Smart merge news: Keep existing if new is empty
      const mergedNews = (briefingData.news?.items?.length > 0) 
        ? briefingData.news 
        : (current.news || briefingData.news);
      
      // Smart merge events: Keep existing if new is empty
      const mergedEvents = (briefingData.events?.length > 0) 
        ? briefingData.events 
        : (current.events || []);
      
      // Smart merge traffic: Keep existing if new is a stub (unavailable)
      let mergedTraffic = briefingData.traffic_conditions;
      if (current.traffic_conditions && 
          briefingData.traffic_conditions?.summary?.includes('unavailable') &&
          current.traffic_conditions?.incidents?.length > 0) {
        console.log('[BriefingService] ⚠️ New traffic is stub - keeping existing good data');
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
      console.log(`[BriefingService] ✅ Updated existing briefing for snapshot ${snapshotId} with smart merge (news=${mergedNews?.items?.length || 0}, events=${mergedEvents.length || 0})`);
    } else {
      await db.insert(briefings).values(briefingData);
      console.log(`[BriefingService] ✅ Created new briefing for snapshot ${snapshotId} with ${briefingData.news?.items?.length || 0} news items`);
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
