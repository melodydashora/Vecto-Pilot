// server/api/strategy/tactical-plan.js
// ============================================================================
// TACTICAL PLAN API - AI-powered staging and avoid zone recommendations
// ============================================================================
//
// PURPOSE: Generate tactical analysis for a specific mission (event or airport)
// using STRATEGY_CONTEXT role with Google Search grounding for real-time verification
//
// INPUT:
//   - snapshotId: Current snapshot context
//   - mission: { type, name, lat, lng, ... }
//   - driverLat, driverLng: Driver's current position
//   - trafficContext: Current traffic conditions (optional)
//
// OUTPUT:
//   - stagingZones: Green zones where driver should wait
//   - avoidZones: Red zones to stay away from
//   - strategy: Tactical summary text
//
// ROLE: STRATEGY_CONTEXT (with Google Search grounding)
//
// ============================================================================

import express from 'express';
import { callModel } from '../../lib/ai/adapters/index.js';
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Request validation schema
const TacticalPlanRequestSchema = z.object({
  snapshotId: z.string().uuid(),
  mission: z.object({
    type: z.enum(['event', 'airport']),
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    // Event-specific fields
    venue: z.string().optional(),
    eventTime: z.string().optional(),
    eventEndTime: z.string().optional(),
    expectedAttendance: z.string().optional(),
    // Airport-specific fields
    airportCode: z.string().optional(),
    terminal: z.string().optional(),
  }),
  driverLat: z.number().min(-90).max(90),
  driverLng: z.number().min(-180).max(180),
  trafficContext: z.object({
    congestionLevel: z.string().optional(),
    incidents: z.array(z.any()).optional(),
    avoidAreas: z.array(z.string()).optional(),
  }).optional(),
});

// Response zone schema
const ZoneSchema = z.object({
  type: z.enum(['staging', 'avoid']),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  notes: z.string().optional(),
  reason: z.string().optional(),
});

const TacticalResponseSchema = z.object({
  staging_zones: z.array(ZoneSchema),
  avoid_zones: z.array(ZoneSchema),
  tactical_summary: z.string(),
});

/**
 * Build system prompt for tactical analysis
 */
function buildSystemPrompt(snapshot, mission, trafficContext) {
  const missionType = mission.type === 'airport' ? 'AIRPORT' : 'EVENT';
  const locationContext = snapshot?.city && snapshot?.state
    ? `${snapshot.city}, ${snapshot.state}`
    : 'the area';

  return `You are a tactical rideshare positioning expert for ${locationContext}.

MISSION TYPE: ${missionType}
TARGET: ${mission.name}
COORDINATES: ${mission.lat}, ${mission.lng}
${mission.venue ? `VENUE: ${mission.venue}` : ''}
${mission.eventTime ? `EVENT TIME: ${mission.eventTime}` : ''}
${mission.airportCode ? `AIRPORT CODE: ${mission.airportCode}` : ''}

YOUR TASK: Analyze this location and provide:
1. STAGING ZONES (2-3 locations): Safe waiting spots with free parking, good cell signal, easy exit routes
2. AVOID ZONES (1-2 locations): Areas with traffic congestion, no parking, police enforcement, or safety concerns

REQUIREMENTS:
- All coordinates must be within 0.5 miles of the mission target
- Staging zones should be parking lots, gas stations, hotel drives, or shopping center lots
- Avoid zones should be areas with known traffic issues, valets blocking pickup, or restricted areas
- Include specific names (e.g., "Walmart Parking Lot on Main St") not just descriptions
- Consider current traffic conditions if provided

${trafficContext?.congestionLevel ? `CURRENT TRAFFIC: ${trafficContext.congestionLevel}` : ''}
${trafficContext?.avoidAreas?.length ? `KNOWN AVOID AREAS: ${trafficContext.avoidAreas.join(', ')}` : ''}

OUTPUT FORMAT (JSON only, no markdown):
{
  "staging_zones": [
    { "type": "staging", "name": "Location Name", "lat": 32.xxx, "lng": -96.xxx, "notes": "Why this is good" }
  ],
  "avoid_zones": [
    { "type": "avoid", "name": "Area Name", "lat": 32.xxx, "lng": -96.xxx, "reason": "Why to avoid" }
  ],
  "tactical_summary": "2-3 sentence tactical recommendation for approaching this mission"
}`;
}

/**
 * POST /api/strategy/tactical-plan
 * Generate AI-powered tactical analysis for a specific mission
 */
