// server/lib/venue-intelligence.js
// Real-time venue intelligence using Gemini 2.0 Flash with web search grounding
// Provides: bars/restaurants sorted by expense, filtered by operating hours, traffic context
// ML: Persists venue data with user corrections for feedback loop

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from '../db/drizzle.js';
import { nearby_venues } from '../../shared/schema.js';

// Google APIs: Split keys based on API requirements
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY; // Places, Geocoding, Weather, Routes, etc.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Generative Language API (requires separate project)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Enrich bar venues with phone numbers using Google Places API
 * @param {Array} venues - Array of venues from Gemini
 * @returns {Promise<Array>} - Venues with phone numbers added for bars
 */
async function enrichBarsWithPhones(venues) {
  if (!GOOGLE_MAPS_API_KEY || !venues || venues.length === 0) {
    return venues;
  }

  // Only enrich bars and bar_restaurants
  const barsToEnrich = venues.filter(v => v.type === "bar" || v.type === "bar_restaurant");
  
  for (const bar of barsToEnrich) {
    try {
      // Use Google Places text search to find the venue and get phone
      const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      searchUrl.searchParams.set('query', `${bar.name} ${bar.address}`);
      searchUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
      
      const response = await fetch(searchUrl.toString()).catch(() => null);
      if (response?.ok) {
        const data = await response.json();
        if (data.results?.[0]?.formatted_phone_number) {
          bar.phone = data.results[0].formatted_phone_number;
        }
      }
    } catch (err) {
      console.warn(`[VenueIntelligence] Failed to get phone for ${bar.name}:`, err.message);
      // Continue without phone - don't break the flow
    }
  }

  return venues;
}

/**
 * Discover nearby bars and restaurants using Gemini with Google Search grounding
 * @param {Object} params - Discovery parameters
 * @param {number} params.lat - Driver latitude
 * @param {number} params.lng - Driver longitude  
 * @param {string} params.city - City name
 * @param {string} params.state - State/region
 * @param {number} params.radiusMiles - Search radius in miles (default 15)
 * @param {string} [params.holiday] - Current holiday (e.g., "Thanksgiving") - affects hours
 * @param {string} [params.timezone] - Snapshot timezone for accurate time context
 * @param {Date} [params.localIso] - Snapshot local time for accurate closing calculations
 * @returns {Promise<Object>} Venue intelligence with sorted venues
 */
