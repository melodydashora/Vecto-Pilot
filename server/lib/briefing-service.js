import { db } from '../db/drizzle.js';
import { briefings, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

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

export async function fetchRideshareNews({ city, state, lat, lng }) {
  if (!SERP_API_KEY) {
    console.warn('[BriefingService] SERP_API_KEY not set, skipping news fetch');
    return { items: [], error: 'SERP_API_KEY not configured' };
  }

  try {
    const searchQuery = encodeURIComponent(`uber OR lyft OR rideshare ${city} ${state}`);
    const url = `https://serpapi.com/search.json?engine=google&q=${searchQuery}&tbm=nws&tbs=qdr:d2&api_key=${SERP_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SerpAPI returned ${response.status}`);
    }
    
    const data = await response.json();
    const newsResults = data.news_results || [];
    
    const now = new Date();
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    
    const recentNews = newsResults
      .filter(item => {
        if (item.published_at) {
          const pubDate = new Date(item.published_at);
          return pubDate >= cutoff;
        }
        return true;
      })
      .slice(0, 8)
      .map(item => ({
        title: item.title,
        source: item.source,
        date: item.date || item.published_at,
        link: item.link,
        snippet: item.snippet
      }));

    if (recentNews.length === 0) {
      return { items: [], filtered: [], message: 'No recent rideshare news found' };
    }

    const filtered = await filterNewsWithGemini(recentNews, city, state);
    
    return {
      items: recentNews,
      filtered,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[BriefingService] News fetch error:', error);
    return { items: [], error: error.message };
  }
}

async function filterNewsWithGemini(newsItems, city, state) {
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

    const prompt = `You are a rideshare driver intelligence system. Analyze this news for ${city}, ${state} and identify what matters for rideshare drivers.

NEWS DATA:
${newsText}

INSTRUCTIONS:
1. Focus on: policy changes, regulations, airport pickup changes, road closures, accidents, protests
2. Look for events that drive demand: concerts, games, parades, watch parties, conferences, festivals, conventions
3. For each relevant item, provide actionable driver insight
4. Return ONLY valid JSON array (no markdown, no explanation)

RESPONSE FORMAT:
[
  {
    "title": "headline here",
    "summary": "one sentence actionable insight for drivers",
    "impact": "high" or "medium" or "low",
    "source": "news source name"
  }
]

If no relevant items, return: []`;

    console.log('[BriefingService] Calling Gemini with prompt for', city, state);
    
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
    console.log('[BriefingService] Gemini response:', JSON.stringify(data).substring(0, 200));
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const filtered = JSON.parse(jsonMatch[0]);
        console.log('[BriefingService] Filtered to', filtered.length, 'news items');
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

export async function generateAndStoreBriefing({ snapshotId, lat, lng, city, state }) {
  console.log(`[BriefingService] Generating briefing for ${city}, ${state} (${lat}, ${lng})`);
  
  const [newsResult, weatherResult, trafficResult] = await Promise.all([
    fetchRideshareNews({ city, state, lat, lng }),
    fetchWeatherConditions({ lat, lng }),
    fetchTrafficConditions({ lat, lng, city, state })
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
