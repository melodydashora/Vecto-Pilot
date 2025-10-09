// server/lib/gpt5-tactical-planner.js
// GPT-5 Tactical Planner: Takes Claude's strategy → tactical venue recommendations
// Uses GPT-5 reasoning mode for deep tactical analysis

import { callGPT5 } from "./adapters/openai-gpt5.js";
import { z } from "zod";

// Zod schema for GPT-5 response validation (address removed - will be resolved via Google Places)
const VenueRecommendationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(['airport', 'entertainment', 'shopping', 'dining', 'sports_venue', 'transit_hub', 'hotel', 'nightlife', 'event_venue', 'other']).or(z.string()),
  description: z.string().min(20).max(500),
  pro_tips: z.array(z.string().max(250)).min(1).max(4)
});

const StagingLocationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  reason: z.string().max(500)
});

const DBFieldsSchema = z.object({
  venue_table: z.array(z.string()),
  notes: z.string().optional()
});

const GPT5ResponseSchema = z.object({
  recommended_venues: z.array(VenueRecommendationSchema).min(1).max(10),
  best_staging_location: StagingLocationSchema.optional(),
  tactical_summary: z.string().min(10).max(1000),
  suggested_db_fields: DBFieldsSchema.optional()
});

/**
 * Generate tactical venue recommendations using GPT-5 reasoning
 * @param {Object} params
 * @param {string} params.strategy - Claude's strategic overview
 * @param {Object} params.snapshot - Context snapshot data
 * @returns {Promise<Object>} Tactical plan with venue recommendations
 */