export async function discoverNearbyVenues({ lat, lng, city, state, radiusMiles = 15, holiday = null, timezone = null, localIso = null }) {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    }
  });
  
  // Use snapshot's local time if provided, otherwise fall back to server time
  let currentTime;
  let currentHour;
  let currentMinutes;
  
  if (localIso) {
    currentTime = new Date(localIso);
    currentHour = currentTime.getHours();
    currentMinutes = currentTime.getMinutes();
  } else {
    currentTime = new Date();
    currentHour = currentTime.getHours();
    currentMinutes = currentTime.getMinutes();
  }
  
  const timeString = `${currentHour}:${currentMinutes.toString().padStart(2, '0')}`;
  
  const holidayContext = holiday ? `\n⚠️ TODAY IS ${holiday.toUpperCase()} - Many venues may have special holiday hours!` : '';
  
  const prompt = `You are a rideshare driver intelligence assistant. Find me ALL bars and restaurants near ${city}, ${state} (coordinates: ${lat}, ${lng}) within ${radiusMiles} miles.${holidayContext}

CRITICAL FILTERING RULES - DRIVER BEHAVIOR:
1. INCLUDE: Venues that are NOW OPEN
2. INCLUDE: Venues opening within the next 15 minutes (driver can get there + they're opening soon)
3. EXCLUDE: Venues that closed 30-45+ minutes ago (past their prime earning time)
4. Sort by EXPENSE LEVEL: Highest expense first ($$$$) down to lowest ($)

For each venue provide:
- name: Venue name
- type: "bar" or "restaurant" or "bar_restaurant"
- address: Full street address
- phone: Phone number in format (XXX) XXX-XXXX or null if unavailable
- expense_level: "$", "$$", "$$$", or "$$$$" (4 = most expensive)
- expense_rank: 4 for $$$$, 3 for $$$, 2 for $$, 1 for $
- is_open: true/false (current status NOW at ${timeString})
- opens_in_minutes: Minutes until opening (null if already open or >15 mins away)
- hours_today: Opening and closing time today (e.g., "11:00 AM - 2:00 AM")
- hours_full_week: {"monday": "11am-2am", "tuesday": "11am-2am", ...} (for ML learning)
- closing_soon: true if closing within 1 hour, false otherwise
- minutes_until_close: Minutes until closing (null if not closing soon)
- was_filtered: true if venue closed 30+ minutes ago (excluded from results)
- crowd_level: "low", "medium", "high" (estimate based on time and venue type)
- rideshare_potential: "low", "medium", "high" (based on expense + crowd)
- lat: Approximate latitude
- lng: Approximate longitude

Return a JSON object with this structure:
{
  "query_time": "${timeString}",
  "location": "${city}, ${state}",
  "total_venues": <count>,
  "venues": [
    {
      "name": "...",
      "type": "bar|restaurant|bar_restaurant",
      "address": "...",
      "phone": "(XXX) XXX-XXXX",
      "expense_level": "$$$$",
      "expense_rank": 4,
      "is_open": true,
      "hours_today": "...",
      "closing_soon": false,
      "minutes_until_close": null,
      "crowd_level": "high",
      "rideshare_potential": "high",
      "lat": ...,
      "lng": ...
    }
  ],
  "last_call_venues": [<venues closing within 1 hour, sorted by expense>],
  "search_sources": ["list of sources used"]
}

SORT ORDER:
1. Currently OPEN venues first (is_open: true)
2. Within open venues: Closing soon first (last-call opportunities), then by expense level ($$$$→$)
3. Venues opening later (is_open: false) last, sorted by expense level

Return ONLY valid JSON, no markdown.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Parse JSON response
    let venueData;
    try {
      // Try direct parse first
      venueData = JSON.parse(text);
    } catch (e) {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        venueData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse venue data from Gemini response');
      }
    }

    // Add search source info
    venueData.search_sources = venueData.search_sources || ['Gemini AI analysis'];

    // Post-process filtering and sorting
    if (venueData.venues && Array.isArray(venueData.venues)) {
      // Filter: Remove venues closed 30+ minutes ago (past earning prime time)
      // Keep: Open venues + venues opening within 15 mins
      const now = new Date();
      const filteredVenues = venueData.venues.filter(v => {
        // Venues that closed 30+ mins ago don't make driver trip
        if (v.was_filtered) {
          return false; // Gemini already marked as filtered
        }
        // Keep open venues or those opening within 15 mins
        return v.is_open || (v.opens_in_minutes && v.opens_in_minutes <= 15);
      });

      // Sort: Open venues → opening soon → closing soon → by expense
      filteredVenues.sort((a, b) => {
        // 1. Open venues first
        if (a.is_open !== b.is_open) {
          return a.is_open ? -1 : 1;
        }
        
        // 2. Within open/opening venues: closing soon first (last-call)
        if (a.closing_soon !== b.closing_soon) {
          return a.closing_soon ? -1 : 1;
        }
        
        // 3. Then by expense_rank descending ($$$$→$)
        return (b.expense_rank || 0) - (a.expense_rank || 0);
      });

      venueData.venues = filteredVenues;
      // Extract last-call venues (open and closing within 1 hour)
      venueData.last_call_venues = venueData.venues.filter(v => v.is_open && v.closing_soon);
      
      // Enrich bar venues with phone numbers from Google Places
      venueData.venues = await enrichBarsWithPhones(venueData.venues);
    }

    return venueData;
  } catch (error) {
    console.error('[VenueIntelligence] Error discovering venues:', error);
    throw error;
  }
}

/**
 * Get traffic density for a specific area using Gemini web search
 * @param {Object} params - Traffic query parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {string} params.city - City name
 * @returns {Promise<Object>} Traffic intelligence
 */
export async function getTrafficIntelligence({ lat, lng, city, state }) {
  const currentTime = new Date();
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const prompt = `You are a traffic intelligence assistant for rideshare drivers in ${city}, ${state}. Analyze CURRENT traffic conditions RIGHT NOW at coordinates (${lat}, ${lng}).

Current time: ${timeString}

Provide real-time traffic intelligence based on typical patterns for this time and location:
1. Overall traffic density (1-10 scale, 10 = gridlock)
2. Major congestion areas and why (events, accidents, construction, commute patterns)
3. High-demand rideshare zones based on traffic patterns
4. Best positioning advice for drivers

