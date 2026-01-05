// server/lib/strategy/tactical-planner.js
// ============================================================================
// VENUE_SCORER ROLE - Tactical Venue Planner
// ============================================================================
//
// PURPOSE: Converts strategic overview into specific venue recommendations
//
// INPUT:
//   - strategy: "strategy_for_now" text (where to go RIGHT NOW)
//   - snapshot: Location/time context (lat, lng, city, state, timezone, etc.)
//
// OUTPUT:
//   - 4-6 venue recommendations with:
//     * Venue coordinates (lat/lng)
//     * Staging coordinates (where to park/wait)
//     * Category (airport, dining, hotel, etc.)
//     * Pro tips (2-3 per venue)
//     * Strategic timing (why go there NOW)
//   - Best central staging location
//   - Tactical summary
//
// ROLE: VENUE_SCORER via VENUE_SCORER_MODEL env var
// TIMEOUT: PLANNER_DEADLINE_MS (default 180s)
//
// CALLED BY: enhanced-smart-blocks.js
//
// ============================================================================

import { callModel } from "../ai/adapters/index.js";
import { z } from "zod";
import { safeJsonParse } from "../../api/utils/http-helpers.js";

// VENUE_SCORER response schema: venue coords + staging coords + category + district + pro tips
// Addresses, distances, and place details resolved via Google Places API (New) + Routes API (New)
// District field enables text search fallback when coord-based matching fails
const VenueRecommendationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  staging_lat: z.number().min(-90).max(90).optional(),  // Where to park/wait for this venue
  staging_lng: z.number().min(-180).max(180).optional(),
  staging_name: z.string().max(200).optional(),          // Name of staging location
  district: z.string().max(100).optional(),              // Shopping center, neighborhood, or area name (e.g., "Legacy West", "Deep Ellum")
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
  tactical_summary: z.string().min(10).max(1500)
});

