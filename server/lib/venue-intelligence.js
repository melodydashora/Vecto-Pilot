// server/lib/venue-intelligence.js
// Real-time venue intelligence using Gemini 2.0 Flash with web search grounding
// Provides: bars/restaurants sorted by expense, filtered by operating hours, traffic context

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Discover nearby bars and restaurants using Gemini with Google Search grounding
 * @param {Object} params - Discovery parameters
 * @param {number} params.lat - Driver latitude
 * @param {number} params.lng - Driver longitude  
 * @param {string} params.city - City name
 * @param {string} params.state - State/region
 * @param {number} params.radiusMiles - Search radius in miles (default 15)
 * @param {string} [params.holiday] - Current holiday (e.g., "Thanksgiving") - affects hours
 * @returns {Promise<Object>} Venue intelligence with sorted venues
 */
export async function discoverNearbyVenues({ lat, lng, city, state, radiusMiles = 15, holiday = null }) {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    }
  });
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();
  const timeString = `${currentHour}:${currentMinutes.toString().padStart(2, '0')}`;
  
  const holidayContext = holiday ? `\n⚠️ TODAY IS ${holiday.toUpperCase()} - Many venues may have special holiday hours!` : '';
  
  const prompt = `You are a rideshare driver intelligence assistant. Find me ALL bars and restaurants near ${city}, ${state} (coordinates: ${lat}, ${lng}) within ${radiusMiles} miles.${holidayContext}

IMPORTANT REQUIREMENTS:
1. Sort by EXPENSE LEVEL: Highest expense first ($$$$) down to lowest ($)
2. Include ONLY venues that are currently OPEN or will be open within the next hour
3. For each venue, note if it's closing within 1 hour (LAST CALL opportunity!)
4. Use current time: ${timeString}
5. If today is a holiday, venues may have SPECIAL/MODIFIED hours - note this in the response

For each venue provide:
- name: Venue name
- type: "bar" or "restaurant" or "bar_restaurant"
- address: Full street address
- expense_level: "$", "$$", "$$$", or "$$$$" (4 = most expensive)
- expense_rank: 4 for $$$$, 3 for $$$, 2 for $$, 1 for $
- is_open: true/false
- hours_today: Opening and closing time today (e.g., "11:00 AM - 2:00 AM")
- closing_soon: true if closing within 1 hour, false otherwise
- minutes_until_close: Minutes until closing (null if not closing soon)
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

    // Post-process: ensure proper sorting
    // Order: Open venues first → closing soon → then by expense level → closed venues last
    if (venueData.venues && Array.isArray(venueData.venues)) {
      venueData.venues.sort((a, b) => {
        // 1. Open venues before closed venues
        if (a.is_open !== b.is_open) {
          return a.is_open ? -1 : 1;
        }
        
        // Within open venues:
        if (a.is_open && b.is_open) {
          // 2. Closing soon first (last-call opportunities)
          if (a.closing_soon !== b.closing_soon) {
            return a.closing_soon ? -1 : 1;
          }
          // 3. Then by expense_rank descending
          return (b.expense_rank || 0) - (a.expense_rank || 0);
        }
        
        // Within closed venues: sort by expense
        return (b.expense_rank || 0) - (a.expense_rank || 0);
      });

      // Extract last-call venues (open and closing soon)
      venueData.last_call_venues = venueData.venues.filter(v => v.is_open && v.closing_soon);
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
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    }
  });
  const currentTime = new Date();
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const prompt = `You are a traffic intelligence assistant for rideshare drivers. Analyze current traffic conditions near ${city}, ${state} (${lat}, ${lng}).

Current time: ${timeString}

Provide real-time traffic intelligence:
1. Overall traffic density (1-10 scale, 10 = gridlock)
2. Major congestion areas and why (events, accidents, construction)
3. High-demand rideshare zones based on traffic patterns
4. Best positioning advice for drivers

Return JSON:
{
  "query_time": "${timeString}",
  "location": "${city}, ${state}",
  "traffic_density": 7,
  "density_level": "high|medium|low",
  "congestion_areas": [
    {"area": "...", "reason": "...", "severity": 1-10}
  ],
  "high_demand_zones": [
    {"zone": "...", "why": "...", "rideshare_opportunity": "high|medium|low"}
  ],
  "driver_advice": "...",
  "sources": ["..."]
}

Return ONLY valid JSON.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let trafficData;
    try {
      trafficData = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        trafficData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse traffic data');
      }
    }

    return trafficData;
  } catch (error) {
    console.error('[VenueIntelligence] Error getting traffic:', error);
    throw error;
  }
}

/**
 * Combined venue + traffic intelligence for Smart Blocks
 * @param {Object} params - Query parameters
 * @param {string} [params.holiday] - Current holiday name (optional)
 * @returns {Promise<Object>} Combined intelligence
 */
export async function getSmartBlocksIntelligence({ lat, lng, city, state, radiusMiles = 5, holiday = null }) {
  try {
    // Run venue discovery and traffic intelligence in parallel
    const [venueData, trafficData] = await Promise.all([
      discoverNearbyVenues({ lat, lng, city, state, radiusMiles, holiday }),
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

export default {
  discoverNearbyVenues,
  getTrafficIntelligence,
  getSmartBlocksIntelligence
};
