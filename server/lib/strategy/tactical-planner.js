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
//   - briefingContext: (optional) Filtered briefing data for enhanced recommendations
//     Contains today's events, traffic summary, weather, airport conditions
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
import { formatBriefingForPrompt } from "../briefing/filter-for-planner.js";

// VENUE_SCORER response schema: venue coords + staging coords + category + district + pro tips
// Addresses, distances, and place details resolved via Google Places API (New) + Routes API (New)
// District field enables text search fallback when coord-based matching fails
// 2026-02-19: lat/lng made nullable — GPT-5.2 sometimes returns null for all coords.
// Post-validation filtering removes venues without required coords (see below).
const VenueRecommendationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  staging_lat: z.number().min(-90).max(90).nullable().optional(),  // Where to park/wait for this venue
  staging_lng: z.number().min(-180).max(180).nullable().optional(),
  staging_name: z.string().max(200).optional(),          // Name of staging location
  district: z.string().max(100).optional(),              // Shopping center, neighborhood, or area name (e.g., "Legacy West", "Deep Ellum")
  category: z.enum(['airport', 'entertainment', 'shopping', 'dining', 'sports_venue', 'transit_hub', 'hotel', 'nightlife', 'event_venue', 'other']).or(z.string()),
  pro_tips: z.array(z.string().max(500)).min(1).max(3),
  strategic_timing: z.string().optional()       // Strategic reason to go (even if Google says closed): "Opens in 30 min", "Event at 7 PM" - no char limit for model-agnostic reasoning
});

const StagingLocationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  reason: z.string().max(500)
});

// 2026-02-19: min(0) allows empty array — post-validation filters out null-coord venues
const GPT5ResponseSchema = z.object({
  recommended_venues: z.array(VenueRecommendationSchema).min(0).max(8),
  best_staging_location: StagingLocationSchema.optional(),
  tactical_summary: z.string().min(10).max(1500)
});

/**
 * Generate tactical venue recommendations using VENUE_SCORER role
 *
 * 2026-01-31: Added briefingContext parameter for enhanced venue recommendations
 * When provided, includes today's events, traffic summary, and weather in the prompt
 * This helps the venue planner match venues to events and avoid congested areas
 *
 * @param {Object} params
 * @param {string} params.strategy - AI-generated strategic overview
 * @param {Object} params.snapshot - Context snapshot data
 * @param {Object} [params.briefingContext] - Optional filtered briefing data from filterBriefingForPlanner()
 * @returns {Promise<Object>} Tactical plan with venue recommendations
 */
