// server/lib/venue-intelligence.js
// Real-time venue intelligence using GPT-5.1 for bar discovery
// Provides: bars/restaurants sorted by expense, filtered by operating hours, traffic context
// ML: Persists venue data with user corrections for feedback loop

import OpenAI from 'openai';
import { db } from '../db/drizzle.js';
import { nearby_venues } from '../../shared/schema.js';

// API Keys
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
  if (!OPENAI_API_KEY) {
    console.warn('[VenueIntelligence] OPENAI_API_KEY not set - returning empty venues');
    return {
      query_time: new Date().toLocaleTimeString(),
      location: `${city}, ${state}`,
      total_venues: 0,
      venues: [],
      last_call_venues: []
    };
  }
  
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
    console.log(`[VenueIntelligence] 🎯 Calling GPT-5.1 for venue discovery in ${city}, ${state}`);
    const response = await openai.chat.completions.create({
      model: 'gpt-5.1',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: 'json_object' }
    });
    const text = response.choices[0]?.message?.content || '';
    console.log(`[VenueIntelligence] ✅ GPT-5.1 venue discovery returned ${text.length} chars`);
    
    // Parse JSON response - handle both raw JSON and markdown-wrapped JSON
    let venueData;
    try {
      // Try direct parse first
      venueData = JSON.parse(text);
    } catch (e) {
      // Try to extract JSON from markdown code blocks (```json ... ```)
      let jsonStr = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
      if (!jsonStr) {
        // Fallback: try to extract raw JSON object
        jsonStr = text.match(/\{[\s\S]*\}$/)?.[0];
      }
      if (jsonStr) {
        venueData = JSON.parse(jsonStr.trim());
      } else {
        throw new Error('Could not parse venue data from Gemini response');
      }
    }

    // Add search source info if not already set
    if (!venueData.search_sources) {
      venueData.search_sources = ['Gemini AI analysis'];
    }

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
    console.error('[VenueIntelligence] Error discovering venues:', error.message);
    // FALLBACK: Return premium bar test data for Frisco area
    console.warn('[VenueIntelligence] 📍 Using fallback premium bar data for', city, state);
    return {
      query_time: new Date().toLocaleTimeString(),
      location: `${city}, ${state}`,
      total_venues: 5,
      venues: [
        {
          name: "The Mitchell",
          type: "bar",
          address: "2121 McKinney Ave, Dallas, TX 75201",
          phone: "(214) 720-7900",
          expense_level: "$$$$",
          expense_rank: 4,
          is_open: true,
          opens_in_minutes: null,
          hours_today: "5:00 PM - 2:00 AM",
          hours_full_week: { monday: "5pm-2am", tuesday: "5pm-2am", wednesday: "5pm-2am", thursday: "5pm-2am", friday: "5pm-3am", saturday: "5pm-3am", sunday: "5pm-2am" },
          closing_soon: false,
          minutes_until_close: null,
          was_filtered: false,
          crowd_level: "high",
          rideshare_potential: "high",
          lat: 32.7767,
          lng: -96.7970
        },
        {
          name: "Midnight Rambler",
          type: "bar",
          address: "1400 Main St, Dallas, TX 75202",
          phone: "(214) 939-7300",
          expense_level: "$$$$",
          expense_rank: 4,
          is_open: true,
          opens_in_minutes: null,
          hours_today: "5:00 PM - 2:00 AM",
          hours_full_week: { monday: "5pm-2am", tuesday: "5pm-2am", wednesday: "5pm-2am", thursday: "5pm-2am", friday: "5pm-3am", saturday: "5pm-3am", sunday: "5pm-2am" },
          closing_soon: false,
          minutes_until_close: null,
          was_filtered: false,
          crowd_level: "high",
          rideshare_potential: "high",
          lat: 32.7815,
          lng: -96.8051
        },
        {
          name: "Bowen House",
          type: "bar_restaurant",
          address: "2618 Main St, Dallas, TX 75204",
          phone: "(214) 741-1111",
          expense_level: "$$$",
          expense_rank: 3,
          is_open: true,
          opens_in_minutes: null,
          hours_today: "4:00 PM - 1:00 AM",
          hours_full_week: { monday: "4pm-1am", tuesday: "4pm-1am", wednesday: "4pm-1am", thursday: "4pm-1am", friday: "4pm-2am", saturday: "4pm-2am", sunday: "4pm-1am" },
          closing_soon: false,
          minutes_until_close: null,
          was_filtered: false,
          crowd_level: "high",
          rideshare_potential: "high",
          lat: 32.7859,
          lng: -96.8009
        },
        {
          name: "The Rustic",
          type: "bar_restaurant",
          address: "101 Throckmorton St, Fort Worth, TX 76102",
          phone: "(817) 810-4000",
          expense_level: "$$",
          expense_rank: 2,
          is_open: true,
          opens_in_minutes: null,
          hours_today: "5:00 PM - 2:00 AM",
          hours_full_week: { monday: "5pm-2am", tuesday: "5pm-2am", wednesday: "5pm-2am", thursday: "5pm-2am", friday: "5pm-3am", saturday: "5pm-3am", sunday: "5pm-2am" },
          closing_soon: false,
          minutes_until_close: null,
          was_filtered: false,
          crowd_level: "high",
          rideshare_potential: "medium",
          lat: 32.7555,
          lng: -97.3308
        },
        {
          name: "Uptown Tavern",
          type: "bar",
          address: "2800 Upland Ave, Dallas, TX 75204",
          phone: "(214) 220-1111",
          expense_level: "$$",
          expense_rank: 2,
          is_open: true,
          opens_in_minutes: null,
          hours_today: "4:00 PM - 1:00 AM",
          hours_full_week: { monday: "4pm-1am", tuesday: "4pm-1am", wednesday: "4pm-1am", thursday: "4pm-1am", friday: "4pm-2am", saturday: "4pm-2am", sunday: "4pm-1am" },
          closing_soon: false,
          minutes_until_close: null,
          was_filtered: false,
          crowd_level: "medium",
          rideshare_potential: "medium",
          lat: 32.7889,
          lng: -96.8034
        }
      ],
      last_call_venues: [],
      search_sources: ['Fallback premium bar data']
    };
  }
}

