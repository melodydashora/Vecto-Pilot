// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 7/11).
// Owns: traffic_conditions section of the briefings row + briefing_traffic_ready
// pg_notify channel.
//
// Live path (in priority order):
//   1. TomTom Traffic API (if TOMTOM_API_KEY + lat/lng) — real-time incidents/jams,
//      analyzed by callModel('BRIEFING_TRAFFIC') for driver-focused strategic briefing.
//   2. Gemini 3 Pro fallback (if GEMINI_API_KEY) — Google Search-grounded traffic search.
//   3. Static fallbackTraffic object (if both providers fail).
//
// 2026-05-02: Workstream 6 commit 7 incorporates a hybrid drift resolution
// (see claude_memory #294 for Commit 4 dead-code precedent + Commit 5 airport
// private-helper precedent):
//   - analyzeTrafficWithAI was moved here as a private helper. The resume plan
//     §3 commit 7 wording flagged it as a potential cross-pollution bug ("two
//     BRIEFING_TRAFFIC LLM call sites with one inside the events code path"),
//     but the actual call graph showed analyzeTrafficWithAI's only caller is
//     fetchTrafficConditions (the live traffic path). It was misplaced in the
//     file (defined near events functions) but semantically a pure traffic
//     helper — same shape as airport's extractAirportJson (private helper
//     co-located with its only live caller).
//
// Side effects beyond pg_notify: the live path writes prioritized incidents
// (with lat/lng) to discovered_traffic for the StrategyMap incidents layer
// (PHASE F restore + PLAN G circuit breaker, see briefing-service.js comments).
//
// Logging tag: [BRIEFING][TRAFFIC] (per the 9-stage taxonomy enforcement
// principle — the file location IS the taxonomy declaration).

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
import { db } from '../../../db/drizzle.js';
import { discovered_traffic } from '../../../../shared/schema.js';
import { getTomTomTraffic, fetchRawTraffic } from '../../traffic/tomtom.js';

/**
 * Analyze TomTom traffic data with AI for strategic, driver-focused summary.
 * 2026-01-15: Single Briefer Model Architecture - all briefing roles use Gemini Pro.
 * Uses BRIEFING_TRAFFIC_MODEL env var or defaults to Gemini 3 Pro Preview.
 *
 * Private helper of fetchTrafficConditions. Single caller; not exported.
 *
 * @param {Object} params - { tomtomData, rawTraffic, city, state, formattedAddress, driverLat, driverLon }
 * @returns {Promise<Object|null>} analyzed briefing object (with raw incident arrays
 *   preserved for STRATEGIST_ENRICHMENT) or null on failure (graceful — caller falls
 *   back to TomTom-only summary).
 */
