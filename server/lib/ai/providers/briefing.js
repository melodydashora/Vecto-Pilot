// server/lib/ai/providers/briefing.js
// ============================================================================
// BRIEFING PROVIDER - Phase 3 Intelligence Hardening
// ============================================================================
//
// ARCHITECTURE (2026-01-14):
//   - generateTrafficBriefing: TomTom + DB Context → Gemini 3 Pro
//   - runBriefing: Legacy wrapper for full briefing generation
//
// The "Briefer Model" pattern replaces fragile multi-model chains with a single
// Gemini call that receives verified ground-truth data from our database.
//
// ============================================================================

import { db } from '../../../db/drizzle.js';
import { snapshots } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateAndStoreBriefing } from '../../briefing/briefing-service.js';
import { briefingLog, OP } from '../../../logger/workflow.js';
import { fetchRawTraffic } from '../../traffic/tomtom.js';
import { getStrategistContext } from '../../briefing/context-loader.js';
import { callModel } from '../adapters/index.js';
import { z } from 'zod';

// ============================================================================
// TRAFFIC BRIEFING SCHEMA (Strict Output Validation)
// ============================================================================

const TrafficBriefingSchema = z.object({
  traffic_summary: z.string().describe('2-3 sentence summary of traffic conditions'),
  risk_level: z.enum(['low', 'medium', 'high', 'severe']).describe('Overall traffic risk'),
  top_incidents: z.array(z.object({
    description: z.string(),
    severity: z.string(),
    location: z.string()
  })).max(5).describe('Top 5 most impactful incidents'),
  recommended_departure_window: z.string().nullable().describe('Best time to depart, or null'),
  venue_correlations: z.array(z.string()).optional().describe('Traffic issues near specific venues'),
  event_correlations: z.array(z.string()).optional().describe('Traffic related to specific events')
});

// ============================================================================
// GENERATE TRAFFIC BRIEFING (Phase 3 Intelligence Hardening)
// ============================================================================

/**
 * Generate AI-powered traffic briefing using TomTom + DB context
 *
 * This is the new "Briefer Model" pattern:
 * 1. Fetch real-time traffic data from TomTom
 * 2. Load verified ground-truth from our database (bars, events)
 * 3. Send both to Gemini 3 Pro for correlation and analysis
 * 4. Validate output with Zod schema
 *
 * @param {number} lat - Driver latitude
 * @param {number} lng - Driver longitude
 * @param {string} city - City name
 * @param {string} state - State code
 * @returns {Promise<Object|null>} Validated traffic briefing or null on failure
 */
