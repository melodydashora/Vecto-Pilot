// server/lib/venue-generator.js
// Model-Agnostic Venue Coordinate Generation for Smart Blocks
// Generates fresh venue coordinates within 15 mile radius based on consolidated strategy + precise location

import { callModel } from './adapters/index.js';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

/**
 * VALIDATION LAYER: Use Perplexity to verify venue coordinates are current & operational
 * This prevents stale/moved/closed venues from reaching drivers
 */
async function validateVenueCoordinates(venues, city, state) {
  if (!PERPLEXITY_API_KEY || venues.length === 0) {
    console.log('[Venue Generator] Skipping coordinate validation (no API key or venues)');
    return venues; // Return unvalidated if no Perplexity available
  }

  try {
    const venueList = venues.map(v => `- ${v.location_name} (${v.location_lat.toFixed(4)}, ${v.location_lng.toFixed(4)})`).join('\n');
    
    const prompt = `You are a rideshare venue verification system. Using current web knowledge, verify these venues are still operational in ${city}, ${state}:

${venueList}

For EACH venue, respond with ONLY valid JSON array:
[
  {
    "name": "Exact venue name",
    "status": "operational" | "closed" | "moved" | "unknown",
    "reason": "Brief reason if not operational (e.g., 'Permanently closed Dec 2024')"
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
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      console.warn(`[Venue Generator] Perplexity validation failed (${response.status}), returning unvalidated venues`);
      return venues;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[Venue Generator] Could not parse validation response, returning unvalidated venues');
      return venues;
    }

    const validations = JSON.parse(jsonMatch[0]);
    const validationMap = {};
    validations.forEach(v => {
      validationMap[v.name] = v.status;
    });

    // Filter venues based on validation
    const filtered = venues.filter(venue => {
      const status = validationMap[venue.location_name];
      if (status === 'operational') {
        return true; // Keep this venue
      } else if (status === 'closed' || status === 'moved') {
        console.warn(`[Venue Generator] ⚠️ FILTERING: "${venue.location_name}" - ${status} per Perplexity web search`);
        return false; // Remove this venue
      }
      // Keep unknowns (we only filter if we're confident it's problematic)
      return true;
    });

    console.log(`[Venue Generator] Coordinate validation: ${venues.length} venues → ${filtered.length} operational (filtered ${venues.length - filtered.length})`);
    return filtered;
  } catch (error) {
    console.error('[Venue Generator] Coordinate validation error:', error.message);
    return venues; // Return unvalidated on error
  }
}

/**
 * Generate venue recommendations with coordinates using model-agnostic venue generator
 * @param {Object} params
 * @param {string} params.consolidatedStrategy - Final strategy from consolidator
 * @param {number} params.driverLat - Driver's precise latitude
 * @param {number} params.driverLng - Driver's precise longitude
 * @param {string} params.city - Driver's city
 * @param {string} params.state - Driver's state
 * @param {string} params.currentTime - Current time context
 * @param {string} params.weather - Weather conditions
 * @param {number} params.maxDistance - Maximum distance in miles (default: 15)
 * @returns {Promise<Array>} Array of venue objects with coords, names, pro_tips, staging, etc.
 */
export async function generateVenueCoordinates({
  consolidatedStrategy,
  driverLat,
  driverLng,
  city,
  state,
  currentTime,
  weather,
  maxDistance = 15
}) {
  console.log(`[Venue Generator] Generating venues within ${maxDistance} miles of ${city}, ${state}...`);
  
  const systemPrompt = `You are a rideshare venue intelligence system. Generate specific venue recommendations with precise GPS coordinates.

CRITICAL REQUIREMENTS:
1. All venues MUST be within ${maxDistance} miles of the driver's location
2. Provide TWO sets of coordinates for each venue:
   - LOCATION coords: The actual venue/destination coordinates
   - STAGING coords: Safe pickup/waiting spot near the venue
3. Provide NAMES for both location and staging for Google Places API verification
4. Pro tips: Why go to this venue right now (specific to current conditions)
5. Staging tips: Where exactly to park/wait for pickups
6. Closed reasoning: If venue is outside business hours, explain why it's still valuable
7. EXACTLY 8 venues, no more, no less - prioritized by earnings potential

OUTPUT FORMAT (strict JSON):
{
  "venues": [
    {
      "location_name": "Exact venue name for Google Places API",
      "location_lat": 33.1234,
      "location_lng": -96.5678,
      "staging_name": "Nearby landmark/street for staging area",
      "staging_lat": 33.1235,
      "staging_lng": -96.5679,
      "category": "restaurant|entertainment|shopping|airport|stadium|hotel|bar|event_venue",
      "pro_tips": "Why go here NOW? Specific tactical advice for current time/conditions.",
      "staging_tips": "Exactly where to park/wait for best pickup access.",
      "closed_reasoning": "Strategic value if outside business hours (null if currently open)",
      "estimated_earnings": 25.50,
      "demand_level": "high|medium|low"
    }
  ]
}`;

  const userPrompt = `DRIVER LOCATION:
Coordinates: ${driverLat}, ${driverLng}
City: ${city}, ${state}
Current Time: ${currentTime}
Weather: ${weather}
Maximum Distance: ${maxDistance} miles

CONSOLIDATED STRATEGY:
${consolidatedStrategy}

Generate EXACTLY 8 venue recommendations with precise coordinates. Focus on venues mentioned in the strategy plus high-value locations based on current conditions.

CRITICAL: Return exactly 8 venues in the JSON array, no more, no less.
Return JSON only - no markdown, no explanation.`;

  try {
    // Call model-agnostic venue_generator role
    const result = await callModel("venue_generator", {
      system: systemPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      throw new Error('Venue generator model call failed');
    }

    // HARD VALIDATION: Ensure content was actually generated
    if (!result.output || result.output.trim().length < 20) {
      console.error('[Venue Generator] Empty or minimal content returned');
      throw new Error('empty_generation: Model returned no usable content');
    }
    
    console.log(`[Venue Generator] Generated ${result.output.length} chars of content`);

    // Parse JSON response
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(result.output);
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = result.output.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        // Try to find JSON object in text
        const jsonStart = result.output.indexOf('{');
        const jsonEnd = result.output.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          parsed = JSON.parse(result.output.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error('Could not extract JSON from model response');
        }
      }
    }

    if (!parsed.venues || !Array.isArray(parsed.venues)) {
      throw new Error('Model response missing venues array');
    }

    // Validate and clean venues
    const venues = parsed.venues.map((v, idx) => {
      // Required: location coords, staging coords, and names for both
      if (!v.location_name || !v.location_lat || !v.location_lng) {
        console.warn(`[GPT-5 Venue Generator] Skipping venue ${idx} - missing location name/coords:`, v);
        return null;
      }

      if (!v.staging_name || !v.staging_lat || !v.staging_lng) {
        console.warn(`[GPT-5 Venue Generator] Skipping venue ${idx} - missing staging name/coords:`, v);
        return null;
      }

      // Validate coordinates are within bounds
      if (Math.abs(v.location_lat) > 90 || Math.abs(v.location_lng) > 180) {
        console.warn(`[GPT-5 Venue Generator] Skipping venue ${v.location_name} - invalid location coordinates`);
        return null;
      }

      if (Math.abs(v.staging_lat) > 90 || Math.abs(v.staging_lng) > 180) {
        console.warn(`[GPT-5 Venue Generator] Skipping venue ${v.location_name} - invalid staging coordinates`);
        return null;
      }

      return {
        location_name: v.location_name.trim(),
        location_lat: parseFloat(v.location_lat),
        location_lng: parseFloat(v.location_lng),
        staging_name: v.staging_name.trim(),
        staging_lat: parseFloat(v.staging_lat),
        staging_lng: parseFloat(v.staging_lng),
        category: v.category || 'general',
        pro_tips: v.pro_tips || null,
        staging_tips: v.staging_tips || v.staging_tip || null, // Support both field names
        closed_reasoning: v.closed_reasoning || null,
        estimated_earnings: v.estimated_earnings || null,
        demand_level: v.demand_level || 'medium'
      };
    }).filter(Boolean); // Remove nulls

    // CRITICAL: Cap at exactly 8 venues (16 coords: 8 location + 8 staging)
    let cappedVenues = venues.slice(0, 8);

    console.log(`[GPT-5 Venue Generator] ✅ Generated ${cappedVenues.length} venues (${cappedVenues.length * 2} coordinates)`);
    
    // VALIDATION: Use Perplexity to verify coordinates are current & operational
    cappedVenues = await validateVenueCoordinates(cappedVenues, city, state);
    
    if (cappedVenues.length < venues.length) {
      console.log(`[Venue Generator] ℹ️ After validation, ${cappedVenues.length} venues remain (${venues.length - cappedVenues.length} filtered for validity)`);
    }
    
    return {
      venues: cappedVenues,
      tokens: result.total_tokens,
      reasoning_tokens: result.reasoning_tokens
    };

  } catch (error) {
    console.error('[GPT-5 Venue Generator] Error:', error.message);
    throw error;
  }
}