async function analyzeTrafficWithAI({ tomtomData, rawTraffic, city, state, formattedAddress, driverLat, driverLon }) {
  // 2026-02-11: FIX - Route through callModel adapter (was direct GoogleGenAI SDK call)
  // This ensures thinkingLevel HIGH, safety settings, and JSON cleanup are applied
  // Model is resolved from BRIEFING_TRAFFIC registry role (gemini-3.1-pro-preview)

  const startTime = Date.now();
  matrixLog.info({
    category: 'BRIEFING',
    connection: 'AI',
    action: 'DISPATCH',
    roleName: 'BRIEFER',
    secondaryCat: 'TRAFFIC',
    location: 'pipelines/traffic.js:analyzeTrafficWithAI',
  }, 'Calling Briefer for traffic analysis');

  try {
    // Prepare incident data with distance information
    const stats = tomtomData.stats || {};
    const incidents = tomtomData.incidents || [];

    // Filter and prioritize: highway accidents/closures that affect strategy
    const highwayIncidents = incidents.filter(i => i.isHighway);
    const closures = incidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const accidents = incidents.filter(i => i.category === 'Accident');
    const jams = incidents.filter(i => i.category === 'Jam');

    // Build a strategic prompt focused on driver impact
    let prompt = `You are a traffic strategist for rideshare drivers. Analyze this traffic data and provide a STRATEGIC briefing.

DRIVER POSITION: ${city}, ${state} (${driverLat ? parseFloat(driverLat).toFixed(6) : 'N/A'},${driverLon ? parseFloat(driverLon).toFixed(6) : 'N/A'})
AREA: ${city}, ${state}

TRAFFIC OVERVIEW:
- Total incidents within 10 miles: ${stats.total || incidents.length}
- Highway incidents: ${highwayIncidents.length}
- Road closures: ${closures.length}
- Accidents: ${accidents.length}
- Traffic jams: ${jams.length}
- Congestion level: ${tomtomData.congestionLevel}

PRIORITY INCIDENTS (sorted by impact, with distance from driver):
${incidents.slice(0, 15).map((inc, i) => {
  const dist = inc.distanceFromDriver !== null ? `${inc.distanceFromDriver}mi` : '?';
  return `${i+1}. [${inc.category}] ${inc.road || 'Local road'}: ${inc.from || ''} → ${inc.to || ''} (${dist} away, ${inc.magnitude} severity, ${inc.delayMinutes || 0}min delay)`;
}).join('\n')}

HIGHWAY CLOSURES & ACCIDENTS (CRITICAL):
${[...closures.filter(c => c.isHighway), ...accidents.filter(a => a.isHighway)].slice(0, 8).map(c =>
  `- ${c.road}: ${c.location} [${c.distanceFromDriver !== null ? c.distanceFromDriver + 'mi' : '?'}] - ${c.category}`
).join('\n') || 'None on major highways'}`;

    // 2026-02-10: PHASE 3 INTELLIGENCE - Add Raw Telemetry
    if (rawTraffic) {
      prompt += `\n\n[PHASE 3 INTELLIGENCE - RAW TELEMETRY]
Use this raw data to find patterns invisible to standard aggregation:
FLOW DATA SAMPLE: ${JSON.stringify(rawTraffic.flow || {}, null, 2).slice(0, 1000)}...
RAW INCIDENT COUNT: ${rawTraffic.incidents?.length || 0}`;
    }

    prompt += `\n\nReturn ONLY a JSON object with this structure:
{
  "briefing": "2-3 sentences: (1) Overall traffic status with congestion level. (2) SPECIFIC highway/road issues that affect strategy with distances. (3) Recommended action or route adjustments. Be CONCISE and STRATEGIC.",
  "keyIssues": [
    "Highway/Road + issue + distance + impact (e.g., 'I-35 accident 3.2mi north - 15min delays')",
    "Highway/Road + issue + distance + impact",
    "Highway/Road + issue + distance + impact"
  ],
  "avoidAreas": [
    "Area/corridor to avoid: reason with distance",
    "Area/corridor to avoid: reason with distance"
  ],
  "driverImpact": "One strategic sentence: How this affects rideshare operations RIGHT NOW - best areas vs areas to avoid",
  "closuresSummary": "X closures within 10mi, most critical: [list top 2]",
  "constructionSummary": "Construction zones summary if any significant"
}

Focus on ACTIONABLE intelligence: what should the driver DO based on this traffic?`;

    const system = 'You are a traffic strategist for rideshare drivers. Return ONLY valid JSON with no preamble.';

    // 2026-02-11: Use callModel adapter - picks up thinkingLevel HIGH + safety settings from registry
    const result = await callModel('BRIEFING_TRAFFIC', { system, user: prompt });

    if (!result.ok) {
      matrixLog.error({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'TRAFFIC',
        location: 'pipelines/traffic.js:analyzeTrafficWithAI',
      }, 'Briefer call failed', result.error);
      return null;
    }

    const content = (result.output || result.text || '').trim();

    // Parse JSON from response (adapter handles code block cleanup, but double-check)
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonMatch = codeBlockMatch[1].match(/\{[\s\S]*\}/);
      }
    }

    if (!jsonMatch) {
      matrixLog.warn({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'PARSE',
        roleName: 'BRIEFER',
        secondaryCat: 'TRAFFIC',
        location: 'pipelines/traffic.js:analyzeTrafficWithAI',
      }, `Briefer returned non-JSON (${content.length} chars)`);
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    const elapsedMs = Date.now() - startTime;
    matrixLog.info({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'TRAFFIC',
      location: 'pipelines/traffic.js:analyzeTrafficWithAI',
    }, `Briefer traffic analysis complete (${elapsedMs}ms)`);

    // 2026-04-11: STRATEGIST ENRICHMENT — additive changes to preserve the raw
    // TomTom incident/closure arrays alongside Gemini's analyzed strings. The
    // consolidator's formatTrafficIntelForStrategist helper reads these structured
    // fields to build the enriched TRAFFIC block (with road names, distances,
    // severity, and congestion level). Legacy briefings written before this change
    // will lack these fields — the strategist falls back gracefully to the
    // existing keyIssues[] / avoidAreas[] / driverImpact strings.
    //
    // See server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md section 6 for
    // the design rationale and graceful-degradation ladder.
    return {
      // Existing Gemini-analyzed fields (unchanged)
      briefing: analysis.briefing,
      headline: analysis.briefing?.split('.')[0] + '.' || analysis.headline,
      keyIssues: analysis.keyIssues || [],
      avoidAreas: analysis.avoidAreas || [],
      driverImpact: analysis.driverImpact,
      closuresSummary: analysis.closuresSummary,
      constructionSummary: analysis.constructionSummary,
      analyzedAt: new Date().toISOString(),
      provider: 'BRIEFING_TRAFFIC',

      // NEW (2026-04-11 additive): raw TomTom data preserved for strategist enrichment.
      // Each incident has: road, category, distanceFromDriver, isHighway, magnitude,
      // delayMinutes, from, to, location — a subset of the TomTom fields already used
      // in Gemini's prompt above. Sliced to keep the JSONB column size bounded.
      incidents: incidents.slice(0, 20),
      closures: closures.slice(0, 10),
      highwayIncidents: highwayIncidents.slice(0, 10),
      congestionLevel: tomtomData.congestionLevel || 'unknown',
      highDemandZones: tomtomData.highDemandZones || []
    };
  } catch (err) {
    briefingLog.warn(1, `BRIEFING_TRAFFIC analysis failed: ${err.message}`, OP.AI);
    return null;
  }
}