/**
 * Generate tactical venue recommendations using VENUE_SCORER role
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

  console.log(`🏢 [VENUES 1/4 - Tactical Planner] Input: "${strategy.slice(0, 80)}..." at ${driverAddress}`);

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
    `You are an expert rideshare tactician for the ${location} region.`,
    "Your job: Convert the IMMEDIATE action plan into specific venues with EXACT COORDINATES.",
    "",
    "🎯 MISSION: Where should this driver go RIGHT NOW (next 1-2 hours) to maximize earnings?",
    "",
    "CRITICAL REQUIREMENTS:",
    "1. EVERY venue MUST have TWO sets of coordinates:",
    "   - Venue coords (lat/lng): The actual destination/entrance",
    "   - Staging coords (staging_lat/staging_lng): Where to park/wait for this specific venue",
    "2. Provide 4-6 SPECIFIC venue names (not districts or areas)",
    "3. Include category + 2-3 tactical pro tips per venue (pickup zones, positioning, timing)",
    "4. Focus on venues with ACTIVE demand RIGHT NOW or within the next hour",
    "5. Include DISTRICT for venues in shopping centers, entertainment districts, or named areas",
    "   - Use the local district/neighborhood name where the venue is located",
    "   - This helps accurately locate venues when multiple businesses share similar names",
    "",
    "VENUE SELECTION (RIGHT NOW FOCUS):",
    `- ONLY recommend venues near ${location} with current or imminent demand`,
    "- Prioritize: venues that are OPEN NOW or opening within 30 minutes",
    "- Consider: rush hour patterns, lunch/dinner timing, event let-outs",
    "- Use REAL, SPECIFIC venue names (actual business names from Maps)",
    "- Each venue = specific business, building, or landmark with GPS coordinates",
    "- Venues MUST be spread 2-3 minutes drive apart (different locations)",
    "",
    "STAGING LOCATIONS:",
    "- EACH venue needs staging coords (nearby parking lot, safe waiting spot)",
    "- PLUS one central staging point within 2 min drive of ALL venues",
    "- Prioritize free parking lots, gas stations, hotel front drives",
    "",
    "STRATEGIC TIMING:",
    "- If a venue opens soon, include strategic_timing: 'Opens in 30 min - position early'",
    "- If event ending: 'Concert ends 10 PM - arrive 9:45 for surge'",
    "- Google APIs will verify hours - you explain the tactical WHY",
    "",
    "OUTPUT FORMAT (JSON only):",
    "{",
    '  "recommended_venues": [',
    '    {',
    '      "name": "Specific Venue Name",',
    '      "lat": 00.0000,',
    '      "lng": -00.0000,',
    '      "staging_lat": 00.0000,',
    '      "staging_lng": -00.0000,',
    '      "staging_name": "Nearby parking lot name",',
    '      "district": "Shopping center or neighborhood name where venue is located",',
    '      "category": "airport|entertainment|shopping|dining|sports_venue|transit_hub|hotel|nightlife|event_venue|other",',
    '      "pro_tips": ["Pickup zone tip", "Positioning tip", "Timing tip"],',
    '      "strategic_timing": "Why now (if relevant)"',
    '    }',
    '  ],',
    '  "best_staging_location": {',
    '    "name": "Central Staging Spot",',
    '    "lat": 00.0000,',
    '    "lng": -00.0000,',
    '    "reason": "Why this position works"',
    '  },',
    '  "tactical_summary": "Go to X now because Y - expect Z rides in next hour"',
    "}"
  ].join("\n");

  // Build user prompt - include current date/time for business hours
  const user = [
    "CURRENT DATE/TIME:",
    `${dayName}, ${dateStr} at ${timeStr}`,
    "",
    "🎯 IMMEDIATE ACTION PLAN (What to do RIGHT NOW):",
    strategy,
    "",
    "DRIVER CURRENT LOCATION:",
    `${snapshot?.formatted_address || `${snapshot?.city}, ${snapshot?.state}` || 'unknown'}`,
    `GPS: ${snapshot?.lat}, ${snapshot?.lng}`,
    "",
    "YOUR TASK:",
    "Convert the immediate action plan above into 4-6 SPECIFIC venues with exact coordinates.",
    "Focus on venues with ACTIVE demand RIGHT NOW (not future events).",
    "All venues must be within 15 miles of driver's current GPS coordinates.",
    "",
    "Return JSON with venue coords, staging coords, category, pro tips, and tactical summary."
  ].join("\n");

  console.log(`🏢 [VENUES 1/4 - Tactical Planner] Calling AI for venue recommendations...`);

  // Call VENUE_SCORER role with temperature instead of reasoning_effort
  const abortCtrl = new AbortController();

  // Use environment variable for timeout (increased to 180s for per-venue staging coords)
  const timeoutMs = Number(process.env.PLANNER_DEADLINE_MS || process.env.GPT5_TIMEOUT_MS || 180000);

  const timeout = setTimeout(() => {
    console.error(`[VENUE_SCORER] ⏱️ Request timed out after ${timeoutMs}ms (${Math.round(timeoutMs/1000)}s)`);
    abortCtrl.abort();
  }, timeoutMs);
  
  try {
    const rawResponse = await callModel('VENUE_SCORER', {
      system: developer,
      user
    });

    const duration = Date.now() - startTime;

    // Parse JSON response
    const parsed = safeJsonParse(rawResponse.output);

    if (!parsed) {
      console.error('🏢 [VENUES 1/4 - Tactical Planner] ❌ Failed to parse JSON response');
      throw new Error('Invalid JSON response from AI');
    }

    // Validate response against schema
    const validation = GPT5ResponseSchema.safeParse(parsed);

    if (!validation.success) {
      console.error('🏢 [VENUES 1/4 - Tactical Planner] ❌ Validation failed:', validation.error.format());
      throw new Error(`AI response validation failed: ${validation.error.message}`);
    }

    const validated = validation.data;

    // Log each venue individually for clear tracing
    console.log(`🏢 [VENUES 1/4 - Tactical Planner] ✅ ${validated.recommended_venues.length} venues in ${duration}ms:`);
    validated.recommended_venues.forEach((v, i) => {
      const districtInfo = v.district ? ` @ ${v.district}` : '';
      console.log(`   ${i+1}. "${v.name}"${districtInfo} (${v.category}) at ${v.lat.toFixed(4)},${v.lng.toFixed(4)}`);
    });

    // Add rank to each venue and prepare final response
    const normalized = {
      recommended_venues: validated.recommended_venues.map((v, i) => ({
        ...v,
        rank: i + 1
      })),
      best_staging_location: validated.best_staging_location || null,
      tactical_summary: validated.tactical_summary,
      metadata: {
        model: process.env.STRATEGY_CONSOLIDATOR || "gpt-5.2",
        duration_ms: duration,
        venues_recommended: validated.recommended_venues.length,
        validation_passed: true
      }
    };

    return normalized;

  } catch (error) {
    console.error('🏢 [VENUES 1/4 - Tactical Planner] ❌ Error:', error.message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

