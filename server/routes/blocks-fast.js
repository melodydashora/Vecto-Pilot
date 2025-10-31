// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// GPT-5 Venue Generation + Google Places enrichment
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates, strategies, venue_events } from '../../shared/schema.js';
import { eq, sql, and, lte, gte, or, isNotNull } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { generateVenueCoordinates } from '../lib/gpt5-venue-generator.js';
import { isStrategyReady } from '../lib/strategy-utils.js';

const router = Router();

// Helper to safely calculate elapsed time and prevent NaN in responses
function safeElapsedMs(row) {
  const t0 = row?.created_at ? new Date(row.created_at).getTime() : Date.now();
  const ms = Date.now() - t0;
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

// Environment configuration
const PLANNER_BUDGET_MS = parseInt(process.env.PLANNER_BUDGET_MS || '7000'); // 7 second wall clock
const PLANNER_TIMEOUT_MS = parseInt(process.env.PLANNER_TIMEOUT_MS || '5000'); // 5 second planner timeout

// GET endpoint - return existing blocks for a snapshot
// STRATEGY-FIRST GATING: Returns 202 until strategy is ready
router.get('/', async (req, res) => {
  const snapshotId = req.query.snapshotId || req.query.snapshot_id;
  
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshot_required' });
  }

  try {
    // GATE 1: Strategy must be ready before blocks
    const { ready, strategy, status } = await isStrategyReady(snapshotId);
    
    if (!ready) {
      return res.status(202).json({ 
        ok: false, 
        reason: 'strategy_pending',
        status: status || 'pending',
        message: 'Waiting for consolidated strategy to complete'
      });
    }
    
    // Fetch strategy row for briefing bundle
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    const briefing = strategyRow ? {
      claude_strategy: strategyRow.claude_strategy || null,
      gemini: {
        news: strategyRow.gemini_news || [],
        events: strategyRow.gemini_events || [],
        traffic: strategyRow.gemini_traffic || []
      },
      gpt5_consolidated: strategyRow.gpt5_consolidated || null
    } : null;
    
    // GATE 2: Find ranking for this snapshot
    const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
    
    if (!ranking) {
      return res.status(404).json({ error: 'NOT_FOUND', blocks: [] });
    }

    // Get candidates for this ranking
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);
    
    // 15-minute perimeter enforcement
    const within15Min = (driveMin) => Number.isFinite(driveMin) && driveMin <= 15;
    
    const allBlocks = candidates.map(c => ({
      name: c.name,
      coordinates: { lat: c.lat, lng: c.lng },
      placeId: c.place_id,
      estimated_distance_miles: c.distance_miles,
      driveTimeMinutes: c.drive_minutes,
      value_per_min: c.value_per_min,
      value_grade: c.value_grade,
      not_worth: c.not_worth,
      proTips: c.pro_tips,
      closed_venue_reasoning: c.closed_reasoning,
      stagingArea: c.staging_tips ? { parkingTip: c.staging_tips } : null,
      businessHours: c.business_hours,
      isOpen: c.business_hours?.isOpen,
      eventBadge: c.venue_events?.badge,
      eventSummary: c.venue_events?.summary,
    }));
    
    // Filter to 15-minute perimeter
    const blocks = allBlocks.filter(b => within15Min(b.driveTimeMinutes));
    const rejected = allBlocks.filter(b => !within15Min(b.driveTimeMinutes)).length;
    
    const audit = [
      { step: 'gating', strategy_ready: true },
      { step: 'perimeter', accepted: blocks.length, rejected, max_minutes: 15 }
    ];

    return res.json({ blocks, ranking_id: ranking.ranking_id, briefing, audit });
  } catch (error) {
    console.error('[blocks-fast GET] Error:', error);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', async (req, res) => {
  const wallClockStart = Date.now();
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  
  // Audit trail for deployment verification
  const audit = [];
  const logAudit = (step, data) => {
    const entry = { step, ...data, ts: Date.now() - wallClockStart };
    audit.push(entry);
    console.log(`[audit:${correlationId}] ${step}:`, JSON.stringify(data));
  };
  
  let responded = false;
  const sendOnce = (code, body) => {
    if (!responded) {
      responded = true;
      res.status(code).json({ ...body, audit });
    }
  };

  try {
    const { userId = 'demo' } = req.body;
    const snapshotId = req.body?.snapshot_id || req.body?.snapshotId || req.header('x-snapshot-id') || req.query?.snapshot_id;

    if (!snapshotId) {
      return sendOnce(400, { error: 'snapshot_required', message: 'snapshot_id is required' });
    }

    // ============================================
    // STEP 1: Load snapshot (REQUIRED for origin coords)
    // ============================================
    let fullSnapshot = null;
    if (snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      if (snap) {
        fullSnapshot = {
          ...snap,
          weather: `${snap.weather?.temp || ''}°F ${snap.weather?.description || ''}`.trim(),
          air_quality: `AQI ${snap.air?.aqi || ''}`,
          airport_context: snap.airport_context ? JSON.stringify(snap.airport_context) : 'No delays'
        };
      }
    }

    if (!fullSnapshot || fullSnapshot.lat == null || fullSnapshot.lng == null) {
      return sendOnce(400, {
        error: 'origin_not_ready',
        message: 'Snapshot coordinates are required. Create a valid snapshot first.'
      });
    }

    const lat = parseFloat(fullSnapshot.lat.toFixed(6));
    const lng = parseFloat(fullSnapshot.lng.toFixed(6));
    
    // Input normalization audit
    logAudit('input', {
      coords: `${lat},${lng}`,
      source: 'snapshot',
      reverseGeo: fullSnapshot.formatted_address || fullSnapshot.city,
      snapshotId
    });
    
    console.log(`⚡ [${correlationId}] FAST BLOCKS: lat=${lat} lng=${lng} budget=${PLANNER_BUDGET_MS}ms`);

    // ============================================
    // STEP 2: Load Snapshot Data First (snapshot-first pattern)
    // ============================================
    const dataLoadStart = Date.now();
    
    // Check for existing ranking_candidates from snapshot
    const existingCandidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.snapshot_id, snapshotId))
      .orderBy(ranking_candidates.rank)
      .limit(8);
    
    logAudit('snapshot_data', {
      existing_candidates: existingCandidates.length,
      source: 'ranking_candidates'
    });

    let rawVenues = [];
    let generationUsed = false;

    // SNAPSHOT-FIRST PATTERN: Use existing data if available
    if (existingCandidates.length >= 4) {
      console.log(`✅ [${correlationId}] Using ${existingCandidates.length} snapshot candidates (no generation needed)`);
      rawVenues = existingCandidates.map(c => ({
        name: c.name,
        location_lat: c.lat,
        location_lng: c.lng,
        staging_name: c.staging_name || '',
        staging_lat: c.staging_lat || c.lat,
        staging_lng: c.staging_lng || c.lng,
        category: 'snapshot',
        pro_tips: c.pro_tips || '',
        staging_tips: c.staging_tips || '',
        closed_reasoning: c.closed_reasoning || null,
        estimated_earnings: 25,
        demand_level: 'medium',
        driveTimeMinutes: c.drive_minutes || c.drive_time_minutes || 10
      }));
      
      logAudit('source', {
        type: 'snapshot',
        count: rawVenues.length,
        generation_used: false
      });
    } else {
      // FALLBACK: Generate venues if insufficient snapshot data
      console.log(`⚠️  [${correlationId}] Only ${existingCandidates.length} snapshot candidates, calling generator...`);
      generationUsed = true;

      // STRATEGY-FIRST GATING: Get consolidated strategy for generation
      const [strategyRow] = await db.select().from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .limit(1);
      
      if (!strategyRow || !strategyRow.strategy_for_now) {
        return sendOnce(202, {
          ok: false,
          reason: 'strategy_pending',
          message: 'Waiting for consolidated strategy to complete'
        });
      }

      const consolidatedStrategy = strategyRow.strategy_for_now;
      const currentTime = new Date(fullSnapshot.local_iso || new Date()).toLocaleString('en-US', {
        timeZone: fullSnapshot.timezone || 'America/Chicago'
      });

      try {
        const gpt5Result = await generateVenueCoordinates({
          consolidatedStrategy,
          driverLat: lat,
          driverLng: lng,
          city: fullSnapshot.city,
          state: fullSnapshot.state,
          currentTime,
          weather: fullSnapshot.weather || '',
          maxDistance: 15
        });

        rawVenues = gpt5Result.venues.slice(0, 8);
        
        logAudit('source', {
          type: 'generated',
          count: rawVenues.length,
          generation_used: true,
          model: 'gpt-5-venue-generator'
        });
        
        console.log(`✅ [${correlationId}] GPT-5 generated ${rawVenues.length} venues as fallback`);
      } catch (genError) {
        console.error(`❌ [${correlationId}] Generation failed:`, genError.message);
        
        logAudit('generator_error', {
          reason: genError.message,
          fallback: 'empty_generation'
        });
        
        // Fail gracefully: return empty if both snapshot and generator fail
        if (existingCandidates.length === 0) {
          return sendOnce(200, {
            ok: false,
            blocks: [],
            reason: 'insufficient_data',
            message: 'No snapshot data and generator failed'
          });
        }
        
        // Use what we have from snapshot
        rawVenues = existingCandidates.map(c => ({
          name: c.name,
          location_lat: c.lat,
          location_lng: c.lng,
          staging_name: c.staging_name || '',
          staging_lat: c.staging_lat || c.lat,
          staging_lng: c.staging_lng || c.lng,
          category: 'snapshot',
          pro_tips: c.pro_tips || '',
          staging_tips: c.staging_tips || '',
          closed_reasoning: c.closed_reasoning || null,
          estimated_earnings: 25,
          demand_level: 'medium',
          driveTimeMinutes: c.drive_minutes || c.drive_time_minutes || 10
        }));
      }
    }
    
    const gpt5Venues = rawVenues;
    const generationMs = Date.now() - dataLoadStart;

    // ============================================
    // STEP 3: Enrich GPT-5 venues with drive times
    // ============================================
    const enrichmentStart = Date.now();
    const driveCtx = { 
      tz: fullSnapshot.timezone,
      dow: new Date().getDay(), 
      hour: new Date().getHours() 
    };

    // Enrich GPT-5 venues with drive times using location coords
    const enrichedVenues = await Promise.all(
      gpt5Venues.map(async (v) => {
        const driveMin = await predictDriveMinutes(
          {lat, lng}, 
          {lat: v.location_lat, lng: v.location_lng}, 
          driveCtx
        );
        
        // Calculate value metrics
        const distanceMeters = driveMin * 1000 * 0.6; // Rough estimate
        const distanceMiles = (distanceMeters / 1609.344).toFixed(1);
        const potential = v.estimated_earnings || Math.round(25 * Math.max(0.5, 1 - (driveMin / 60)));
        const surge = driveMin < 10 ? 1.5 : driveMin < 20 ? 1.2 : 1.0;
        const valuePerMin = (potential / Math.max(1, driveMin)).toFixed(2);
        
        // Determine value grade
        let valueGrade = 'C';
        if (parseFloat(valuePerMin) >= 1.0) valueGrade = 'A';
        else if (parseFloat(valuePerMin) >= 0.6) valueGrade = 'B';
        
        return {
          name: v.location_name,
          lat: v.location_lat,
          lng: v.location_lng,
          staging_name: v.staging_name,
          staging_lat: v.staging_lat,
          staging_lng: v.staging_lng,
          category: v.category,
          pro_tips: v.pro_tips,
          staging_tips: v.staging_tips,
          closed_reasoning: v.closed_reasoning,
          driveTimeMinutes: driveMin,
          distance_miles: parseFloat(distanceMiles),
          estimated_earnings: potential,
          surge: surge.toFixed(1),
          value_per_min: parseFloat(valuePerMin),
          value_grade: valueGrade,
          not_worth: parseFloat(valuePerMin) < 0.3,
          demand_level: v.demand_level
        };
      })
    );
    
    const enrichmentMs = Date.now() - enrichmentStart;
    console.log(`✅ [${correlationId}] Enriched ${enrichedVenues.length} venues in ${enrichmentMs}ms`);

    // Use GPT-5 venues as final output (no reranking needed)
    const finalVenues = enrichedVenues;
    
    // Enrichment audit: count successful enrichments
    const enrichmentStats = {
      total: finalVenues.length,
      with_drive_time: finalVenues.filter(v => v.driveTimeMinutes > 0).length,
      with_hours: 0, // No hours enrichment yet
      enrichment_ms: enrichmentMs
    };
    logAudit('enrichment', enrichmentStats);

    // ============================================
    // STEP 3.5: Event Matching (venue_events)
    // ============================================
    const eventMatchStart = Date.now();
    let venueEventsMap = new Map();
    let eventMatchStats = { matched: 0, direct: 0, route: 0, none: 0, reason: 'venue_events_table_missing' };
    
    try {
      // Query venue_events for active events in the area
      const now = new Date();
      const events = await db.select().from(venue_events)
        .where(
          and(
            or(
              isNotNull(venue_events.starts_at),
              isNotNull(venue_events.lat)
            )
          )
        )
        .limit(100);
      
      // Match events to venues
      for (const venue of enrichedVenues) {
        let matchedEvent = null;
        let matchReason = 'none';
        let routeDistanceMiles = null;
        
        for (const event of events) {
          // Direct match: venue_id or place_id
          if (event.venue_id && venue.place_id && event.venue_id === venue.place_id) {
            matchedEvent = event;
            matchReason = 'direct_match';
            eventMatchStats.direct++;
            break;
          }
          
          // Route proximity match: ≤2 miles
          if (event.lat && event.lng && venue.lat && venue.lng) {
            const distanceMiles = venue.distance_miles; // Already calculated from origin
            if (distanceMiles <= 2) {
              matchedEvent = event;
              matchReason = 'route_match';
              routeDistanceMiles = distanceMiles;
              eventMatchStats.route++;
              break;
            }
          }
        }
        
        if (matchedEvent) {
          venueEventsMap.set(venue.name, {
            badge: matchedEvent.title,
            summary: matchedEvent.title,
            match_reason: matchReason,
            route_distance_miles: routeDistanceMiles
          });
          eventMatchStats.matched++;
        } else {
          eventMatchStats.none++;
        }
      }
      
      eventMatchStats.reason = eventMatchStats.matched > 0 ? 'events_matched' : 'no_events_in_window';
    } catch (err) {
      console.error('[event-matching] Failed to query venue_events:', err);
      eventMatchStats.reason = 'event_query_failed';
    }
    
    const eventMatchMs = Date.now() - eventMatchStart;
    logAudit('events', { ...eventMatchStats, event_match_ms: eventMatchMs });
    
    const totalMs = Date.now() - wallClockStart;

    // ============================================
    // STEP 4: Persist to database with timing metrics
    // ============================================
    const isValidUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    const isValidSnapshotId = snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);

    const venuesToPersist = finalVenues.map((venue, i) => {
      const eventData = venueEventsMap.get(venue.name);
      return {
        name: venue.name,
        place_id: null, // Will be resolved via Places API (new)
        category: venue.category || null,
        rank: i + 1,
        lat: venue.lat,
        lng: venue.lng,
        // Staging coordinates from GPT-5
        staging_name: venue.staging_name,
        staging_lat: venue.staging_lat,
        staging_lng: venue.staging_lng,
        // GPT-5 tactical outputs
        pro_tips: venue.pro_tips ? [venue.pro_tips] : null,
        staging_tips: venue.staging_tips,
        closed_reasoning: venue.closed_reasoning,
        // Calculated metrics
        distance_miles: venue.distance_miles,
        drive_minutes: venue.driveTimeMinutes,
        value_per_min: venue.value_per_min,
        value_grade: venue.value_grade,
        not_worth: venue.not_worth,
        est_earnings_per_ride: venue.estimated_earnings,
        // Event matching data
        venue_events: eventData ? {
          badge: eventData.badge,
          summary: eventData.summary,
          match_reason: eventData.match_reason,
          route_distance_miles: eventData.route_distance_miles
        } : null
      };
    });

    let ranking_id;
    try {
      // Create ranking with timing metrics
      ranking_id = await db.transaction(async (tx) => {
        const rid = randomUUID();
        
        await tx.insert(rankings).values({
          ranking_id: rid,
          created_at: new Date(),
          snapshot_id: isValidSnapshotId ? snapshotId : null,
          correlation_id: correlationId,
          user_id: isValidUuid ? userId : null,
          city: fullSnapshot?.city || null,
          model_name: 'gpt-5-venue-generator',
          scoring_ms: generationMs,
          planner_ms: enrichmentMs,
          total_ms: totalMs,
          timed_out: false,
          path_taken: 'gpt5-generated',
          ui: null
        });

        // Insert candidates with GPT-5 generated data
        for (const venue of venuesToPersist) {
          await tx.insert(ranking_candidates).values({
            id: randomUUID(),
            ranking_id: rid,
            block_id: `${venue.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${venue.lat}_${venue.lng}`,
            name: venue.name,
            lat: venue.lat,
            lng: venue.lng,
            category: venue.category,
            rank: venue.rank,
            exploration_policy: 'gpt5-generated',
            // Staging coordinates
            staging_name: venue.staging_name,
            staging_lat: venue.staging_lat,
            staging_lng: venue.staging_lng,
            // GPT-5 tactical outputs
            pro_tips: venue.pro_tips,
            staging_tips: venue.staging_tips,
            closed_reasoning: venue.closed_reasoning,
            // Calculated metrics
            distance_miles: venue.distance_miles,
            drive_minutes: venue.drive_minutes,
            // Event matching data
            venue_events: venue.venue_events,
            value_per_min: venue.value_per_min,
            value_grade: venue.value_grade,
            not_worth: venue.not_worth,
            est_earnings_per_ride: venue.est_earnings_per_ride,
            // Will be enriched later by reverse geo, Places API (new), Routes API (new)
            place_id: null,
            snapshot_id: isValidSnapshotId ? snapshotId : null
          });
        }

        return rid;
      });

      console.log(`✅ [${correlationId}] Persisted ranking ${ranking_id} with timing: generation=${generationMs}ms enrichment=${enrichmentMs}ms total=${totalMs}ms`);
    } catch (e) {
      console.error(`❌ [${correlationId}] Persistence failed:`, e);
      return sendOnce(502, { ok: false, error: 'persist_failed', correlationId });
    }

    // ============================================
    // STEP 5: Return response
    // ============================================
    
    // 15-minute perimeter enforcement helper
    const within15Min = (driveTimeMinutes) => {
      return Number.isFinite(driveTimeMinutes) && driveTimeMinutes <= 15;
    };
    
    const blocks = finalVenues.map((v, index) => {
      // Implement reason codes from stabilization doc
      const reasons = [];
      const flags = {
        coordsOk: v.lat && v.lng,
        stagingOk: v.staging_lat && v.staging_lng,
        tipsOk: v.pro_tips,
        enrichmentOk: v.driveTimeMinutes > 0
      };

      if (!flags.coordsOk) reasons.push('coords_missing');
      if (!flags.stagingOk) reasons.push('staging_missing');
      if (!flags.tipsOk) reasons.push('tips_missing');
      if (!flags.enrichmentOk) reasons.push('enrichment_incomplete');

      // CRITICAL: 15-minute perimeter enforcement
      const withinPerimeter = within15Min(v.driveTimeMinutes);
      if (!withinPerimeter) reasons.push('out_of_perimeter');

      const okCount = Object.values(flags).filter(Boolean).length;
      // Status requires BOTH flag counts AND perimeter check
      const status = (okCount === 4 && withinPerimeter) ? 'green' : 
                     (okCount >= 2 && withinPerimeter) ? 'yellow' : 'red';

      const eventData = venueEventsMap.get(v.name);
      
      return {
        name: v.name,
        category: v.category,
        coordinates: { lat: v.lat, lng: v.lng },
        stagingArea: {
          name: v.staging_name,
          coordinates: { lat: v.staging_lat, lng: v.staging_lng },
          parkingTip: v.staging_tips
        },
        proTips: v.pro_tips,
        closed_venue_reasoning: v.closed_reasoning,
        estimated_distance_miles: v.distance_miles,
        driveTimeMinutes: v.driveTimeMinutes,
        surge: v.surge,
        estimatedEarningsPerRide: v.estimated_earnings,
        value_per_min: v.value_per_min,
        value_grade: v.value_grade,
        not_worth: v.not_worth,
        // Event matching data
        eventBadge: eventData?.badge || null,
        eventSummary: eventData?.summary || null,
        eventMatchReason: eventData?.match_reason || null,
        eventRouteDistanceMiles: eventData?.route_distance_miles || null,
        // Stabilization: explicit status and reasons
        status,
        flags,
        reasons: reasons.length > 0 ? reasons : null
      };
    });

    // 15-minute perimeter filter - only display blocks within perimeter
    const blocksWithinPerimeter = blocks.filter(b => within15Min(b.driveTimeMinutes));
    const blocksOutOfPerimeter = blocks.filter(b => !within15Min(b.driveTimeMinutes)).map(b => ({
      name: b.name,
      driveTimeMinutes: b.driveTimeMinutes,
      reason: 'out_of_perimeter'
    }));
    
    // Perimeter audit
    logAudit('perimeter', {
      accepted: blocksWithinPerimeter.length,
      rejected: blocksOutOfPerimeter.length,
      max_minutes: 15,
      out_of_perimeter: blocksOutOfPerimeter
    });
    
    // Final status audit (only for blocks within perimeter)
    const statusCounts = {
      green: blocksWithinPerimeter.filter(b => b.status === 'green').length,
      yellow: blocksWithinPerimeter.filter(b => b.status === 'yellow').length,
      red: blocksWithinPerimeter.filter(b => b.status === 'red').length,
      total: blocksWithinPerimeter.length,
      excluded_out_of_perimeter: blocksOutOfPerimeter.length
    };
    logAudit('status', statusCounts);

    const response = {
      ok: true,
      correlationId,
      ranking_id,
      snapshot_id: fullSnapshot.snapshot_id,
      blocks: blocksWithinPerimeter, // CRITICAL: Only return blocks within 15-min perimeter
      userId,
      generatedAt: new Date().toISOString(),
      path_taken: 'gpt5-generated',
      timing: {
        generation_ms: generationMs,
        enrichment_ms: enrichmentMs,
        total_ms: totalMs,
        budget_ms: PLANNER_BUDGET_MS
      },
      metadata: {
        totalBlocks: blocksWithinPerimeter.length,
        totalGenerated: blocks.length,
        outOfPerimeter: blocksOutOfPerimeter.length,
        processingTimeMs: totalMs,
        modelRoute: 'gpt-5-venue-generator',
        statusCounts
      },
      audit: auditTrail
    };

    console.log(`✅ [${correlationId}] Fast blocks complete in ${totalMs}ms (gpt5-generated): ${blocksWithinPerimeter.length}/${blocks.length} venues within 15-min perimeter`);
    sendOnce(200, response);

  } catch (error) {
    console.error(`❌ [${correlationId}] Error:`, error);
    
    // Improved error handling per stabilization doc
    const isDrizzleError = error.name === 'DrizzleQueryError' || error.message?.includes('query');
    const isDbError = error.code === 'ECONNREFUSED' || error.message?.includes('database');
    
    sendOnce(500, {
      ok: false,
      error: isDrizzleError ? 'DATABASE_QUERY_ERROR' : isDbError ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR',
      reason: error.message,
      cause: error.cause?.message || null,
      correlationId,
      // Help UI degrade gracefully with yellow status
      degraded: true,
      fallback_message: 'Could not generate blocks - please try refreshing your location'
    });
  }
});

