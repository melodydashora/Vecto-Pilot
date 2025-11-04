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
 * @param {Object} params.snapshotData - Complete snapshot context data
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
  maxDistance = 15,
  snapshotData = {}
}) {
  console.log(`[GPT-5 Venue Generator] Generating TOP 3 priority venues aligned with strategy...`);
  
  const systemPrompt = `You are a rideshare venue intelligence system. Generate ONLY the TOP 3 HIGHEST PRIORITY venue recommendations that directly align with the consolidated strategy.

CRITICAL REQUIREMENTS:
1. ONLY 3 VENUES MAXIMUM - Choose the absolute highest priority locations
2. Venues MUST directly support the strategy's directive and timing
3. All venues MUST be within ${maxDistance} miles of the driver's location
4. Provide TWO sets of coordinates for each venue:
   - LOCATION coords: The actual venue/destination coordinates
   - STAGING coords: Safe pickup/waiting spot near the venue
5. Provide NAMES for both location and staging for Google Places API verification
6. Priority ranking: Rank 1-3 by immediate strategic value
7. Pro tips: Why this venue is a TOP PRIORITY right now
8. Staging tips: Where exactly to park/wait for pickups

PRIORITIZATION CRITERIA:
- Direct alignment with consolidated strategy directive
- Immediate earnings potential (next 30-60 minutes)
- Current demand level based on time/conditions
- Minimal dead time between rides
- Strategic positioning for follow-up rides

OUTPUT FORMAT (strict JSON):
{
  "venues": [
    {
      "priority_rank": 1,
      "location_name": "Exact venue name for Google Places API",
      "location_lat": 33.1234,
      "location_lng": -96.5678,
      "staging_name": "Nearby landmark/street for staging area",
      "staging_lat": 33.1235,
      "staging_lng": -96.5679,
      "category": "restaurant|entertainment|shopping|airport|stadium|hotel|bar|event_venue",
      "pro_tips": "Why this is TOP PRIORITY NOW - specific strategic value.",
      "staging_tips": "Exactly where to park/wait for best pickup access.",
      "closed_reasoning": "Strategic value if outside business hours (null if currently open)",
      "estimated_earnings": 25.50,
      "demand_level": "high|medium|low",
      "strategy_alignment": "How this directly supports the strategy"
    }
  ]
}`;

  const userPrompt = `DRIVER LOCATION:
Coordinates: ${driverLat}, ${driverLng}
City: ${city}, ${state}
Current Time: ${currentTime}
Weather: ${weather}
Maximum Distance: ${maxDistance} miles

SNAPSHOT CONTEXT:
Day Part: ${snapshotData.day_part || 'unknown'}
Day of Week: ${snapshotData.day_of_week || 'unknown'} ${snapshotData.is_weekend ? '(WEEKEND)' : ''}
Hour: ${snapshotData.hour || 'unknown'}:00
${snapshotData.is_holiday ? `Holiday: ${snapshotData.holiday}` : ''}
${snapshotData.airport_context ? `Airport: ${snapshotData.airport_context.airport_code} (${snapshotData.airport_context.distance_miles} miles)` : ''}

CONSOLIDATED STRATEGY:
${consolidatedStrategy}

CRITICAL INSTRUCTIONS:
1. Generate ONLY 3 venues - the absolute HIGHEST PRIORITY locations
2. Each venue MUST directly support the strategy's directive
3. Rank them 1-3 by immediate tactical value (next 30-60 minutes)
4. Focus on venues that minimize dead time and maximize earnings
5. Consider snapshot context (time, day, weather) for demand patterns

Return EXACTLY 3 venues in priority order.
Return JSON only - no markdown, no explanation.`;

  try {
    // CRITICAL: Bound to 1200 tokens to prevent length-based stops with 0 content
    const result = await callGPT5({
      developer: systemPrompt,
      user: userPrompt,
      max_completion_tokens: 1200,
      reasoning_effort: 'low' // Reduce reasoning tokens to prioritize content generation
    });

    // HARD VALIDATION: Ensure content was actually generated
    if (!result.text || result.text.trim().length < 20) {
      console.error('[GPT-5 Venue Generator] Empty or minimal content returned');
      throw new Error('empty_generation: GPT-5 returned no usable content');
    }
    
    console.log(`[GPT-5 Venue Generator] Generated ${result.text.length} chars of content`);

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
        priority_rank: v.priority_rank || idx + 1, // Use provided rank or default to order
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
        demand_level: v.demand_level || 'medium',
        strategy_alignment: v.strategy_alignment || null // New field for strategy alignment
      };
    }).filter(Boolean); // Remove nulls

    // CRITICAL: Cap at exactly 3 priority venues (6 coords: 3 location + 3 staging)
    const cappedVenues = venues.slice(0, 3);

    console.log(`[GPT-5 Venue Generator] ✅ Generated ${cappedVenues.length} HIGH-PRIORITY venues (${cappedVenues.length * 2} coordinates)`);
    console.log(`[GPT-5 Venue Generator] Priorities:`, cappedVenues.map(v => `#${v.priority_rank}: ${v.location_name}`).join(', '));
    
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