/**
 * Fetch traffic conditions for a snapshot.
 *
 * Two-provider fallback chain:
 *   1. TomTom (real-time incidents) → analyzeTrafficWithAI (driver-focused briefing)
 *   2. Gemini 3 Pro with Google Search (fallback if TomTom unavailable/fails)
 *   3. Static fallbackTraffic object (last resort if both providers fail)
 *
 * Side effect: writes prioritized incidents with lat/lng to discovered_traffic
 * (PHASE F + PLAN G circuit breaker for the StrategyMap incidents layer).
 *
 * Contract: never throws on graceful path — internal try/catch returns either
 * an analyzed traffic object, the Gemini fallback, or the static fallback.
 * The wrapping `discoverTraffic` adds defensive errorMarker handling for
 * unexpected throws.
 *
 * @param {{ snapshot: object }} args
 * @returns {Promise<Object>} traffic conditions object (never null)
 */
export async function fetchTrafficConditions({ snapshot }) {
  // Require valid location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data in snapshot - cannot fetch traffic', OP.AI);
    return {
      summary: 'Traffic data unavailable — snapshot missing city, state, or timezone',
      briefing: 'Traffic analysis could not be performed because location data is incomplete.',
      incidents: [],
      congestionLevel: 'unknown',
      reason: 'Snapshot missing required location data (city/state/timezone)'
    };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const lat = snapshot.lat;
  const lng = snapshot.lng;
  const timezone = snapshot.timezone;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // Default fallback traffic data — NO NULLS: every field has a typed value + reason
  const fallbackTraffic = {
    summary: `Traffic data for ${city}, ${state} could not be retrieved from any provider`,
    briefing: `Traffic analysis for ${city}, ${state} is temporarily unavailable. Both TomTom and Gemini providers failed to return data.`,
    incidents: [],
    congestionLevel: 'unknown',
    highDemandZones: [],
    repositioning: 'No repositioning data available — traffic providers unreachable',
    surgePricing: false,
    safetyAlert: 'Unable to check for safety alerts — traffic data unavailable',
    fetchedAt: new Date().toISOString(),
    isFallback: true,
    reason: `Traffic providers (TomTom + Gemini) both failed for ${city}, ${state}`
  };

  // TRY TOMTOM FIRST (if configured + has coordinates) - real-time traffic data
  if (process.env.TOMTOM_API_KEY && lat && lng) {
    try {
      // 2026-02-10: PHASE 3 HARDENING - Fetch RAW traffic for AI analysis
      // This enables the "Briefer Model" to see patterns invisible to standard aggregation
      const rawTraffic = await fetchRawTraffic(lat, lng, 10 * 1609); // 10 miles in meters

      const tomtomResult = await getTomTomTraffic({
        lat,
        lon: lng,
        city,
        state,
        radiusMiles: 15,        // 15-mile bounding box for API query
        maxDistanceMiles: 10    // Filter to 10 miles from driver's actual position
      });

      if (tomtomResult.traffic && !tomtomResult.error) {
        // Map TomTom congestion levels to our format
        const congestionMap = {
          'light': 'low',
          'moderate': 'medium',
          'heavy': 'high',
          'unknown': 'medium'
        };

        const traffic = tomtomResult.traffic;
        const formattedAddress = snapshot?.formatted_address || `${city}, ${state}`;

        // Analyze traffic with AI for strategic, driver-focused briefing
        // Uses configured model (default: Gemini Flash - fast & cost-effective)
        // 2026-02-10: Pass rawTraffic for Phase 3 analysis
        const analysis = await analyzeTrafficWithAI({
          tomtomData: traffic,
          rawTraffic,
          city,
          state,
          formattedAddress,
          driverLat: lat,
          driverLon: lng
        });

        // Format incidents for display (prioritized, within 10mi)
        // 2026-04-29: PHASE F RESTORE — incidentLat/incidentLon must be preserved here
        // so the StrategyMap incidents layer can plot triangle markers. The TomTom
        // parser at server/lib/traffic/tomtom.js already extracts these from
        // inc.geometry.coordinates; they were being silently dropped at this shaping
        // step, which is the regression that disabled the map's incident layer.
        const prioritizedIncidents = traffic.incidents.slice(0, 10).map(inc => ({
          description: inc.displayDescription || `${inc.category}: ${inc.location}`,
          severity: inc.magnitude === 'Major' ? 'high' : inc.magnitude === 'Moderate' ? 'medium' : 'low',
          category: inc.category,
          road: inc.road,
          location: inc.location,
          isHighway: inc.isHighway,
          priority: inc.priority,
          delayMinutes: inc.delayMinutes,
          lengthMiles: inc.lengthMiles,
          distanceFromDriver: inc.distanceFromDriver,  // Distance in miles from driver's position
          incidentLat: inc.incidentLat ?? null,
          incidentLon: inc.incidentLon ?? null
        }));

        // 2026-04-29: Plan G — write incidents-with-coords to discovered_traffic
        // cache table (circuit breaker against the Phase F regression class).
        // Best-effort: failure here is logged but does not break the briefing
        // path. The Phase F render path (briefingData.traffic.incidents) is
        // unchanged; this write is purely additive for the API consumer.
        if (snapshot?.snapshot_id && snapshot?.device_id) {
          const incidentsWithCoords = prioritizedIncidents.filter(
            (inc) => inc.incidentLat != null && inc.incidentLon != null && inc.category
          );
          if (incidentsWithCoords.length > 0) {
            try {
              const rows = incidentsWithCoords.map((inc, idx) => ({
                snapshot_id: snapshot.snapshot_id,
                device_id: snapshot.device_id,
                // TomTom doesn't expose a stable id at this layer; synthesize one
                // from coords + category that's stable for the same incident across
                // duplicate fetches but unique across distinct incidents.
                incident_id: inc.incidentId || `${inc.category}|${inc.incidentLat.toFixed(5)}|${inc.incidentLon.toFixed(5)}|${idx}`,
                category: inc.category,
                severity: inc.severity,
                description: inc.description ?? null,
                road: inc.road ?? null,
                location: inc.location ?? null,
                is_highway: !!inc.isHighway,
                delay_minutes: inc.delayMinutes ?? null,
                length_miles: inc.lengthMiles ?? null,
                distance_miles: inc.distanceFromDriver ?? null,
                lat: inc.incidentLat,
                lng: inc.incidentLon,
                raw_payload: inc,
              }));
              // ON CONFLICT DO NOTHING: per-snapshot dedup via UNIQUE (snapshot_id, incident_id)
              await db.insert(discovered_traffic).values(rows).onConflictDoNothing();
            } catch (writeErr) {
              briefingLog(OP.BRIEFING, `[traffic-cache] discovered_traffic write failed (non-fatal): ${writeErr?.message || writeErr}`);
            }
          }
        }

        // Separate closures for expandable section (also filtered by distance)
        const allClosures = (traffic.allIncidents || traffic.incidents)
          .filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed')
          .map(c => ({
            road: c.road,
            location: c.location,
            isHighway: c.isHighway,
            severity: c.magnitude === 'Major' ? 'high' : c.magnitude === 'Moderate' ? 'medium' : 'low',
            distanceFromDriver: c.distanceFromDriver
          }));

        return {
          // AI analysis (strategic, driver-focused briefing)
          briefing: analysis?.briefing || traffic.summary,  // Full 2-3 sentence briefing
          headline: analysis?.headline || traffic.summary,  // First sentence (backwards compat)
          keyIssues: analysis?.keyIssues || [],
          avoidAreas: analysis?.avoidAreas || [],
          driverImpact: analysis?.driverImpact || null,
          closuresSummary: analysis?.closuresSummary || `${traffic.closures} road closures`,
          constructionSummary: analysis?.constructionSummary || null,

          // Legacy summary for backwards compatibility
          summary: analysis?.briefing || analysis?.headline || traffic.summary,

          // Prioritized incidents (top 10 by impact) - for collapsed "Active Incidents" section
          incidents: prioritizedIncidents,
          incidentsCount: traffic.totalIncidents,

          // Expandable closures list
          closures: allClosures,
          closuresCount: allClosures.length,

          // Stats for UI display
          stats: traffic.stats || {
            total: traffic.totalIncidents,
            highways: 0,
            construction: 0,
            closures: traffic.closures,
            jams: traffic.jams,
            accidents: 0
          },

          congestionLevel: congestionMap[traffic.congestionLevel] || 'medium',
          totalIncidents: traffic.totalIncidents,
          jams: traffic.jams,
          highDemandZones: [],
          repositioning: analysis?.repositioning || 'No repositioning advice — see AI briefing above',
          surgePricing: traffic.congestionLevel === 'heavy',
          safetyAlert: traffic.jams > 3 ? `${traffic.jams} active traffic jams in the area` : 'No safety alerts at this time',
          fetchedAt: traffic.fetchedAt,
          provider: 'tomtom',
          analyzed: !!analysis
        };
      }

      briefingLog.warn(1, `TomTom traffic failed - trying Gemini`, OP.FALLBACK);
    } catch (tomtomErr) {
      briefingLog.warn(1, `TomTom traffic error: ${tomtomErr.message} - trying Gemini`, OP.FALLBACK);
    }
  }

  // GEMINI 3 PRO PREVIEW (SECONDARY) - uses Google Search grounding
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.warn(1, `No traffic providers available - using fallback traffic`, OP.AI);
    return fallbackTraffic;
  }

  briefingLog.ai(1, 'Gemini', `traffic for ${city}, ${state}`);

  const system = `You are a traffic intelligence assistant for rideshare drivers. Search for current traffic conditions and return structured JSON data.`;
  const user = `Search for current traffic conditions in ${city}, ${state} as of today ${date}. Return traffic data as JSON ONLY with ALL these fields:

{
  "summary": "One sentence about overall traffic status",
  "congestionLevel": "low" | "medium" | "high",
  "incidents": [{"description": "I-35 construction", "severity": "medium"}],
  "highDemandZones": [{"zone": "Downtown", "reason": "Event/Concert crowd"}],
  "repositioning": "Specific advice on where to reposition for surge opportunities",
  "surgePricing": true,
  "safetyAlert": "Any safety warnings for drivers"
}

CRITICAL: Include highDemandZones and repositioning.`;

  matrixLog.info({
    category: 'BRIEFING',
    connection: 'AI',
    action: 'DISPATCH',
    roleName: 'BRIEFER',
    secondaryCat: 'TRAFFIC',
    location: 'pipelines/traffic.js:fetchTrafficConditions',
  }, 'Calling Briefer for traffic conditions');
  // Uses BRIEFING_TRAFFIC role (Gemini with google_search)
  const result = await callModel('BRIEFING_TRAFFIC', { system, user });

  // Graceful fallback if Gemini fails (don't crash waterfall)
  if (!result.ok) {
    matrixLog.warn({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'TRAFFIC',
      location: 'pipelines/traffic.js:fetchTrafficConditions',
    }, 'Briefer traffic failed - using fallback', result.error);
    return fallbackTraffic;
  }

  try {
    const parsed = safeJsonParse(result.output);
    matrixLog.info({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'TRAFFIC',
      location: 'pipelines/traffic.js:fetchTrafficConditions',
    }, `Briefer traffic analysis complete: ${parsed.congestionLevel || 'unknown'} congestion`);

    return {
      summary: parsed.summary,
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      congestionLevel: parsed.congestionLevel || 'medium',
      highDemandZones: Array.isArray(parsed.highDemandZones) ? parsed.highDemandZones : [],
      repositioning: parsed.repositioning || null,
      surgePricing: parsed.surgePricing || false,
      safetyAlert: parsed.safetyAlert || null,
      fetchedAt: new Date().toISOString(),
      provider: 'gemini'
    };
  } catch (parseErr) {
    briefingLog.warn(1, `Gemini traffic parse failed - using fallback`, OP.FALLBACK);
    return fallbackTraffic;
  }
}