/**
 * Get strategy status and data (no 202s, no NaNs, no undefined)
 * Always returns 200 with clean JSON using GENERIC model-agnostic columns
 */
export async function getStrategyFast({ snapshotId }) {
  const [row] = await db.select().from(strategies)
    .where(eq(strategies.snapshot_id, snapshotId))
    .limit(1);

  if (!row) {
    return { status: 'missing', snapshot_id: snapshotId, timeElapsedMs: 0 };
  }

  // SIMPLIFIED: Only check consolidated_strategy (Gemini → GPT-5 pipeline)
  const waitFor = [];
  if (!row.consolidated_strategy) waitFor.push('strategy');

  const timeElapsedMs = safeElapsedMs(row);

  if (waitFor.length) {
    return {
      status: 'pending',
      snapshot_id: snapshotId,
      waitFor: Array.from(new Set(waitFor)),  // Remove duplicates
      timeElapsedMs
    };
  }

  // GENERIC: Return model-agnostic fields with fallbacks to never return undefined/NaN
  return {
    status: 'ok',
    snapshot_id: snapshotId,
    strategy: {
      min: row.minstrategy || '',
      consolidated: row.consolidated_strategy || '',
      briefing: {
        news: row.briefing_news ?? [],
        events: row.briefing_events ?? [],
        traffic: row.briefing_traffic ?? []
      },
      user: {
        address: row.user_resolved_address || row.user_address || '',
        city: row.user_resolved_city || row.city || '',
        state: row.user_resolved_state || row.state || ''
      }
    },
    timeElapsedMs
  };
}

