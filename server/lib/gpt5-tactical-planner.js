// server/lib/gpt5-tactical-planner.js
// GPT-5 Tactical Planner: Takes strategic overview → tactical venue recommendations
// Uses GPT-5 reasoning mode for deep tactical analysis

import { callGPT5 } from "./adapters/openai-gpt5.js";
import { z } from "zod";

// GPT-5 response schema: venue coords + staging coords + category + pro tips
// Addresses, distances, and place details resolved via Google Places API (New) + Routes API (New)
const VenueRecommendationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  staging_lat: z.number().min(-90).max(90).optional(),  // Where to park/wait for this venue
  staging_lng: z.number().min(-180).max(180).optional(),
  staging_name: z.string().max(200).optional(),          // Name of staging location
  category: z.enum(['airport', 'entertainment', 'shopping', 'dining', 'sports_venue', 'transit_hub', 'hotel', 'nightlife', 'event_venue', 'other']).or(z.string()),
  pro_tips: z.array(z.string().max(500)).min(1).max(3),
  strategic_timing: z.string().optional()       // Strategic reason to go (even if Google says closed): "Opens in 30 min", "Event at 7 PM" - no char limit for model-agnostic reasoning
});

const StagingLocationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  reason: z.string().max(500)
});

const GPT5ResponseSchema = z.object({
  recommended_venues: z.array(VenueRecommendationSchema).min(1).max(8),
  best_staging_location: StagingLocationSchema.optional(),
  tactical_summary: z.string().min(10).max(500)
});