export async function generateTacticalPlan({ strategy, snapshot, briefingContext }) {
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
    "4. Focus on venues with ACTIVE demand RIGHT NOW or within the next 2 hours",
    "   — Event venues WITHIN 15 MILES with shows starting in the next 2 hours count as ACTIVE demand",
    "   — Event venues WITHIN 15 MILES whose events end within the next hour also count (pickup surge window)",
    "   — Event venues beyond 15 miles are NOT candidates — they are surge flow intelligence only",
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
    "EVENT INTELLIGENCE (2026-04-11 REVERT — 15-mile rule is SUPREME):",
    "- Events listed in the user message are happening in your metro today. They are",
    "  INTELLIGENCE, not a venue list. The 15-mile rule OVERRIDES everything —",
    "  NEVER recommend a venue more than 15 miles from the driver, even for events.",
    "- Two buckets will appear in the user message:",
    "  → NEAR EVENTS (≤15 mi): These ARE candidate venues. If a near event is high-",
    "    impact and starting/ending within the next 2 hours, recommend the event venue",
    "    directly with event-specific pro_tips (pickup surge timing, post-show staging,",
    "    pre-show drop-off window).",
    "  → FAR EVENTS (>15 mi): SURGE FLOW INTELLIGENCE. DO NOT recommend these as",
    "    destinations — they violate the 15-mile rule. Use them to reason about demand",
    "    ORIGINATION: fans travel FROM hotels, residential areas, and dining clusters",
    "    near the driver TO those far venues. That outflow creates pickup demand WITHIN",
    "    15 mi of the driver (not at the event). Recommend the closest high-impact venues",
    "    within 15 mi that fans would depart from (hotels near freeway on-ramps, dining",
    "    hubs, residential/entertainment centers).",
    "- GOAL: Closest high-impact venues first. Examples of the RIGHT answer for a Plano/",
    "  Frisco driver: The Star in Frisco, Legacy West in Plano, Grandscape in The Colony,",
    "  Stonebriar Centre. The WRONG answer: AAC, Dickies Arena, Fair Park — these are",
    "  30-40+ mi away, they are intel about surge flow, not destinations.",
    "- WHEN NO EVENTS ARE LISTED: recommend 4-6 general venues as usual.",
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
  // 2026-01-31: Include briefingContext if provided for enhanced venue matching
  // 2026-04-11 (REVERT — owner direction): Section header rewritten AGAIN. The
  // earlier "event venues ARE the primary recommendations" framing turned out to
  // break the 15-mile rule by making VENUE_SCORER reach for distant event arenas
  // (AAC, Dickies) at the expense of closer high-impact venues (The Star, Legacy
  // West). The new framing is "event intelligence for surge-flow reasoning" —
  // events are DATA the model uses to understand demand flow, not a candidate
  // list. The 15-mile rule is enforced below as the supreme constraint.
  const briefingSection = briefingContext
    ? [
        "",
        "=== TODAY'S METRO CONTEXT (event intelligence for surge-flow reasoning; traffic issues) ===",
        formatBriefingForPrompt(briefingContext),
        ""
      ].join("\n")
    : "";

  const user = [
    "CURRENT DATE/TIME:",
    `${dayName}, ${dateStr} at ${timeStr}`,
    "",
    "🎯 IMMEDIATE ACTION PLAN (What to do RIGHT NOW):",
    strategy,
    briefingSection,
    "DRIVER CURRENT LOCATION:",
    `${snapshot?.formatted_address || `${snapshot?.city}, ${snapshot?.state}` || 'unknown'}`,
    `GPS: ${snapshot?.lat}, ${snapshot?.lng}`,
    "",
    "YOUR TASK:",
    "Convert the immediate action plan above into 4-6 SPECIFIC venues with exact coordinates.",
    "Focus on venues with ACTIVE demand RIGHT NOW — venues that are open, or have events starting/ending in the next 2 hours.",
    // 2026-04-11 (REVERT — owner direction): The previous "MUST include at least 2
    // event venues" framing broke the 15-mile rule. Restored: events are now
    // INTELLIGENCE for surge-flow reasoning. The 15-mile rule is the single supreme
    // constraint. Events within 15mi remain candidate venues; events beyond 15mi
    // describe where demand will flow (fans departing FROM residential/hotel areas
    // near the driver TO the far arena) — the driver earns at the departure end,
    // not at the event itself.
    briefingContext?.events?.length > 0
      ? [
          `EVENT INTELLIGENCE FOR TODAY (${briefingContext.events.length} events in your metro):`,
          `Events listed above are happening in your metro today. Use them to understand where`,
          `demand surges will come from. They are intelligence, NOT a venue list.`,
          ``,
          `HARD RULE: All venue recommendations MUST be within 15 miles of the driver. No exceptions.`,
          ``,
          `How to use the event data:`,
          `- If an event appears in the NEAR EVENTS bucket (≤15 mi), that venue IS a candidate.`,
          `  Prioritize it — recommend the event venue directly with event-specific pro_tips`,
          `  (time window, pickup surge prediction, pre-show drop-off, post-show staging).`,
          `- If events appear in the FAR EVENTS bucket (>15 mi), they are NOT destinations.`,
          `  Reason: fans travel FROM hotels, dining clusters, residential/entertainment hubs`,
          `  NEAR the driver TO those far venues. That outflow creates pickup demand WITHIN`,
          `  15 mi of the driver, not at the event. Recommend the closest high-impact venues`,
          `  in the driver's 15-mi radius that fans would depart from — hotels near freeway`,
          `  on-ramps heading toward the far event, dining hubs, residential/entertainment`,
          `  centers that pre-load for evening events.`,
          `- Closest high-impact venues WIN. Think The Star in Frisco, Legacy West in Plano,`,
          `  Grandscape in The Colony, Stonebriar Centre — venues that are genuinely near the`,
          `  driver AND will see event-driven surge. NOT AAC or Dickies Arena 30-40 mi away.`
        ].join("\n")
      : "Focus on venues with ACTIVE demand RIGHT NOW — dining, airport, hotels, shopping.",
    briefingContext?.traffic?.avoidAreas?.length > 0
      ? `AVOID areas with traffic issues: ${briefingContext.traffic.avoidAreas.join(', ')}.`
      : "",
    // 2026-04-11 (REVERT): Restored the single 15-mile hard rule. The previous split
    // (general ≤15mi, event ≤40mi) was wrong — it let VENUE_SCORER reach for distant
    // event arenas at the expense of closer high-impact venues. The 15-mile rule
    // applies uniformly to ALL recommendations, event venues included. Far events
    // stay in the prompt as surge-flow intel but are never valid destinations.
    "HARD DISTANCE RULE:",
    "- ALL venue recommendations MUST be within 15 miles of the driver's GPS coordinates.",
    "- This applies to event venues too. If an event is >15 mi away, it is NOT a valid",
    "  recommendation — it is intelligence about surge flow, not a destination.",
    "- Drivers need the CLOSEST high-impact venues first. A nearby venue that benefits",
    "  from distant-event outflow beats a distant venue every time.",
    "",
    "Return JSON with venue coords, staging coords, category, pro tips, and tactical summary."
  ].filter(Boolean).join("\n");

  console.log(`🏢 [VENUES 1/4 - Tactical Planner] Calling AI for venue recommendations...`);

  // 2026-04-11: Debug log — verify event data is reaching VENUE_SCORER. Dumps the
  // first 3 events as they appear in briefingContext so we can verify distance
  // annotation, data shape, and coord presence without a separate instrumentation
  // pass. After the 2026-04-11 revert (15-mile rule restored), the useful signal
  // is how many of the events are ≤15mi (candidates) vs >15mi (surge intel).
  const dbgEventCount = briefingContext?.events?.length || 0;
  if (dbgEventCount > 0) {
    // 2026-04-11 (revert): Count events in each bucket so logs show whether
    // NEAR-EVENT candidates exist (within 15mi — direct recommendation territory)
    // vs FAR-EVENT intel only (>15mi — surge-flow reasoning territory).
    const dbgNear = briefingContext.events.filter(
      e => e._distanceMiles != null && Number.isFinite(e._distanceMiles) && e._distanceMiles <= 15
    ).length;
    const dbgFar = briefingContext.events.filter(
      e => e._distanceMiles != null && Number.isFinite(e._distanceMiles) && e._distanceMiles > 15
    ).length;
    const dbgUnknown = dbgEventCount - dbgNear - dbgFar;
    console.log(
      `🏢 [VENUE_SCORER DEBUG] ${dbgEventCount} events in prompt ` +
      `(${dbgNear} near ≤15mi candidates, ${dbgFar} far >15mi surge intel` +
      (dbgUnknown > 0 ? `, ${dbgUnknown} unbucketed` : '') + `)`
    );
    const dbgSample = briefingContext.events.slice(0, 3).map(e => {
      const dist = e._distanceMiles != null && Number.isFinite(e._distanceMiles)
        ? `${e._distanceMiles.toFixed(1)}mi`
        : '?mi';
      const bucket = e._distanceMiles != null && Number.isFinite(e._distanceMiles)
        ? (e._distanceMiles <= 15 ? 'NEAR' : 'FAR')
        : '?';
      const coords = (e.vc_lat != null && e.vc_lng != null)
        ? `${Number(e.vc_lat).toFixed(4)},${Number(e.vc_lng).toFixed(4)}`
        : 'null';
      const venue = e.vc_venue_name || e.venue_name || '?';
      return `  - [${bucket}] "${e.title}" @ "${venue}" (${dist}, state=${e.state}, coords=${coords})`;
    });
    console.log(`🏢 [VENUE_SCORER DEBUG] First ${dbgSample.length} events (closest-first):\n${dbgSample.join('\n')}`);
  } else {
    console.log(`🏢 [VENUE_SCORER DEBUG] briefingContext has 0 events in prompt`);
  }

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

    // 2026-02-19: Filter out venues with null lat/lng (GPT-5.2 sometimes omits coords)
    const allVenues = validated.recommended_venues;
    const validVenues = allVenues.filter(v => v.lat != null && v.lng != null);
    if (validVenues.length < allVenues.length) {
      const dropped = allVenues.filter(v => v.lat == null || v.lng == null).map(v => v.name);
      console.warn(`🏢 [VENUES 1/4 - Tactical Planner] ⚠️ Dropped ${dropped.length} venues with null coords: ${dropped.join(', ')}`);
    }

    if (validVenues.length === 0) {
      console.error('🏢 [VENUES 1/4 - Tactical Planner] ❌ All venues had null coordinates');
      throw new Error('AI returned venues but all had null coordinates');
    }

    // Also filter staging location if coords are null
    const stagingLoc = validated.best_staging_location;
    const validStaging = (stagingLoc && stagingLoc.lat != null && stagingLoc.lng != null)
      ? stagingLoc : null;

    // Log each venue individually for clear tracing
    console.log(`🏢 [VENUES 1/4 - Tactical Planner] ✅ ${validVenues.length} venues in ${duration}ms:`);
    validVenues.forEach((v, i) => {
      const districtInfo = v.district ? ` @ ${v.district}` : '';
      console.log(`   ${i+1}. "${v.name}"${districtInfo} (${v.category}) at ${v.lat.toFixed(6)},${v.lng.toFixed(6)}`);
    });

    // Add rank to each venue and prepare final response
    const normalized = {
      recommended_venues: validVenues.map((v, i) => ({
        ...v,
        rank: i + 1
      })),
      best_staging_location: validStaging,
      tactical_summary: validated.tactical_summary,
      metadata: {
        model: process.env.STRATEGY_CONSOLIDATOR || "gpt-5.4",
        duration_ms: duration,
        venues_recommended: validVenues.length,
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

