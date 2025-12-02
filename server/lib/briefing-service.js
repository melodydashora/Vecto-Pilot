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

const SERP_API_KEY = process.env.SERP_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

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
});

const LocalEventsArraySchema = z.array(LocalEventSchema);

export async function fetchRideshareNews({ city, state, lat, lng, country = 'US' }) {
  console.log(`[BriefingService] Fetching local events for ${city}, ${state} at (${lat}, ${lng})`);
  
  // Try Perplexity first (best for real-time local events)
  if (PERPLEXITY_API_KEY) {
    console.log('[BriefingService] Trying Perplexity for local events...');
    const perplexityEvents = await fetchEventsFromPerplexity(city, state, lat, lng);
    if (perplexityEvents.length > 0) {
      console.log(`[BriefingService] ✅ Perplexity returned ${perplexityEvents.length} events`);
      return {
        items: perplexityEvents,
        filtered: perplexityEvents,
        fetchedAt: new Date().toISOString(),
        source: 'Perplexity'
      };
    }
  }
  
  // Fallback to SerpAPI if available
  if (SERP_API_KEY) {
    console.log('[BriefingService] Perplexity failed, trying SerpAPI...');
    const serpEvents = await fetchEventsFromSerpAPI(city, state, lat, lng);
    if (serpEvents.filtered.length > 0) {
      console.log(`[BriefingService] ✅ SerpAPI returned ${serpEvents.filtered.length} events`);
      return { ...serpEvents, source: 'SerpAPI' };
    }
  }
  
  // Fallback to NewsAPI
  if (NEWS_API_KEY) {
    console.log('[BriefingService] SerpAPI failed, trying NewsAPI...');
    const newsEvents = await fetchEventsFromNewsAPI(city, state, lat, lng);
    if (newsEvents.length > 0) {
      console.log(`[BriefingService] ✅ NewsAPI returned ${newsEvents.length} events`);
      return {
        items: newsEvents,
        filtered: newsEvents,
        fetchedAt: new Date().toISOString(),
        source: 'NewsAPI'
      };
    }
  }
  
  // All failed - return stub
  console.warn(`[BriefingService] No real-time events found from any service`);
  return { 
    items: [], 
    filtered: [
      {
        title: "Local Events Search",
        summary: "No major events found today in your area. Monitor traffic and airport activity for surge opportunities.",
        impact: "low",
        source: "System",
        event_type: "other",
        latitude: lat,
        longitude: lng,
        distance_miles: 0,
        event_date: new Date().toISOString(),
        link: null
      }
    ], 
    message: 'No local events detected - monitoring normal conditions',
    source: 'Stub'
  };
}

async function fetchEventsFromPerplexity(city, state, lat, lng) {
  try {
    const prompt = `Find local events happening TODAY in ${city}, ${state} area within 50 miles of coordinates ${lat}, ${lng}.
Focus on: concerts, games, sports, comedy shows, live music, festivals, performances, theater.
Return ONLY a JSON array with event details. For each event include: title, location address, event_date/time, estimated_distance_miles, and type.
Return empty array [] if no events found.

RESPOND WITH ONLY VALID JSON ARRAY - NO EXPLANATION:`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: prompt }],
        search_recency_filter: 'day',  // ✅ TODAY only - optimal for local events
        temperature: 0.2,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      console.warn(`[BriefingService] Perplexity error ${response.status}`);
      return [];
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Convert Perplexity response to our schema
        return parsed.map((event, idx) => ({
          title: event.title || event.name || `Event ${idx + 1}`,
          summary: `${event.type || 'Event'} at ${event.location || 'TBD'}. High demand for rideshare to/from this event.`,
          impact: 'high',
          source: 'Perplexity',
          event_type: event.type?.toLowerCase() || 'other',
          latitude: event.latitude,
          longitude: event.longitude,
          distance_miles: event.estimated_distance_miles || event.distance_miles,
          event_date: event.event_date || event.date,
          event_time: event.event_time || event.time,
          location: event.location,
          link: event.link || event.url
        }));
      }
    } catch (e) {
      console.error('[BriefingService] Perplexity JSON parse error:', e.message);
      return [];
    }
  } catch (error) {
    console.error('[BriefingService] Perplexity fetch error:', error.message);
    return [];
  }
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

// Confirm TBD event details using Gemini 3.0 Pro
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

  console.log(`[BriefingService] Found ${tbdEvents.length} events with TBD details, confirming with Gemini...`);

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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000
        }
      })
    });

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
  if (!GOOGLE_API_KEY) {
    console.warn('[BriefingService] GOOGLE_API_KEY not set, returning all news');
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      current = {
        temperature: currentData.temperature,
        feelsLike: currentData.feelsLikeTemperature,
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
          temperature: hour.temperature,
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
  if (!PERPLEXITY_API_KEY) {
    console.log('[BriefingService] Skipping school closures (no Perplexity API key)');
    return [];
  }

  try {
    const prompt = `Find upcoming school closures/breaks for ${city}, ${state} within 15 miles of coordinates (${lat}, ${lng}) for the next 30 days.

Include:
1. School district closures (winter break, spring break, professional development days)
2. Local college/university closures (SMU, UT Dallas, UTA, etc.)
3. Closure dates and reopening dates

Return ONLY valid JSON array with this structure:
[
  {
    "schoolName": "Dallas ISD" or "Southern Methodist University",
    "closureStart": "2025-12-15",
    "reopeningDate": "2026-01-06",
    "type": "district" | "college",
    "reason": "Winter Break",
    "impact": "high" | "medium" | "low"
  }
]

RESPOND WITH ONLY VALID JSON ARRAY - NO EXPLANATION:`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: prompt }],
        search_recency_filter: 'month',
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      console.warn(`[BriefingService] School closures fetch failed (${response.status})`);
      return [];
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    
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
    
    // Add timeout to prevent hanging requests
    const trafficPromise = getTrafficIntelligence({ lat, lng, city, state });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Traffic API timeout')), 8000)
    );
    
    let trafficIntel;
    try {
      trafficIntel = await Promise.race([trafficPromise, timeoutPromise]);
    } catch (timeoutErr) {
      console.warn('[BriefingService] Traffic fetch timed out, using stub data:', timeoutErr.message);
      // Return stub data on timeout instead of erroring
      trafficIntel = {
        density_level: 'medium',
        driver_advice: 'Unable to fetch real-time traffic. Check maps for current conditions.',
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

export async function generateAndStoreBriefing({ snapshotId, lat, lng, city, state, country = 'US' }) {
  console.log(`[BriefingService] Generating briefing for ${city}, ${state}, ${country} (${lat}, ${lng})`);
  
  const [newsResult, weatherResult, trafficResult, schoolClosures] = await Promise.all([
    fetchRideshareNews({ city, state, lat, lng, country }),
    fetchWeatherConditions({ lat, lng }),
    fetchTrafficConditions({ lat, lng, city, state }),
    fetchSchoolClosures({ city, state, lat, lng })
  ]);

  const briefingData = {
    snapshot_id: snapshotId,
    lat,
    lng,
    city,
    state,
    news: newsResult,
    weather_current: weatherResult.current,
    weather_forecast: weatherResult.forecast,
    traffic_conditions: trafficResult,
    events: null,
    school_closures: schoolClosures.length > 0 ? schoolClosures : null,
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