/**
 * Generate tactical venue recommendations using GPT-5 reasoning
 * @param {Object} params
 * @param {string} params.strategy - AI-generated strategic overview
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
  const driverAddress = snapshot?.formatted_address || `${snapshot?.city}, ${snapshot?.state}` || 'unknown';
  
  console.log(`[TRIAD 2/3 - GPT-5 Planner] ========== INPUT DATA ==========`);
  console.log(`[TRIAD 2/3 - GPT-5 Planner] Strategy: "${strategy.slice(0, 150)}..."`);
  console.log(`[TRIAD 2/3 - GPT-5 Planner] Driver Address: ${driverAddress}`);

  // Get day name from dow
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = snapshot?.dow !== undefined ? dayNames[snapshot.dow] : 'unknown day';
  
  // Format date as MM/DD/YYYY
  const dateStr = snapshot?.created_at 
    ? new Date(snapshot.created_at).toLocaleDateString('en-US', { 
        timeZone: snapshot.timezone, // No fallback - timezone required
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    : 'unknown date';
  
  // Format time
  const timeStr = snapshot?.created_at
    ? new Date(snapshot.created_at).toLocaleTimeString('en-US', { 
        timeZone: snapshot.timezone, // No fallback - timezone required
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
    "Your job: Analyze the strategy and recommend specific venues with EXACT COORDINATES and tactical tips.",
    "",
    "CRITICAL REQUIREMENTS:",
    "1. EVERY venue MUST have TWO sets of coordinates:",
    "   - Venue coords (lat/lng): The actual destination/entrance",
    "   - Staging coords (staging_lat/staging_lng): Where to park/wait for this specific venue",
    "2. Provide 4-6 SPECIFIC venue names (not districts or areas)",
    "3. Include category + 2-3 tactical pro tips per venue (pickup zones, positioning, timing)",
    "4. Google APIs will handle addresses/distances - you only provide coords + strategy",
    "",
    "VENUE SELECTION:",
    `- Use REAL, SPECIFIC venues near ${location} (use actual venue names from Maps)`,
    "- For multi-location districts, pick ONE specific entrance/parking lot/building with exact coords",
    "- Example: Instead of 'The District' → 'Marriott Hotel at The District' with specific entrance coords",
    "- Each venue = specific business, building, or landmark with GPS coordinates",
    "- REQUIRED: Provide exact decimal coordinates in standard format",
    "- Venues MUST be spread 2-3 minutes drive apart (different locations/districts)",
    "- DO NOT recommend multiple venues in same building/complex",
    "",
    "STAGING LOCATIONS:",
    "- EACH venue needs its own staging coords (nearby parking lot, safe waiting spot)",
    "- PLUS one central staging point (best_staging_location) within 2 min drive of ALL venues",
    "- Prioritize free parking lots, gas stations, safe pull-offs, hotel front drives",
    "",
    "STRATEGIC TIMING:",
    "- If recommending a venue that might be closed now, provide strategic timing reason",
    "- Examples: 'Opens in 30 min', 'Event starts at 7 PM', 'Late night demand picks up at midnight'",
    "- Google APIs will check actual business hours - you provide the strategic WHY",
    "",
    "OUTPUT FORMAT (JSON only):",
    "{",
    '  "recommended_venues": [',
    '    {',
    '      "name": "Specific Venue Name",',
    '      "lat": 00.0000,  // Venue entrance/main location (exact decimal coordinates)',
    '      "lng": -00.0000,',
    '      "staging_lat": 00.0000,  // Where to park/stage for this venue',
    '      "staging_lng": -00.0000,',
    '      "staging_name": "Nearby parking lot/safe spot name",',
    '      "category": "airport|entertainment|shopping|dining|sports_venue|transit_hub|hotel|nightlife|event_venue|other",',
    '      "pro_tips": ["Pickup zone strategy", "Where to position", "Timing/demand insight"],',
    '      "strategic_timing": "Opens in 30 min - position early"  // Strategic reason (if venue might be closed)',
    '    }',
    '  ],',
    '  "best_staging_location": {',
    '    "name": "Central Staging Location Name",',
    '    "lat": 00.0000,',
    '    "lng": -00.0000,',
    '    "reason": "Why this central position works for all venues"',
    '  },',
    '  "tactical_summary": "Brief 1-2 sentence action plan"',
    "}"
  ].join("\n");

  // Build user prompt - include current date/time for business hours
  const user = [
    "CURRENT DATE/TIME:",
    `${dayName}, ${dateStr} at ${timeStr}`,
    "",
    "STRATEGIC OVERVIEW:",
    strategy,
    "",
    "DRIVER CURRENT LOCATION (GPS):",
    `${snapshot?.formatted_address || `${snapshot?.city}, ${snapshot?.state}` || 'unknown'}`,
    `Coordinates: ${snapshot?.lat}, ${snapshot?.lng}`,
    "",
    "CRITICAL: Generate venues near the driver's CURRENT coordinates above.",
    "Do NOT generate venues where the strategy suggests repositioning to - only near current location.",
    "The strategy may suggest moving to another area, but your job is to show tactical options from where they are NOW.",
    "",
    "What specific venues near the driver's current location should they target? Return JSON with coords + category + tips + strategic timing."
  ].join("\n");

  console.log(`[TRIAD 2/3 - GPT-5 Planner] Calling GPT-5 (using default temperature - GPT-5 doesn't support custom temperature)...`);

  // Call GPT-5 with temperature instead of reasoning_effort
  const abortCtrl = new AbortController();
  
  // Use environment variable for timeout (increased to 180s for per-venue staging coords)
  const timeoutMs = Number(process.env.PLANNER_DEADLINE_MS || process.env.GPT5_TIMEOUT_MS || 180000);
  
  const timeout = setTimeout(() => {
    console.error(`[GPT-5 Tactical Planner] ⏱️ Request timed out after ${timeoutMs}ms (${Math.round(timeoutMs/1000)}s)`);
    abortCtrl.abort();
  }, timeoutMs);
  
  try {
    const rawResponse = await callGPT5({
      developer,
      user,
      // CRITICAL: GPT-5 reasoning mode uses unpredictable amounts for thinking
      // Even with minimal prompt, it can use 6144+ tokens for reasoning
      // Must provide generous budget: 16384 allows ~10K reasoning + ~6K output
      max_completion_tokens: parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS || '16384'),
      abortSignal: abortCtrl.signal
    });

    const duration = Date.now() - startTime;
    console.log(`✅ [GPT-5 Tactical Planner] Generated plan in ${duration}ms (${rawResponse.total_tokens} tokens)`);

    // Parse JSON response
    const parsed = safeJsonParse(rawResponse.text);
    
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
      tips_count: v.pro_tips.length
    })));

    // Add rank to each venue and prepare final response
    const normalized = {
      recommended_venues: validated.recommended_venues.map((v, i) => ({
        ...v,
        rank: i + 1
      })),
      best_staging_location: validated.best_staging_location || null,
      tactical_summary: validated.tactical_summary,
      metadata: {
        model: process.env.OPENAI_MODEL || "gpt-5.1",
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
