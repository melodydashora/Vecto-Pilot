// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// Quick Picks (deterministic) + parallel LLM reranker with strict timeout
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';

const router = Router();

// Environment configuration
const PLANNER_BUDGET_MS = parseInt(process.env.PLANNER_BUDGET_MS || '7000'); // 7 second wall clock
const PLANNER_TIMEOUT_MS = parseInt(process.env.PLANNER_TIMEOUT_MS || '5000'); // 5 second planner timeout

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
    // STEP 2: Generate Quick Picks (deterministic scoring)
    // ============================================
    const scoringStart = Date.now();
    
    const currentHour = new Date().getHours();
    let daypart = 'afternoon';
    if (currentHour >= 0 && currentHour < 6) daypart = 'overnight';
    else if (currentHour >= 6 && currentHour < 10) daypart = 'early_morning';
    else if (currentHour >= 10 && currentHour < 14) daypart = 'morning';
    else if (currentHour >= 14 && currentHour < 18) daypart = 'afternoon';
    else if (currentHour >= 18 && currentHour < 22) daypart = 'evening';
    else daypart = 'late_night';

    // Get catalog venues filtered by daypart
    const catalogVenues = await db.select().from(venue_catalog);
    const daypartVenues = catalogVenues.filter(v => 
      v.dayparts && (v.dayparts.includes(daypart) || v.dayparts.includes('all_day'))
    );

    // Enrich with metrics
    const metricsData = await db.select().from(venue_metrics);
    const metricsMap = new Map(metricsData.map(m => [m.venue_id, m]));

    const venuesWithMetrics = daypartVenues.map(v => {
      const metrics = metricsMap.get(v.venue_id);
      return {
        ...v,
        times_recommended: metrics?.times_recommended || 0,
        positive_feedback: metrics?.positive_feedback || 0,
        negative_feedback: metrics?.negative_feedback || 0,
        reliability_score: metrics?.reliability_score || 0.5
      };
    });

    // Filter nearby venues (within 100km)
    const nearbyVenues = venuesWithMetrics.filter(venue => {
      if (!venue.lat || !venue.lng) return false;
      const R = 6371;
      const dLat = (venue.lat - lat) * Math.PI / 180;
      const dLon = (venue.lng - lng) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat * Math.PI / 180) * Math.cos(venue.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanceKm = R * c;
      return distanceKm <= 100;
    });

    // Score and sort
    const scored = nearbyVenues.map(venue => ({
      ...venue,
      score: scoreCandidate(venue, { lat, lng })
    }));
    scored.sort((a, b) => b.score - a.score);
    
    const diverse = applyDiversityGuardrails(scored, { minCategories: 2, maxPerCategory: 3 });
    const top30Candidates = diverse.slice(0, 30); // Top 30 for reranking
    
    const scoringMs = Date.now() - scoringStart;
    console.log(`✅ [${correlationId}] Quick Picks scored in ${scoringMs}ms: ${top30Candidates.length} candidates`);

    // ============================================
    // STEP 3: Parallel Race - Enrichment + Fast Planner
    // ============================================
    const driveCtx = { 
      tz: fullSnapshot.timezone,
      dow: new Date().getDay(), 
      hour: new Date().getHours() 
    };

    // Enrich top 12 with drive times for Quick Picks
    const quickPicks = await Promise.all(
      top30Candidates.slice(0, 12).map(async (v) => {
        const driveMin = await predictDriveMinutes({lat, lng}, {lat: v.lat, lng: v.lng}, driveCtx);
        const potential = Math.round(25 * Math.max(0.5, 1 - (driveMin / 60)));
        const surge = driveMin < 10 ? 1.5 : driveMin < 20 ? 1.2 : 1.0;
        return {
          ...v,
          driveTimeMinutes: driveMin,
          potential,
          surge: surge.toFixed(1),
          data: { driveTimeMinutes: driveMin, potential, surge: surge.toFixed(1) }
        };
      })
    );

    // Start fast planner in parallel (strict 5s timeout)
    const plannerStart = Date.now();
    const plannerPromise = rerankCandidates({
      candidates: top30Candidates,
      context: fullSnapshot,
      timeoutMs: PLANNER_TIMEOUT_MS
    }).catch(err => {
      console.warn(`[${correlationId}] Planner error: ${err.message}`);
      return null;
    });

    // Race: planner vs timeout (strict budget enforcement)
    const remainingBudget = PLANNER_BUDGET_MS - (Date.now() - wallClockStart);
    
    // If budget exhausted, skip planner immediately
    const plannerResult = remainingBudget <= 0 ? null : await Promise.race([
      plannerPromise,
      new Promise(resolve => setTimeout(() => resolve(null), remainingBudget))
    ]);

    const plannerMs = Date.now() - plannerStart;
    const plannerTimedOut = !plannerResult;
    
    // Enforce hard wall clock limit - bail if budget exceeded
    const elapsedSoFar = Date.now() - wallClockStart;
    if (elapsedSoFar >= PLANNER_BUDGET_MS) {
      console.log(`⏱️ [${correlationId}] Wall clock budget exhausted (${elapsedSoFar}ms) - forcing Quick Picks`);
    }
    
    let finalVenues = quickPicks;
    let pathTaken = 'deterministic';

    if (plannerResult && plannerResult.ranked_venue_ids && elapsedSoFar < PLANNER_BUDGET_MS) {
      // Planner succeeded and we're still under budget - rerank venues
      console.log(`✅ [${correlationId}] Planner reranked ${plannerResult.ranked_venue_ids.length} venues in ${plannerMs}ms`);
      
      const venueMap = new Map(top30Candidates.map(v => [v.venue_id, v]));
      finalVenues = plannerResult.ranked_venue_ids
        .map(id => venueMap.get(id))
        .filter(v => v !== undefined)
        .slice(0, 12);
      
      // Enrich reranked venues with drive times if not already done (skip if budget critical)
      const enrichmentBudget = PLANNER_BUDGET_MS - (Date.now() - wallClockStart);
      if (enrichmentBudget > 500) {
        finalVenues = await Promise.all(
          finalVenues.map(async (v) => {
            if (v.driveTimeMinutes) return v;
            const driveMin = await predictDriveMinutes({lat, lng}, {lat: v.lat, lng: v.lng}, driveCtx);
            const potential = Math.round(25 * Math.max(0.5, 1 - (driveMin / 60)));
            const surge = driveMin < 10 ? 1.5 : driveMin < 20 ? 1.2 : 1.0;
            return {
              ...v,
              driveTimeMinutes: driveMin,
              potential,
              surge: surge.toFixed(1),
              data: { driveTimeMinutes: driveMin, potential, surge: surge.toFixed(1) }
            };
          })
        );
      }
      
      pathTaken = 'refined';
    } else {
      console.log(`⏱️ [${correlationId}] Planner ${plannerTimedOut ? 'timed out' : 'failed'} after ${plannerMs}ms - using Quick Picks`);
    }

    const totalMs = Date.now() - wallClockStart;

    // ============================================
    // STEP 4: Persist to database with timing metrics
    // ============================================
    const isValidUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    const isValidSnapshotId = snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);

    const venuesToPersist = finalVenues.map((venue, i) => ({
      name: venue.name,
      place_id: venue.place_id || null,
      category: venue.category || null,
      rank: i + 1,
      lat: venue.lat ?? null,
      lng: venue.lng ?? null,
      distance_miles: null, // Will be calculated by Routes API if needed
      drive_time_minutes: venue.driveTimeMinutes ?? null,
      value_per_min: null,
      value_grade: null,
      surge: parseFloat(venue.surge) || null,
      est_earnings: venue.potential ?? null
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
          model_name: pathTaken === 'refined' ? 'gemini-2.5-pro-fast-rerank' : 'deterministic-quick-picks',
          scoring_ms: scoringMs,
          planner_ms: plannerMs,
          total_ms: totalMs,
          timed_out: plannerTimedOut,
          path_taken: pathTaken,
          ui: null
        });

        // Insert candidates
        for (const venue of venuesToPersist) {
          await tx.insert(ranking_candidates).values({
            id: randomUUID(),
            ranking_id: rid,
            block_id: `${venue.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${venue.lat}_${venue.lng}`,
            name: venue.name,
            lat: venue.lat,
            lng: venue.lng,
            drive_time_min: venue.drive_time_minutes,
            est_earnings_per_ride: venue.est_earnings,
            rank: venue.rank,
            exploration_policy: 'fast-tactical',
            place_id: venue.place_id,
            drive_time_minutes: venue.drive_time_minutes,
            distance_source: 'predictive'
          });
        }

        return rid;
      });

      console.log(`✅ [${correlationId}] Persisted ranking ${ranking_id} with timing: scoring=${scoringMs}ms planner=${plannerMs}ms total=${totalMs}ms path=${pathTaken}`);
    } catch (e) {
      console.error(`❌ [${correlationId}] Persistence failed:`, e);
      return sendOnce(502, { ok: false, error: 'persist_failed', correlationId });
    }

    // ============================================
    // STEP 5: Return response
    // ============================================
    const blocks = finalVenues.map((v, index) => ({
      name: v.name,
      address: v.address,
      category: v.category,
      placeId: v.place_id,
      coordinates: { lat: v.lat, lng: v.lng },
      estimated_distance_miles: 0, // Will be enriched by frontend if needed
      driveTimeMinutes: v.driveTimeMinutes || 0,
      distanceSource: 'predictive',
      surge: parseFloat(v.surge) || 1.0,
      estimated_earnings: v.potential || 0,
      potential: v.potential || 0,
      reliability_score: v.reliability_score || 0.5
    }));

    const response = {
      ok: true,
      correlationId,
      ranking_id,
      snapshot_id: fullSnapshot.snapshot_id,
      blocks,
      userId,
      generatedAt: new Date().toISOString(),
      strategy_for_now: pathTaken === 'refined' ? 'AI-refined tactical recommendations' : 'Quick deterministic picks',
      path_taken: pathTaken,
      refined: pathTaken === 'refined',
      timing: {
        scoring_ms: scoringMs,
        planner_ms: plannerMs,
        total_ms: totalMs,
        timed_out: plannerTimedOut,
        budget_ms: PLANNER_BUDGET_MS
      },
      metadata: {
        totalBlocks: blocks.length,
        processingTimeMs: totalMs,
        modelRoute: pathTaken === 'refined' ? 'gemini-2.5-pro-rerank' : 'deterministic'
      }
    };

    console.log(`✅ [${correlationId}] Fast blocks complete in ${totalMs}ms (${pathTaken}): ${blocks.length} venues`);
    sendOnce(200, response);

  } catch (error) {
    console.error(`❌ [${correlationId}] Error:`, error);
    sendOnce(500, {
      error: 'Internal server error',
      message: error.message,
      correlationId
    });
  }
});

export default router;
