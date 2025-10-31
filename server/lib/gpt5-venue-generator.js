// server/lib/gpt5-venue-generator.js
// GPT-5 Venue Coordinate Generation for Smart Blocks
// Generates fresh venue coordinates within 15 mile radius based on consolidated strategy + precise location

import { callGPT5 } from './adapters/openai-gpt5.js';

/**
 * Generate venue recommendations with coordinates using GPT-5
 * @param {Object} params
 * @param {string} params.consolidatedStrategy - Final strategy from GPT-5 consolidator
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
  console.log(`[GPT-5 Venue Generator] Generating venues within ${maxDistance} miles of ${city}, ${state}...`);
  
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
7. Maximum 12 venues, prioritized by earnings potential

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

Generate 10-12 venue recommendations with precise coordinates. Focus on venues mentioned in the strategy (e.g., The Star, Legacy West, DFW Airport) plus additional high-value locations based on current conditions.

Return JSON only - no markdown, no explanation.`;

  try {
    const result = await callGPT5({
      developer: systemPrompt,
      user: userPrompt,
      max_completion_tokens: 4000
    });

    if (!result.text) {
      throw new Error('GPT-5 returned no text');
    }

    // Parse JSON response
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(result.text);
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = result.text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        // Try to find JSON object in text
        const jsonStart = result.text.indexOf('{');
        const jsonEnd = result.text.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          parsed = JSON.parse(result.text.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error('Could not extract JSON from GPT-5 response');
        }
      }
    }

    if (!parsed.venues || !Array.isArray(parsed.venues)) {
      throw new Error('GPT-5 response missing venues array');
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

    console.log(`[GPT-5 Venue Generator] ✅ Generated ${venues.length} venues`);
    
    return {
      venues,
      tokens: result.total_tokens,
      reasoning_tokens: result.reasoning_tokens
    };

  } catch (error) {
    console.error('[GPT-5 Venue Generator] Error:', error.message);
    throw error;
  }
}