router.post('/', async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate request
    const validationResult = TacticalPlanRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: validationResult.error.issues,
      });
    }

    const { snapshotId, mission, driverLat, driverLng, trafficContext } = validationResult.data;

    console.log(`[TACTICAL] Starting analysis for ${mission.type}: ${mission.name}`);

    // Get snapshot context for location info
    const [snapshot] = await db
      .select({
        city: snapshots.city,
        state: snapshots.state,
        timezone: snapshots.timezone,
      })
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found',
      });
    }

    // Build prompt
    const systemPrompt = buildSystemPrompt(snapshot, mission, trafficContext);
    const userPrompt = JSON.stringify({
      mission,
      driverLocation: { lat: driverLat, lng: driverLng },
      requestedAt: new Date().toISOString(),
    });

    // Call STRATEGY_CONTEXT role with Google Search grounding
    // 2026-01-05: Updated to {TABLE}_{FUNCTION} naming convention
    const result = await callModel('STRATEGY_CONTEXT', {
      system: systemPrompt,
      user: userPrompt,
    });

    // Parse response
    let parsedResult;
    try {
      // Handle both string and object responses
      const responseText = typeof result === 'string' ? result : result.text || JSON.stringify(result);

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                        responseText.match(/```\s*([\s\S]*?)\s*```/) ||
                        [null, responseText];
      const jsonStr = jsonMatch[1] || responseText;

      parsedResult = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('[TACTICAL] Failed to parse AI response:', parseError);

      // Fallback: Generate mathematical zones based on mission coordinates
      parsedResult = generateFallbackZones(mission);
    }

    // Validate and transform response
    const validatedResponse = TacticalResponseSchema.safeParse(parsedResult);

    let stagingZones, avoidZones, tacticalSummary;

    if (validatedResponse.success) {
      stagingZones = validatedResponse.data.staging_zones.map(z => ({
        ...z,
        id: uuidv4(),
        source: 'ai_tactical',
      }));
      avoidZones = validatedResponse.data.avoid_zones.map(z => ({
        ...z,
        id: uuidv4(),
        source: 'ai_tactical',
      }));
      tacticalSummary = validatedResponse.data.tactical_summary;
    } else {
      // Use fallback if validation fails
      const fallback = generateFallbackZones(mission);
      stagingZones = fallback.staging_zones.map(z => ({ ...z, id: uuidv4(), source: 'fallback' }));
      avoidZones = fallback.avoid_zones.map(z => ({ ...z, id: uuidv4(), source: 'fallback' }));
      tacticalSummary = fallback.tactical_summary;
    }

    const latencyMs = Date.now() - startTime;
    console.log(`[TACTICAL] Completed in ${latencyMs}ms: ${stagingZones.length} staging, ${avoidZones.length} avoid zones`);

    res.json({
      success: true,
      mission: {
        type: mission.type,
        name: mission.name,
        lat: mission.lat,
        lng: mission.lng,
      },
      stagingZones,
      avoidZones,
      strategy: tacticalSummary,
      metadata: {
        model: 'gemini-3-pro',
        latencyMs,
        generatedAt: new Date().toISOString(),
        searchGrounded: true,
      },
    });

  } catch (error) {
    console.error('[TACTICAL] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate tactical plan',
      message: error.message,
    });
  }
});

/**
 * Generate fallback zones using mathematical offset from mission coordinates
 * Used when AI response parsing fails
 */
function generateFallbackZones(mission) {
  const { lat, lng, name, type } = mission;
  const offset = 0.002; // ~200m offset

  return {
    staging_zones: [
      {
        type: 'staging',
        name: `${name} - South Staging`,
        lat: lat - offset,
        lng: lng,
        notes: 'Calculated staging position (200m south of target). Verify locally.',
      },
      {
        type: 'staging',
        name: `${name} - East Staging`,
        lat: lat,
        lng: lng + offset,
        notes: 'Alternative staging position (200m east of target). Verify locally.',
      },
    ],
    avoid_zones: [
      {
        type: 'avoid',
        name: `${name} - Main Entrance`,
        lat: lat,
        lng: lng,
        reason: type === 'airport'
          ? 'Airport terminal drop-off zone - no waiting allowed'
          : 'Event venue entrance - expect congestion and valet traffic',
      },
    ],
    tactical_summary: `Standard ${type} protocol. Stage at calculated offset positions and monitor for surges. Avoid main entrance due to expected congestion.`,
  };
}

export default router;