export async function generateTacticalPlan({ strategy, snapshot }) {
  if (!strategy) {
    throw new Error("Strategy required for tactical planning");
  }
  
  if (!snapshot) {
    throw new Error("Snapshot required for tactical planning");
  }

  const startTime = Date.now();
  console.log(`[TRIAD 2/3 - GPT-5 Planner] ========== INPUT DATA ==========`);
  console.log(`[TRIAD 2/3 - GPT-5 Planner] Claude Strategy: "${strategy}"`);
  console.log(`[TRIAD 2/3 - GPT-5 Planner] Snapshot Context:`, {
    city: snapshot?.city,
    state: snapshot?.state,
    lat: snapshot?.lat,
    lng: snapshot?.lng,
    dayPart: snapshot?.day_part_key,
    weather: snapshot?.weather,
    airQuality: snapshot?.air
  });

  // Get day name from dow
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = snapshot?.dow !== undefined ? dayNames[snapshot.dow] : 'unknown day';
  
  // Format date as MM/DD/YYYY
  const dateStr = snapshot?.created_at 
    ? new Date(snapshot.created_at).toLocaleDateString('en-US', { 
        timeZone: snapshot.timezone || 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    : 'unknown date';
  
  // Format time
  const timeStr = snapshot?.created_at
    ? new Date(snapshot.created_at).toLocaleTimeString('en-US', { 
        timeZone: snapshot.timezone || 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'unknown time';

  // Build system/developer prompt - use driver's actual location
  const location = snapshot?.formatted_address 
    ? snapshot.formatted_address 
    : snapshot?.city && snapshot?.state 
      ? `${snapshot.city}, ${snapshot.state}` 
      : 'the local area';
  
  const developer = [
    `You are an expert rideshare strategist for the ${location} region.`,
    "Your job: Analyze the strategic overview and recommend specific venues/locations with highest earnings per mile.",
    "",
    "TASK:",
    "Based on the strategy, driver location, and context:",
    `1. Recommend 4-6 specific venues/locations to navigate to (real places near ${location})`,
    "2. Provide best staging location with exact address",
    "3. Include tactical pro tips for each venue (pickup zones, routing, positioning)",
    "",
    "IMPORTANT:",
    `- Use REAL, SPECIFIC venues near ${location} (e.g., "Dallas Love Field Airport", "American Airlines Center", "Northpark Center Mall")`,
    "- AVOID generic areas/districts (e.g., 'Downtown Dallas', 'The Star District', 'Uptown Area') - these won't resolve in Google Places",
    "- Each venue must be a specific business, building, or landmark that Google Places can verify",
    "- Provide ONLY exact coordinates and venue name - address will be resolved via Google Places API",
    "- Consider time of day, day of week, weather, events for venue selection",
    "- Focus on tactical positioning and routing advice in pro tips",
    "",
    "STAGING AREA CONSTRAINT (CRITICAL):",
    "- The staging location MUST be centrally positioned within 2 minutes drive of ALL recommended venues",
    "- Prioritize free parking lots, gas stations, or safe pull-off areas with good visibility",
    "- Driver should be able to reach ANY recommended venue within 1-2 minutes for quick ride capture",
    "- Position for minimal deadhead time and maximum response speed",
    "",
    "OUTPUT FORMAT (JSON only):",
    "{",
    '  "recommended_venues": [',
    '    {',
    '      "name": "Venue Name",',
    '      "lat": 32.xxxx,',
    '      "lng": -96.xxxx,',
    '      "category": "airport|entertainment|shopping|dining|sports_venue|transit_hub",',
    '      "description": "2-3 sentence narrative about venue type, typical crowd, ride patterns, and strategic value for current day/time",',
    '      "pro_tips": ["Pickup zone tip", "Routing tip", "Positioning tip"]',
    '    }',
    '  ],',
    '  "best_staging_location": {',
    '    "name": "Staging Location Name (parking lot, gas station, etc)",',
    '    "lat": 32.xxxx,',
    '    "lng": -96.xxxx,',
    '    "reason": "Why this central position enables 1-2 min response to all venues"',
    '  },',
    '  "tactical_summary": "2-3 sentence action plan",',
    '  "suggested_db_fields": {',
    '    "venue_table": ["field1", "field2", "..."],',
    '    "notes": "Recommended schema structure for storing these venues"',
    '  }',
    "}"
  ].join("\n");

  // Build user prompt with strategy + context
  const user = [
    "STRATEGIC OVERVIEW:",
    strategy,
    "",
    "DRIVER CONTEXT:",
    `Current Location: ${snapshot?.formatted_address || 'unknown'}`,
    `City: ${snapshot?.city || 'unknown'}, ${snapshot?.state || 'unknown'}`,
    `Coordinates: ${snapshot?.lat || '?'}, ${snapshot?.lng || '?'}`,
    `Date: ${dayName}, ${dateStr}`,
    `Time: ${timeStr}`,
    `Day Part: ${snapshot?.day_part_key || 'unknown'}`,
    `Weather: ${snapshot?.weather?.tempF || '?'}°F ${snapshot?.weather?.conditions || ''}`,
    `Air Quality: ${snapshot?.air?.aqi ? `AQI ${snapshot.air.aqi}` : 'unknown'}`,
    "",
    "Based on this strategic overview and driver context, recommend the best venues to navigate to right now.",
    "Select venues strategically positioned for current demand patterns.",
    "Provide exact coordinates and tactical routing/positioning tips (addresses will be resolved via API).",
    "Return JSON only."
  ].join("\n");

  const reasoningEffort = process.env.GPT5_REASONING_EFFORT || "medium"; // Default to medium
  console.log(`[TRIAD 2/3 - GPT-5 Planner] Calling GPT-5 with reasoning_effort=${reasoningEffort} (requires valid Claude strategy)...`);

  // Call GPT-5 with configurable reasoning effort
  const abortCtrl = new AbortController();
  const timeout = setTimeout(() => {
    console.error('[GPT-5 Tactical Planner] ⏱️ Request timed out after 5 minutes');
    abortCtrl.abort();
  }, 300000); // 5 min timeout for reasoning
  
  try {
    const rawResponse = await callGPT5({
      developer,
      user,
      reasoning_effort: reasoningEffort,
      max_completion_tokens: 32000, // Higher limit: reasoning tokens (~16K) + output tokens (~4K)
      abortSignal: abortCtrl.signal
    });

    const duration = Date.now() - startTime;
    console.log(`✅ [GPT-5 Tactical Planner] Generated plan in ${duration}ms`);

    // Parse JSON response
    const parsed = safeJsonParse(rawResponse);
    
    if (!parsed) {
      console.error('[GPT-5 Tactical Planner] Failed to parse JSON response');
      throw new Error('Invalid JSON response from GPT-5');
    }

    // Validate response against schema
    const validation = GPT5ResponseSchema.safeParse(parsed);
    
    if (!validation.success) {
      console.error('[GPT-5 Tactical Planner] ❌ Validation failed:', validation.error.format());
      console.error('[GPT-5 Tactical Planner] Raw response:', JSON.stringify(parsed, null, 2));
      throw new Error(`GPT-5 response validation failed: ${validation.error.message}`);
    }

    const validated = validation.data;
    console.log(`[TRIAD 2/3 - GPT-5 Planner] ========== OUTPUT DATA ==========`);
    console.log(`[TRIAD 2/3 - GPT-5 Planner] ✅ Validation passed: ${validated.recommended_venues.length} venues`);
    console.log(`[TRIAD 2/3 - GPT-5 Planner] Tactical Summary: "${validated.tactical_summary}"`);
    console.log(`[TRIAD 2/3 - GPT-5 Planner] Venues:`, validated.recommended_venues.map(v => ({
      name: v.name,
      category: v.category,
      lat: v.lat,
      lng: v.lng,
      description: v.description.slice(0, 100) + '...'
    })));
    console.log(`[TRIAD 2/3 - GPT-5 Planner] 📊 Suggested DB fields:`, JSON.stringify(validated.suggested_db_fields || {}));

    // Add rank to each venue and prepare final response
    const normalized = {
      recommended_venues: validated.recommended_venues.map((v, i) => ({
        ...v,
        rank: i + 1
      })),
      best_staging_location: validated.best_staging_location || null,
      tactical_summary: validated.tactical_summary,
      suggested_db_fields: validated.suggested_db_fields || null,
      metadata: {
        model: "gpt-5",
        reasoning_effort: "high",
        duration_ms: duration,
        venues_recommended: validated.recommended_venues.length,
        validation_passed: true
      }
    };

    console.log(`✅ [GPT-5 Tactical Planner] Returning ${normalized.recommended_venues.length} venue recommendations`);
    if (normalized.best_staging_location) {
      console.log(`📍 [GPT-5 Tactical Planner] Best staging: ${normalized.best_staging_location.name} at ${normalized.best_staging_location.lat}, ${normalized.best_staging_location.lng}`);
    }
    return normalized;

  } catch (error) {
    console.error('[GPT-5 Tactical Planner] Error:', error.message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Safe JSON parsing with fallback
 */
function safeJsonParse(text) {
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    
    // Try to find first balanced JSON object
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {}
        }
      }
    }
    
    return null;
  }
}