/**
 * Get traffic density for a specific area using robust Gemini adapter
 * @param {Object} params - Traffic query parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {string} params.city - City name
 * @returns {Promise<Object>} Traffic intelligence
 */
export async function getTrafficIntelligence({ lat, lng, city, state }) {
  const currentTime = new Date();
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const prompt = `Analyze CURRENT traffic conditions RIGHT NOW at coordinates (${lat}, ${lng}) in ${city}, ${state}.
Current time: ${timeString}

Provide real-time traffic intelligence:
1. Overall traffic density (1-10 scale, 10 = gridlock)
2. Major congestion areas and why (events, accidents, construction, commute patterns)
3. High-demand rideshare zones based on traffic patterns
4. Best positioning advice for drivers

Return ONLY valid JSON:
{
  "traffic_density": 7,
  "density_level": "high|medium|low",
  "congestion_areas": [{"area": "specific street", "reason": "detailed reason", "severity": 1-10}],
  "high_demand_zones": [{"zone": "area name", "why": "reason"}],
  "driver_advice": "actionable advice for drivers"
}`;

  try {
    console.log('[VenueIntelligence] 🚗 Calling Gemini 3 Pro Preview with google tool for traffic...');
    const result = await callGemini({
      model: 'gemini-3-pro-preview', // Always use 3-pro-preview with google tool
      system: 'You are a traffic intelligence system. Return ONLY valid JSON with no preamble.',
      user: prompt,
      maxTokens: 1500,
      temperature: 0.1
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const trafficData = JSON.parse(result.output);
    console.log('[VenueIntelligence] ✅ Parsed traffic JSON:', trafficData.density_level);

    // MAP TO UNIFIED SCHEMA for briefing-service compatibility
    return {
      summary: trafficData.driver_advice || '',
      congestionLevel: trafficData.density_level || 'low',
      incidents: (trafficData.congestion_areas || []).map(c => ({
        description: c.area + ': ' + c.reason,
        severity: c.severity ? (c.severity > 7 ? 'high' : c.severity > 3 ? 'medium' : 'low') : 'medium'
      })),
      highDemandZones: trafficData.high_demand_zones || [],
      driver_advice: trafficData.driver_advice || '',
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[VenueIntelligence] ❌ Traffic Error:', error.message);
    // Return safe fallback
    return {
      summary: 'Traffic data currently unavailable',
      congestionLevel: 'medium',
      incidents: [],
      highDemandZones: [],
      driver_advice: 'Traffic data currently unavailable',
      fetchedAt: new Date().toISOString()
    };
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
    console.log('[VenueIntelligence] getSmartBlocksIntelligence called:', { city, state, radiusMiles });
    
    // Run venue discovery and traffic intelligence in parallel
    const venuePromise = discoverNearbyVenues({ lat, lng, city, state, radiusMiles, holiday, timezone, localIso });
    const trafficPromise = getTrafficIntelligence({ lat, lng, city, state }).catch(err => {
      console.warn('[VenueIntelligence] Traffic intelligence failed:', err.message);
      return { density_level: 'unknown', high_demand_zones: [], driver_advice: '' };
    });

    const [venueData, trafficData] = await Promise.all([venuePromise, trafficPromise]);

    console.log('[VenueIntelligence] Combined intelligence ready:', { venues: venueData.total_venues, traffic: trafficData.density_level });

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
    console.error('[VenueIntelligence] Error getting combined intelligence:', error.message, error.stack);
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

    // Use onConflictDoNothing to make batch insert resilient to unique key violations
    const inserted = await db.insert(nearby_venues).values(records).onConflictDoNothing().returning();
    console.log(`[VenueIntelligence] Persisted ${inserted?.length || 0} venues to database`);
    return inserted || [];
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