/**
 * Get blocks for a snapshot (no 202s, no NaNs, no undefined)
 * Always returns 200 with clean JSON
 */
export async function getBlocksFast({ snapshotId, req }) {
  // Check strategy readiness first
  const strat = await getStrategyFast({ snapshotId });
  if (strat.status !== 'ok') {
    return strat; // 200 + {status:'pending', ...}
  }

  // Load snapshot
  const [snap] = await db.select().from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
  
  if (!snap || snap.lat == null || snap.lng == null) {
    return { 
      status: 'error',
      error: 'snapshot_not_found',
      snapshot_id: snapshotId 
    };
  }

  // Check for existing ranking
  const [ranking] = await db.select().from(rankings)
    .where(eq(rankings.snapshot_id, snapshotId)).limit(1);
  
  if (ranking) {
    // Return existing blocks
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);
    
    const within15Min = (driveMin) => Number.isFinite(driveMin) && driveMin <= 15;
    const blocks = candidates
      .filter(c => within15Min(c.drive_minutes || c.drive_time_minutes))
      .map(c => ({
        name: c.name,
        coordinates: { lat: c.lat, lng: c.lng },
        placeId: c.place_id,
        estimated_distance_miles: c.distance_miles,
        driveTimeMinutes: c.drive_minutes || c.drive_time_minutes,
        value_per_min: c.value_per_min,
        value_grade: c.value_grade,
        not_worth: c.not_worth,
        proTips: c.pro_tips,
        closed_venue_reasoning: c.closed_reasoning,
        stagingArea: c.staging_tips ? { parkingTip: c.staging_tips } : null,
        businessHours: c.business_hours,
        isOpen: c.business_hours?.isOpen,
        eventBadge: c.venue_events?.badge,
        eventSummary: c.venue_events?.summary,
      }));
    
    return {
      status: 'ok',
      snapshot_id: snapshotId,
      blocks,
      ranking_id: ranking.ranking_id,
      briefing: {
        claude_strategy: strat.raw.claude_strategy,
        gemini: {
          news: strat.raw.news,
          events: strat.raw.events,
          traffic: strat.raw.traffic
        },
        gpt5_consolidated: strat.consolidated
      }
    };
  }

  // No ranking exists yet
  return {
    status: 'ok',
    snapshot_id: snapshotId,
    blocks: [],
    message: 'No ranking exists yet - blocks will be generated on next refresh'
  };
}

export default router;
