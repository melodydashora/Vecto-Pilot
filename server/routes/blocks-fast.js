// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// GPT-5 Venue Generation + Google Places enrichment
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates, strategies } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { generateVenueCoordinates } from '../lib/gpt5-venue-generator.js';

const router = Router();

// Environment configuration
const PLANNER_BUDGET_MS = parseInt(process.env.PLANNER_BUDGET_MS || '7000'); // 7 second wall clock
const PLANNER_TIMEOUT_MS = parseInt(process.env.PLANNER_TIMEOUT_MS || '5000'); // 5 second planner timeout

// GET endpoint - return existing blocks for a snapshot
router.get('/', async (req, res) => {
  const snapshotId = req.query.snapshotId || req.query.snapshot_id;
  
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshot_required' });
  }

  try {
    // Find ranking for this snapshot
    const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
    
    if (!ranking) {
      return res.status(404).json({ error: 'NOT_FOUND', blocks: [] });
    }

    // Get candidates for this ranking
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);

    const blocks = candidates.map(c => ({
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

    return res.json({ blocks, ranking_id: ranking.ranking_id });
  } catch (error) {
    console.error('[blocks-fast GET] Error:', error);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', async (req, res) => {
  const wallClockStart = Date.now();
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  
  let responded = false;
  const sendOnce = (code, body) => {
    if (!responded) {
      responded = true;
      res.status(code).json(body);
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

    const lat = fullSnapshot.lat;
    const lng = fullSnapshot.lng;
    
    console.log(`⚡ [${correlationId}] FAST BLOCKS: lat=${lat} lng=${lng} budget=${PLANNER_BUDGET_MS}ms`);

    // ============================================
    // STEP 2: Fetch Consolidated Strategy + Generate GPT-5 Venues
    // ============================================
    const generationStart = Date.now();
    
    // Get consolidated strategy for this snapshot
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);
    
    if (!strategyRow || !strategyRow.strategy_for_now) {
      return sendOnce(400, {
        error: 'strategy_not_ready',
        message: 'Consolidated strategy required. Wait for strategy generation to complete.'
      });
    }

    const consolidatedStrategy = strategyRow.strategy_for_now;
    const currentTime = new Date(fullSnapshot.local_iso || new Date()).toLocaleString('en-US', {
      timeZone: fullSnapshot.timezone || 'America/Chicago'
    });

    // Call GPT-5 to generate venue coordinates within 15 mile radius
    console.log(`[${correlationId}] Calling GPT-5 venue generator...`);
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

    // CRITICAL: Cap at exactly 8 venues (16 coords total)
    const gpt5Venues = gpt5Result.venues.slice(0, 8);
    const generationMs = Date.now() - generationStart;
    console.log(`✅ [${correlationId}] GPT-5 generated ${gpt5Venues.length} venues (${gpt5Venues.length * 2} coords) in ${generationMs}ms`);

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
    const totalMs = Date.now() - wallClockStart;

    // ============================================
    // STEP 4: Persist to database with timing metrics
    // ============================================
    const isValidUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    const isValidSnapshotId = snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);

    const venuesToPersist = finalVenues.map((venue, i) => ({
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
      est_earnings_per_ride: venue.estimated_earnings
    }));

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

      const okCount = Object.values(flags).filter(Boolean).length;
      const status = okCount === 4 ? 'green' : okCount >= 2 ? 'yellow' : 'red';

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
        // Stabilization: explicit status and reasons
        status,
        flags,
        reasons: reasons.length > 0 ? reasons : null
      };
    });

    const response = {
      ok: true,
      correlationId,
      ranking_id,
      snapshot_id: fullSnapshot.snapshot_id,
      blocks,
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
        totalBlocks: blocks.length,
        processingTimeMs: totalMs,
        modelRoute: 'gpt-5-venue-generator'
      }
    };

    console.log(`✅ [${correlationId}] Fast blocks complete in ${totalMs}ms (gpt5-generated): ${blocks.length} venues`);
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

export default router;