Return ONLY valid JSON (no explanation):
{
  "query_time": "${timeString}",
  "location": "${city}, ${state}",
  "traffic_density": 7,
  "density_level": "high|medium|low",
  "congestion_areas": [
    {"area": "specific street/highway", "reason": "detailed reason", "severity": 1-10}
  ],
  "high_demand_zones": [
    {"zone": "area name", "why": "reason", "rideshare_opportunity": "high|medium|low"}
  ],
  "driver_advice": "actionable advice for drivers",
  "sources": ["real-time analysis"]
}`;

  try {
    console.log('[VenueIntelligence] 🚗 Calling Gemini 2.5 Pro for traffic...');
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GOOGLE_MAPS_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[VenueIntelligence] ✅ Gemini response received');
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('No text in Gemini response');
    }

    const text = data.candidates[0].content.parts[0].text;
    console.log('[VenueIntelligence] Response text length:', text.length);
    console.log('[VenueIntelligence] Response preview:', text.substring(0, 200));
    
    let trafficData;
    try {
      trafficData = JSON.parse(text);
      console.log('[VenueIntelligence] ✅ Parsed traffic JSON:', trafficData.density_level);
    } catch (e) {
      console.warn('[VenueIntelligence] JSON parse failed, trying to extract:', e.message);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        trafficData = JSON.parse(jsonMatch[0]);
        console.log('[VenueIntelligence] ✅ Extracted traffic JSON:', trafficData.density_level);
      } else {
        throw new Error('Could not parse traffic data');
      }
    }

    return trafficData;
  } catch (error) {
    console.error('[VenueIntelligence] ❌ Error getting traffic:', error.message);
    throw error;
  }
}

/**
 * Combined venue + traffic intelligence for Smart Blocks
 * @param {Object} params - Query parameters
 * @param {string} [params.holiday] - Current holiday name (optional)
 * @returns {Promise<Object>} Combined intelligence
 */
export async function getSmartBlocksIntelligence({ lat, lng, city, state, radiusMiles = 5, holiday = null, timezone = null, localIso = null }) {
  try {
    // Run venue discovery and traffic intelligence in parallel
    const [venueData, trafficData] = await Promise.all([
      discoverNearbyVenues({ lat, lng, city, state, radiusMiles, holiday, timezone, localIso }),
      getTrafficIntelligence({ lat, lng, city, state })
    ]);

    return {
      timestamp: new Date().toISOString(),
      location: { lat, lng, city, state },
      venues: venueData,
      traffic: trafficData,
      combined_insights: {
        top_opportunities: venueData.venues?.slice(0, 5) || [],
        last_call_alerts: venueData.last_call_venues || [],
        traffic_hotspots: trafficData.high_demand_zones || [],
        driver_summary: `${venueData.total_venues || 0} venues nearby. Traffic: ${trafficData.density_level || 'unknown'}. ${trafficData.driver_advice || ''}`
      }
    };
  } catch (error) {
    console.error('[VenueIntelligence] Error getting combined intelligence:', error);
    throw error;
  }
}

/**
 * Persist venue data to database for ML training and user feedback
 * @param {Array} venues - Venues from Gemini discovery
 * @param {Object} context - Context {snapshot_id, city, state, is_holiday, holiday_name, day_of_week}
 * @returns {Promise<Array>} - Inserted venue records
 */
export async function persistVenuesToDatabase(venues, context) {
  if (!venues || !Array.isArray(venues) || venues.length === 0) {
    return [];
  }

  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    const records = venues.map(v => ({
      snapshot_id: context.snapshot_id,
      name: v.name,
      venue_type: v.type,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      distance_miles: v.distance_miles || null,
      expense_level: v.expense_level,
      expense_rank: v.expense_rank,
      phone: v.phone || null,
      is_open: v.is_open,
      hours_today: v.hours_today,
      hours_full_week: v.hours_full_week || null,
      closing_soon: v.closing_soon,
      minutes_until_close: v.minutes_until_close || null,
      opens_in_minutes: v.opens_in_minutes || null,
      opens_in_future: v.opens_in_minutes && v.opens_in_minutes <= 15,
      was_filtered: v.was_filtered || false,
      crowd_level: v.crowd_level,
      rideshare_potential: v.rideshare_potential,
      city: context.city,
      state: context.state,
      day_of_week: dayOfWeek,
      is_holiday: context.is_holiday || false,
      holiday_name: context.holiday_name || null,
      search_sources: v.search_sources || null,
      user_corrections: [],
      correction_count: 0,
    }));

    const inserted = await db.insert(nearby_venues).values(records).returning();
    console.log(`[VenueIntelligence] Persisted ${inserted.length} venues to database`);
    return inserted;
  } catch (error) {
    console.warn('[VenueIntelligence] Failed to persist venues:', error.message);
    // Don't throw - allow API to continue even if DB persistence fails
    return [];
  }
}

export default {
  discoverNearbyVenues,
  getTrafficIntelligence,
  getSmartBlocksIntelligence,
  persistVenuesToDatabase
};