/**
 * Pipeline contract: discover traffic conditions for a snapshot.
 *
 * Calls fetchTrafficConditions (TomTom-first, Gemini-fallback chain), writes
 * traffic_conditions section to the briefings row, fires CHANNELS.TRAFFIC
 * pg_notify, returns { traffic_conditions, reason }.
 *
 * fetchTrafficConditions's internal try/catch handles all provider failures
 * and returns a fallback object — so the catch block here is defensive
 * against unexpected sync/import errors. The defense-in-depth `||`
 * short-circuit preserves exact parity with the orchestrator's prior
 * `r || {fallback}` SSE-write fallback.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone required)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ traffic_conditions: object, reason: string|null }>}
 */
export async function discoverTraffic({ snapshot, snapshotId }) {
  let traffic_conditions;
  let reason = null;

  try {
    traffic_conditions = await fetchTrafficConditions({ snapshot }) || {
      summary: 'No traffic data available for this area',
      incidents: [],
      congestionLevel: 'unknown',
      reason: 'Traffic data could not be retrieved'
    };
    reason = traffic_conditions?.reason || null;
    await writeSectionAndNotify(snapshotId, { traffic_conditions }, CHANNELS.TRAFFIC);
  } catch (err) {
    traffic_conditions = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { traffic_conditions }, CHANNELS.TRAFFIC);
    throw err;
  }

  return { traffic_conditions, reason };
}