export async function generateTrafficBriefing(lat, lng, city, state) {
  const startTime = Date.now();
  briefingLog.phase(1, `Traffic briefing for ${city}, ${state}`, OP.AI);

  try {
    // 1. Parallel Fetch: Real-time Sensors (TomTom) + Internal Memory (DB)
    const [rawTraffic, context] = await Promise.all([
      fetchRawTraffic(lat, lng, 5000), // 5km radius
      getStrategistContext(city, state)
    ]);

    // If TomTom fails, we can't generate a traffic briefing
    if (!rawTraffic) {
      briefingLog.warn(1, 'TomTom data unavailable, skipping traffic briefing', OP.AI);
      return null;
    }

    // 2. Construct "Omniscient" Prompt
    // The LLM receives verified ground-truth so it doesn't need to hallucinate
    const systemPrompt = `You are the Vecto-Pilot Traffic Analyst.
Analyze this raw telemetry and database context to advise a rideshare driver.

[INTERNAL DATABASE INTEL - VERIFIED DATA]
Major Events Today: ${JSON.stringify(context.activeEvents || [], null, 2)}
Key High-Value Venues: ${JSON.stringify(context.topVenues || [], null, 2)}

[REAL-TIME TRAFFIC TELEMETRY FROM TOMTOM]
Flow Data: ${JSON.stringify(rawTraffic.flow, null, 2)}
Incidents: ${JSON.stringify(rawTraffic.incidents, null, 2)}

TASK:
1. Correlate traffic jams with specific event start times or popular venue districts
2. Identify which incidents affect rideshare pickup/dropoff potential
3. Recommend optimal departure windows based on event schedules

Output ONLY valid JSON matching this schema:
{
  "traffic_summary": "2-3 sentence summary",
  "risk_level": "low|medium|high|severe",
  "top_incidents": [{"description": "...", "severity": "...", "location": "..."}],
  "recommended_departure_window": "string or null",
  "venue_correlations": ["Traffic near X venue due to Y"],
  "event_correlations": ["Heavy traffic expected for Z event at 7pm"]
}`;

    // 3. Call Gemini 3 Pro via model adapter
    // Uses BRIEFING_TRAFFIC role from model-registry.js
    const result = await callModel('BRIEFING_TRAFFIC', {
      system: systemPrompt,
      user: 'Generate traffic briefing JSON based on the provided telemetry and database context.'
    });

    // 4. Parse and Validate with Zod
    let parsed;
    try {
      // Handle potential markdown code blocks in response
      let jsonStr = result;
      const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const rawParsed = JSON.parse(jsonStr);
      parsed = TrafficBriefingSchema.parse(rawParsed);
    } catch (parseError) {
      briefingLog.warn(1, `Traffic briefing parse failed: ${parseError.message}`, OP.AI);
      // Fallback: Generate deterministic summary from raw data
      return generateFallbackBriefing(rawTraffic, context);
    }

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic briefing: ${parsed.risk_level} risk (${elapsedMs}ms)`, OP.AI);

    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
      source: 'gemini_briefer'
    };
  } catch (error) {
    briefingLog.error(1, `Traffic briefing failed: ${error.message}`, error);
    return null;
  }
}

/**
 * Fallback: Generate deterministic briefing from raw data
 * Used when Gemini response fails validation
 */
function generateFallbackBriefing(rawTraffic, context) {
  const incidentCount = rawTraffic.incidents?.length || 0;
  const eventCount = context.activeEvents?.length || 0;

  let riskLevel = 'low';
  if (incidentCount > 5) riskLevel = 'high';
  else if (incidentCount > 2) riskLevel = 'medium';

  const topIncidents = (rawTraffic.incidents || []).slice(0, 5).map(inc => ({
    description: inc.properties?.events?.[0]?.description || 'Traffic incident',
    severity: ['Minor', 'Moderate', 'Major'][inc.properties?.magnitudeOfDelay || 0] || 'Unknown',
    location: `${inc.properties?.from || ''} to ${inc.properties?.to || ''}`.trim() || 'Unknown'
  }));

  return {
    traffic_summary: `${incidentCount} active incidents in the area. ${eventCount} events may affect traffic.`,
    risk_level: riskLevel,
    top_incidents: topIncidents,
    recommended_departure_window: null,
    venue_correlations: [],
    event_correlations: context.activeEvents?.slice(0, 3).map(e =>
      `${e.title} at ${e.start || 'TBD'} may affect traffic`
    ) || [],
    generatedAt: new Date().toISOString(),
    source: 'fallback_deterministic'
  };
}

// ============================================================================
// LEGACY BRIEFING RUNNER (Unchanged)
// ============================================================================

/**
 * Generate comprehensive briefing using BRIEFING_* roles
 *
 * DATA COVERAGE:
 * - Events (BRIEFING_EVENTS_DISCOVERY role with Google Search)
 * - Traffic (BRIEFING_TRAFFIC role with Google Search)
 * - Weather (Google Weather API)
 * - Rideshare News (BRIEFING_NEWS role with Google Search)
 * - School Closures (BRIEFING_CLOSURES role with Google Search)
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot to avoid redundant DB reads
 * @returns {Promise<{briefing: Object}>} The generated briefing row
 * @throws {Error} If snapshot not found or briefing generation fails
 */
export async function runBriefing(snapshotId, options = {}) {
  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const [row] = await db.select().from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Use briefing-service which handles all Gemini calls in parallel
    const result = await generateAndStoreBriefing({
      snapshotId,
      snapshot
    });

    if (!result.success) {
      briefingLog.warn(2, `Generation returned success=false: ${result.error}`);
      throw new Error(result.error || 'Briefing generation failed');
    }

    briefingLog.done(2, `[briefing.js] Briefing stored for ${snapshotId.slice(0, 8)}`, OP.DB);

    // 2026-01-10: Return the fresh briefing so caller can pass it downstream
    // This avoids re-reading from DB and ensures fresh data is used
    return { briefing: result.briefing };
  } catch (error) {
    briefingLog.error(2, `Briefing failed for ${snapshotId.slice(0, 8)}`, error);
    throw error;
  }
}
