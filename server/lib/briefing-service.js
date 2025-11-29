import { db } from '../db/drizzle.js';
import { briefings } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

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
    console.warn('[BriefingService] GOOGLE_API_KEY not set, returning unfiltered news');
    return newsItems;
  }

  try {
    const newsText = newsItems.map((n, i) => 
      `${i + 1}. ${n.title} (${n.source}, ${n.date})`
    ).join('\n');

    const prompt = `Based on this news data:
${newsText}

Identify any local, state, or federal news that would specifically impact rideshare drivers in ${city}, ${state}. Focus ONLY on: policy changes, regulations, airport pickup changes, road closures, accidents, protests, or legal updates affecting rideshare. NO weather, events, hotspots, or positioning advice.

Return a JSON array of objects with these fields:
- title: The news headline
- summary: One sentence actionable summary for drivers
- impact: "high", "medium", or "low"
- source: The news source

If no relevant news, return an empty array [].`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error('[BriefingService] Gemini filter error:', error);
    return newsItems.slice(0, 3).map(n => ({
      title: n.title,
      summary: n.snippet || n.title,
      impact: 'medium',
      source: n.source
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
      forecast = (forecastData.forecastHours || []).map(hour => ({
        time: hour.displayDateTime,
        temperature: hour.temperature,
        conditions: hour.weatherCondition?.description?.text,
        conditionType: hour.weatherCondition?.type,
        precipitationProbability: hour.precipitation?.probability?.percent,
        windSpeed: hour.wind?.speed,
        isDaytime: hour.isDaytime
      }));
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
    const trafficData = {
      summary: 'Normal traffic conditions',
      incidents: [],
      congestionLevel: 'low',
      fetchedAt: new Date().toISOString()
    };
    return trafficData;
  } catch (error) {
    console.error('[BriefingService] Traffic fetch error:', error);
    return { summary: null, incidents: [], error: error.message };
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
