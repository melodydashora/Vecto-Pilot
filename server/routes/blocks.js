// server/routes/blocks.js
// PRODUCTION ROUTE: Triad Architecture - Claude (Strategist) → GPT-5 (Planner) → Gemini (Validator)
// All model parameters driven by process.env - see .env.example
import { Router } from 'express';
import { latLngToCell } from 'h3-js';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { eq, desc, sql } from 'drizzle-orm';
import { venue_catalog, venue_metrics, snapshots, strategies, rankings, ranking_candidates, venue_feedback, llm_venue_suggestions } from '../../shared/schema.js';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { generateTacticalPlan } from '../lib/gpt5-tactical-planner.js';
import { getRouteWithTraffic } from '../lib/routes-api.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { enrichVenues } from '../lib/venue-enrichment.js';
import { researchMultipleVenueEvents } from '../lib/venue-event-research.js';

const router = Router();

// GET /api/blocks/strategy/:snapshotId - Fetch strategy for a specific snapshot
router.get('/strategy/:snapshotId', async (req, res) => {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  
  try {
    const { snapshotId } = req.params;

    // Allow internal test traffic to bypass crawler detection
    if (req.get("x-internal-test") !== "1") {
      // Cheap crawler screen: missing UA or classic bot strings → no content
      const ua = String(req.get("user-agent") || "").toLowerCase();
      if (!ua || /bot|crawler|spider|scrape|fetch|httpclient|monitor|headless/i.test(ua)) {
        console.log('[blocks] Crawler detected, returning 204', { ua });
        return res.status(204).end();
      }
    }

    if (!snapshotId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      return res.status(400).json({ 
        error: 'Invalid snapshot ID',
        message: 'Snapshot ID must be a valid UUID',
        correlationId 
      });
    }

    // Query the strategies table for this snapshot
    const [strategyRow] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .orderBy(desc(strategies.created_at))
      .limit(1);

    if (!strategyRow) {
      // No strategy row yet - check if snapshot exists and validate completeness
      const [snap] = await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);

      if (snap) {
        // Check if snapshot has all required fields
        const missing = [];
        if (snap.lat == null || !Number.isFinite(snap.lat)) missing.push("lat");
        if (snap.lng == null || !Number.isFinite(snap.lng)) missing.push("lng");
        if (!snap.city && !snap.formatted_address) missing.push("city_or_formattedAddress");
        if (!snap.timezone) missing.push("timezone");

        if (missing.length > 0) {
          // Snapshot exists but has missing critical fields - likely crawler or denied permissions
          console.warn('[blocks] Incomplete snapshot detected', { snapshotId, missing });
          return res.json({
            status: 'refresh_required',
            hasStrategy: false,
            fields_missing: missing,
            tip: 'Please refresh the page and enable location to continue.'
          });
        }

        // Snapshot is complete but strategy not written yet → report pending with Retry-After
        res.set('Retry-After', '1');
        return res.status(202).json({
          status: 'pending',
          hasStrategy: false,
          strategy: null,
          correlationId
        });
      }

      // Truly unknown snapshot ID
      return res.status(404).json({
        status: 'not_found',
        hasStrategy: false,
        strategy: null,
        correlationId
      });
    }

    // Generate ETag from updated_at timestamp
    const etag = `"${new Date(strategyRow.updated_at).getTime()}"`;
    
    // Check If-None-Match for caching
    if (req.get('if-none-match') === etag) {
      return res.status(304).end();
    }

    // Return current status from DB with ETag
    if (strategyRow.status === 'ok') {
      res.set('ETag', etag);
      return res.json({
        status: 'ok',
        hasStrategy: true,
        strategy: strategyRow.strategy,
        latency_ms: strategyRow.latency_ms,
        tokens: strategyRow.tokens,
        createdAt: strategyRow.created_at
      });
    }

    if (strategyRow.status === 'failed') {
      res.set('ETag', etag);
      return res.json({
        status: 'failed',
        hasStrategy: false,
        strategy: null,
        error_code: strategyRow.error_code,
        error_message: strategyRow.error_message,
        next_retry_at: strategyRow.next_retry_at
      });
    }

    // Still pending - tell client to back off
    res.set('Retry-After', '1');
    return res.status(202).json({
      status: 'pending',
      hasStrategy: false,
      strategy: null,
      attempt: strategyRow.attempt,
      correlationId
    });
  } catch (error) {
    console.error('[blocks] Strategy fetch error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch strategy',
      message: error.message,
      hasStrategy: false,
      correlationId
    });
  }
});

router.post('/', async (req, res) => {
  const { processBlocksRequestCore, BlocksProcessorError } = await import('./blocks-processor-full.js');
  
  try {
    const result = await processBlocksRequestCore({ body: req.body, headers: req.headers });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof BlocksProcessorError) {
      // Extract JSON if it was stringified
      let errorBody;
      try {
        errorBody = JSON.parse(e.message);
      } catch {
        errorBody = { ok: false, error: e.message };
      }
      return res.status(e.httpStatus).json(errorBody);
    }
    const correlationId = req.headers['x-correlation-id'] || randomUUID();
    console.error('[blocks-sync] unhandled:', e);
    return res.status(500).json({ ok: false, error: 'Internal error', correlationId });
  }
});

// OLD SYNC HANDLER BELOW - REPLACED BY SHARED PROCESSOR
/*
router_post_OLD('/', async (req, res) => {
  const startTime = Date.now();
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
    const snapshotId = req.headers['x-snapshot-id'];

    // Load snapshot from DB (already saved with GPS coordinates)
    if (!snapshotId) {
      return sendOnce(400, {
        error: 'snapshot_id_required',
        message: 'Snapshot ID required (from GPS snapshot creation)',
        correlationId
      });
    }

    console.log(`🎯 [${correlationId}] Loading snapshot ${snapshotId} from database...`);
    const [fullSnapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (!fullSnapshot) {
      return sendOnce(404, {
        error: 'snapshot_not_found',
        message: `Snapshot ${snapshotId} not found in database`
      });
    }

    const { lat, lng } = fullSnapshot;
    if (!lat || !lng) {
      return sendOnce(400, {
        error: 'invalid_snapshot',
        message: 'Snapshot missing GPS coordinates'
      });
    }

    // Get deterministic shortlist
    const currentHour = new Date().getHours();
    let daypart = 'afternoon';
    if (currentHour >= 0 && currentHour < 6) daypart = 'overnight';
    else if (currentHour >= 6 && currentHour < 10) daypart = 'early_morning';
    else if (currentHour >= 10 && currentHour < 14) daypart = 'morning';
    else if (currentHour >= 14 && currentHour < 18) daypart = 'afternoon';
    else if (currentHour >= 18 && currentHour < 22) daypart = 'evening';
    else daypart = 'late_night';

    const catalogVenues = await db.select().from(venue_catalog);
    const daypartVenues = catalogVenues.filter(v => 
      v.dayparts && (v.dayparts.includes(daypart) || v.dayparts.includes('all_day'))
    );

    const metricsData = await db.select().from(venue_metrics);
    const metricsMap = new Map(metricsData.map(m => [m.venue_id, m]));

    const venues = daypartVenues.map(v => {
      const metrics = metricsMap.get(v.venue_id);
      return {
        ...v,
        times_recommended: metrics?.times_recommended || 0,
        positive_feedback: metrics?.positive_feedback || 0,
        negative_feedback: metrics?.negative_feedback || 0,
        reliability_score: metrics?.reliability_score || 0.5
      };
    });

    // Filter out venues >100km away (global user check)
    const nearbyVenues = venues.filter(venue => {
      if (!venue.lat || !venue.lng) return false;
      
      // Haversine distance in km
      const R = 6371;
      const dLat = (venue.lat - lat) * Math.PI / 180;
      const dLon = (venue.lng - lng) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat * Math.PI / 180) * Math.cos(venue.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanceKm = R * c;
      
      return distanceKm <= 100; // Only keep venues within 100km
    });

    const scored = nearbyVenues.map(venue => ({
      ...venue,
      score: scoreCandidate(venue, { lat, lng })
    }));

    scored.sort((a, b) => b.score - a.score);
    const diverse = applyDiversityGuardrails(scored, { minCategories: 2, maxPerCategory: 3 });
    const shortlist = diverse.slice(0, 6);

    // Global user support: Catalog may be empty for international locations
    if (shortlist.length === 0) {
      const locationName = fullSnapshot.city 
        ? `${fullSnapshot.city}, ${fullSnapshot.state || fullSnapshot.country || 'global'}`
        : `coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      
      console.log(`🌍 [${correlationId}] No venue catalog matches for ${locationName} - GPT-5 will generate venues from scratch`);
    } else {
      console.log(`📋 [${correlationId}] Venue shortlist: ${shortlist.length} venues from catalog`);
    }

    // Enrich with drive times
    const driveCtx = { 
      tz: fullSnapshot.timezone, // Snapshot timezone required - no fallback
      dow: new Date().getDay(), 
      hour: new Date().getHours() 
    };

    const enriched = await Promise.all(
      shortlist.map(async (v) => {
        const driveMin = await predictDriveMinutes({lat, lng}, {lat: v.lat, lng: v.lng}, driveCtx);
        const potential = Math.round(25 * Math.max(0.5, 1 - (driveMin / 60)));
        const surge = driveMin < 10 ? 1.5 : driveMin < 20 ? 1.2 : 1.0;
        return {
          ...v,
          data: { driveTimeMinutes: driveMin, potential, surge: surge.toFixed(1) }
        };
      })
    );

    // ============================================
    // STEP 2: Load Consolidated Strategy (Claude + Gemini → GPT-5)
    // The three-stage pipeline runs in background via triad-worker
    // ============================================
    let consolidatedStrategy = null;

    if (snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      // Check if strategy already exists or is in progress
      const [existing] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .orderBy(desc(strategies.created_at))
        .limit(1);

      if (existing && existing.status === 'ok') {
        // Consolidated strategy already generated (Claude + Gemini briefing → GPT-5)
        consolidatedStrategy = existing.strategy;
        console.log(`✅ [${correlationId}] TRIAD Step 1/3: Using existing consolidated strategy from DB (Claude + Gemini → GPT-5)`);
      } else if (existing && existing.status === 'pending') {
        // Strategy generation in progress from snapshot background task
        const job = existing; // Alias for clarity
        const jobStatus = job.status;
        const attempt = job.attempt;

        // If strategy generation is pending, check for timeout
        if (jobStatus === 'pending') {
          const jobAge = Date.now() - job.createdAt;
          const maxWaitTime = 60000; // 60 seconds

          if (jobAge > maxWaitTime) {
            console.error(`[blocks] ⏱️ Job ${correlationId} exceeded 60s timeout, failing gracefully`);
            return sendOnce(504, {
              message: 'Strategy generation timed out after 60 seconds',
              status: 'timeout',
              correlationId: job.correlationId,
              error: 'The AI took too long to generate a strategy. Please try again.'
            });
          }

          return sendOnce(202, {
            message: 'Strategy generation in progress',
            status: 'pending',
            attempt: attempt,
            correlationId: job.correlationId,
            timeElapsed: `${Math.floor(jobAge / 1000)}s`
          });
        }
      } else if (!existing || existing.status === 'failed') {
        // No strategy or failed - generate new one (triggers full triad: Claude + Gemini → GPT-5)
        console.log(`🧠 [${correlationId}] TRIAD Step 1/3: Generating consolidated strategy for snapshot ${snapshotId}...`);

        const triadStart = Date.now();
        const { generateStrategyForSnapshot } = await import('../lib/strategy-generator.js');

        try {
          consolidatedStrategy = await generateStrategyForSnapshot(snapshotId);
          const triadElapsed = Date.now() - triadStart;

          if (!consolidatedStrategy) {
            console.error(`❌ [${correlationId}] Strategy generator returned null/empty`);
            return sendOnce(500, { 
              error: 'Strategy generation failed', 
              details: 'Strategy generator returned no content',
              correlationId 
            });
          }

          console.log(`✅ [${correlationId}] TRIAD Step 1/3 Complete: Consolidated strategy generated in ${triadElapsed}ms: "${consolidatedStrategy.slice(0, 80)}..."`);
        } catch (err) {
          console.error(`❌ [${correlationId}] Strategy generation failed: ${err.message}`);
          return sendOnce(500, { 
            error: 'Strategy generation failed', 
            details: err.message,
            correlationId 
          });
        }
      }
    }

    // ============================================
    // STEP 2.5: Workflow Gating (enforce consolidated strategy exists before planner)
    // Architectural guidance: No planner until consolidated strategy exists
    // ============================================
    if (!consolidatedStrategy) {
      console.warn(`⚠️ [${correlationId}] Consolidated strategy required for tactical planning`);
      return sendOnce(202, { 
        ok: false, 
        status: 'pending_strategy',
        message: 'Strategy generation in progress',
        correlationId 
      });
    }

    // ============================================
    // STEP 3: Run GPT-5 Tactical Planner with Consolidated Strategy
    // Input: Consolidated strategy (Claude strategic analysis + Gemini news briefing → GPT-5)
    // Output: Tactical venue recommendations with coordinates and pro tips
    // ============================================
    console.log(`🎯 [${correlationId}] TRIAD Step 2/3: Starting GPT-5 tactical planner...`);
    console.log(`📋 [${correlationId}] Planner input (consolidated strategy): "${consolidatedStrategy.slice(0, 100)}..."`);
    
    const plannerStart = Date.now();
    let tacticalPlan = null;

    try {
      tacticalPlan = await generateTacticalPlan({
        strategy: consolidatedStrategy,
        snapshot: fullSnapshot
      });

      const plannerElapsed = Date.now() - plannerStart;
      console.log(`✅ [${correlationId}] TRIAD Step 2/3 Complete: GPT-5 tactical plan (${plannerElapsed}ms): ${tacticalPlan.recommended_venues?.length || 0} venues`);
    } catch (err) {
      console.error(`❌ [${correlationId}] GPT-5 tactical planner failed: ${err.message}`);
      return sendOnce(500, { error: 'Tactical planning failed', details: err.message, correlationId });
    }

    if (!tacticalPlan || !tacticalPlan.recommended_venues?.length) {
      console.error(`❌ [${correlationId}] No valid output from GPT-5 tactical planner`);
      return sendOnce(500, { error: 'Tactical planning failed', correlationId });
    }

    // ============================================
    // STEP 4: Venue Enrichment with Google APIs
    // Architectural guidance: GPT-5 provides coords + tips, Google APIs provide facts
    // - Geocoding API: coords → address
    // - Routes API (New): accurate distances + drive times with traffic
    // - Places API (New): place_id + business status
    // ============================================
    console.log(`🔍 [${correlationId}] TRIAD Step 3/3: Enriching ${tacticalPlan.recommended_venues.length} venues with Google APIs...`);
    
    const enrichmentStart = Date.now();
    let enrichedVenues = [];

    try {
      enrichedVenues = await enrichVenues(
        tacticalPlan.recommended_venues,
        { lat: fullSnapshot.lat, lng: fullSnapshot.lng },
        fullSnapshot  // Pass full snapshot for timezone-aware hours calculation
      );
      
      const enrichmentElapsed = Date.now() - enrichmentStart;
      console.log(`✅ [${correlationId}] TRIAD Step 3/3 Complete: Enriched ${enrichedVenues.length} venues (${enrichmentElapsed}ms)`);
    } catch (err) {
      console.error(`❌ [${correlationId}] Venue enrichment failed: ${err.message}`);
      return sendOnce(500, { error: 'Venue enrichment failed', details: err.message, correlationId });
    }

    if (enrichedVenues.length === 0) {
      console.error(`❌ [${correlationId}] No venues successfully enriched - cannot proceed`);
      return sendOnce(502, { 
        ok: false, 
        error: 'venue_enrichment_failed',
        message: 'All recommended venues failed Google API enrichment',
        correlationId 
      });
    }

    console.log(`✅ [${correlationId}] Business hours enrichment complete: ${enrichedVenues.length} venues resolved`);

    // ============================================
    // STEP 4.5: Enrich staging location (Geocoding + Places split)
    // ============================================
    let enrichedStagingLocation = tacticalPlan.best_staging_location;
    if (tacticalPlan.best_staging_location) {
      try {
        console.log(`🔍 [${correlationId}] Resolving staging location: ${tacticalPlan.best_staging_location.name}`);
        
        let placeId = null;
        let lat = null;
        let lng = null;
        let address = null;

        // Resolve using name → Places or coords → Geocoding
        if (tacticalPlan.best_staging_location.name) {
          const placeData = await findPlaceIdByText({ 
            text: tacticalPlan.best_staging_location.name,
            lat: tacticalPlan.best_staging_location.lat,
            lng: tacticalPlan.best_staging_location.lng
          });
          placeId = placeData.place_id;
          lat = placeData.lat;
          lng = placeData.lng;
          address = placeData.formatted_address;
        } else if (tacticalPlan.best_staging_location.lat && tacticalPlan.best_staging_location.lng) {
          const geoData = await reverseGeocode({
            lat: tacticalPlan.best_staging_location.lat,
            lng: tacticalPlan.best_staging_location.lng
          });
          placeId = geoData.place_id;
          lat = geoData.lat;
          lng = geoData.lng;
          address = geoData.formatted_address;
        }

        enrichedStagingLocation = {
          ...tacticalPlan.best_staging_location,
          placeId,
          lat,
          lng,
          address
        };

        console.log(`✅ [${correlationId}] Staging location enriched: ${address}`);
      } catch (error) {
        console.warn(`⚠️ [${correlationId}] Failed to enrich staging location: ${error.message}`);
      }
    }

    // ============================================
    // STEP 5: Calculate traffic-aware distance & ETA using Routes API
    // ============================================
    console.log(`🔍 [${correlationId}] Calculating traffic-aware distance and ETA from validated coordinates...`);

    // Use Routes API (TRAFFIC_AWARE_OPTIMAL) with precise coords: driver snapshot + Google Places API coords
    const venuesWithDistance = await Promise.all(
      enrichedVenues.map(async v => {
        try {
          const routeData = await getRouteWithTraffic(
            { lat: fullSnapshot.lat, lng: fullSnapshot.lng },
            { lat: v.lat, lng: v.lng },
            { trafficModel: 'TRAFFIC_AWARE_OPTIMAL' }
          );
          
          const distanceMiles = (routeData.distanceMeters / 1609.344).toFixed(2);
          const driveTimeMinutes = Math.round(routeData.durationSeconds / 60);
          
          console.log(`📏 [${correlationId}] ${v.name}: ${distanceMiles} mi, ${driveTimeMinutes} min drive (Routes API)`);

          return { 
            ...v, 
            calculated_distance_miles: parseFloat(distanceMiles),
            driveTimeMinutes,
            distanceSource: 'routes_api'
          };
        } catch (error) {
          // If Routes API fails, fail the request (no Haversine fallback in production)
          console.error(`❌ [${correlationId}] Routes API failed for ${v.name}: ${error.message}`);
          throw new Error(`Routes API unavailable for ${v.name}`);
        }
      })
    );

    // ============================================
    // STEP 5.5: Workflow Gating (enforce all venues resolved before Gemini)
    // Architectural guidance: No Gemini until every candidate has place_id, lat, lng
    // ============================================
    console.log(`🔍 [${correlationId}] DEBUG: First venue data structure:`, JSON.stringify(venuesWithDistance[0], null, 2));
    for (const v of venuesWithDistance) {
      // Allow venues without placeId as long as they have coordinates from GPT-5
      if (v.lat == null || v.lng == null) {
        console.error(`❌ [${correlationId}] Venue not resolved: ${v.name} (missing coords)`);
        console.error(`❌ [${correlationId}] DEBUG - Venue data:`, JSON.stringify(v, null, 2));
        throw new Error('venue_not_resolved - all venues must have lat, lng before Gemini');
      }
      if (!v.placeId) {
        console.warn(`⚠️ [${correlationId}] Venue "${v.name}" has no placeId (Google Places lookup failed) - using GPT-5 coords only`);
      }
    }

    // Use Gemini to calculate earnings and validate (with closed venue reasoning)
    const { enrichVenuesWithGemini } = await import('../lib/gemini-enricher.js');
    const geminiEnriched = await enrichVenuesWithGemini({
      venues: venuesWithDistance,
      driverLocation: { lat: fullSnapshot.lat, lng: fullSnapshot.lng },
      snapshot: fullSnapshot
    });

    console.log(`🔍 [${correlationId}] Gemini raw response (first venue):`, JSON.stringify(geminiEnriched[0], null, 2));

    // Key-based merge (Invariant 7: merge by key never index)
    const keyOf = (x) => (x.placeId || x.name || '').toLowerCase();
    const toNum = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    const gmap = new Map(
      geminiEnriched.map(g => [keyOf(g), {
        dist: Number(g.estimated_distance_miles),
        earn: toNum(g.estimated_earnings_per_ride ?? g.estimated_earnings),
        epm: Number(g.earnings_per_mile),
        rank: Number(g.ranking_score),
        vs: g.validation_status,
        cr: g.closed_venue_reasoning
      }])
    );
    const fullyEnrichedVenues = venuesWithDistance.map(v => {
      const g = gmap.get(keyOf(v)) || {};
      const dist = Number.isFinite(g.dist) ? g.dist : v.calculated_distance_miles;
      const earn = Number.isFinite(g.earn) ? g.earn : (v?.data?.potential ?? 0);
      const epm = Number.isFinite(g.epm) ? g.epm : (dist > 0 && earn > 0 ? Number((earn / dist).toFixed(2)) : 0);
      
      // Calculate value per minute using env-based parameters
      const base = Number(process.env.VALUE_BASE_RATE_PER_MIN || 1);
      const tTrip = v.stats?.medianTripMin ?? Number(process.env.VALUE_DEFAULT_TRIP_MIN || 15);
      const tWait = v.queue?.expectedWaitMin ?? Number(process.env.VALUE_DEFAULT_WAIT_MIN || 0);
      const surge = v.surge ?? 1.0;
      const perMin = base * surge;
      const engagedRevenue = perMin * tTrip;
      const totalTime = (v.driveTimeMinutes ?? 0) + tWait + tTrip;
      const valuePerMin = totalTime > 0 ? +(engagedRevenue / totalTime).toFixed(2) : 0;
      const minAccept = Number(process.env.VALUE_MIN_ACCEPTABLE_PER_MIN || 0.5);
      const valueGrade = valuePerMin >= 1.0 ? "A" : valuePerMin >= 0.75 ? "B" : valuePerMin >= 0.5 ? "C" : "D";
      const notWorth = valuePerMin < minAccept;
      
      return {
        ...v,
        estimated_distance_miles: dist,
        estimated_earnings: earn,
        earnings_per_mile: epm,
        ranking_score: g.rank || 0,
        validation_status: g.vs || 'unknown',
        closed_venue_reasoning: g.cr || null,
        // Value per minute fields
        value_per_min: valuePerMin,
        value_grade: valueGrade,
        not_worth: notWorth,
        rate_per_min_used: perMin,
        trip_minutes_used: tTrip,
        wait_minutes_used: tWait
      };
    });

    // Sort by value_per_min (descending), with not_worth items last
    fullyEnrichedVenues.sort((a, b) => {
      if (a.not_worth !== b.not_worth) return a.not_worth - b.not_worth;
      return b.value_per_min - a.value_per_min;
    });

    console.log(`✅ [${correlationId}] TRIAD Step 3/3 Complete: Gemini 2.5 Pro validation with value-per-minute ranking`);
    console.log(`💰 [${correlationId}] Sample enriched venue:`, {
      name: fullyEnrichedVenues[0]?.name,
      distance: fullyEnrichedVenues[0]?.estimated_distance_miles,
      driveTime: fullyEnrichedVenues[0]?.driveTimeMinutes,
      value_per_min: fullyEnrichedVenues[0]?.value_per_min,
      value_grade: fullyEnrichedVenues[0]?.value_grade,
      not_worth: fullyEnrichedVenues[0]?.not_worth,
      validation: fullyEnrichedVenues[0]?.validation_status
    });

    // Convert to compatible format for existing ML pipeline
    const triadPlan = {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      strategy_for_now: consolidatedStrategy,
      per_venue: fullyEnrichedVenues.map(v => ({
        name: v.name,
        description: v.description,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        category: v.category,
        estimated_distance_miles: v.estimated_distance_miles,
        driveTimeMinutes: v.driveTimeMinutes,
        distanceSource: v.distanceSource,
        estimated_earnings: v.estimated_earnings,
        earnings_per_mile: v.earnings_per_mile,
        value_per_min: v.value_per_min,
        value_grade: v.value_grade,
        not_worth: v.not_worth,
        surge: v.surge ?? 1.0,
        pro_tips: v.pro_tips || [],
        placeId: v.placeId,
        businessHours: v.businessHours,
        isOpen: v.isOpen,
        businessStatus: v.businessStatus,
        hasSpecialHours: v.hasSpecialHours,
        validation_status: v.validation_status,
        closed_venue_reasoning: v.closed_venue_reasoning
      })),
      best_staging_location: enrichedStagingLocation,
      staging: [], // Legacy field
      seed_additions: [], // Legacy field
      model_route: "gpt-5-triad",
      tactical_summary: tacticalPlan.tactical_summary,
      suggested_db_fields: tacticalPlan.suggested_db_fields,
      validation: { status: "ok", flags: [] },
      metadata: tacticalPlan.metadata
    };

    // ============================================
    // STEP 3: ML Training Data Capture (Transactional)
    // ============================================
    const validated = triadPlan;

    // Only use userId if it's a valid UUID format
    const isValidUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

    // Only use snapshotId if it's a valid UUID (not "live-snapshot")
    const isValidSnapshotId = snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);

    // Persist ranking and candidates atomically - FAIL HARD if this fails
    let ranking_id;
    try {
      console.log(`💾 [${correlationId}] Preparing database persistence for ${fullyEnrichedVenues.length} venues...`);
      
      const venues = fullyEnrichedVenues.map((venue, i) => {
        console.log(`📊 [${correlationId}] Venue ${i + 1}: ${venue.name} - lat: ${venue.lat}, lng: ${venue.lng}, dist: ${venue.estimated_distance_miles} mi, time: ${venue.driveTimeMinutes} min, place_id: ${venue.placeId}, value_per_min: ${venue.value_per_min}, grade: ${venue.value_grade}`);
        
        return {
          name: venue.name,
          place_id: venue.placeId || null,
          category: venue.category || null,
          rank: i + 1,
          lat: venue.lat ?? null,
          lng: venue.lng ?? null,
          distance_miles: venue.estimated_distance_miles ?? null,
          drive_time_minutes: venue.driveTimeMinutes ?? null,
          value_per_min: venue.value_per_min ?? null,
          value_grade: venue.value_grade || null,
          surge: venue.surge ?? null,
          est_earnings: venue.estimated_earnings ?? null
        };
      });

      console.log(`🔐 [${correlationId}] Starting atomic transaction (rankings + ${venues.length} candidates)...`);
      
      ranking_id = await persistRankingTx({
        snapshot_id: isValidSnapshotId ? snapshotId : null,
        user_id: isValidUuid ? userId : null,
        city: fullSnapshot?.city || null,
        model_name: triadPlan.model_route,
        venues,
        correlation_id: correlationId
      });

      console.info(`✅ [${correlationId}] TRANSACTION COMMITTED: ranking ${ranking_id} with ${venues.length} candidates persisted successfully`);
      
      // ============================================
      // BACKGROUND: Research events at each venue (non-blocking)
      // ============================================
      setImmediate(async () => {
        try {
          console.log(`🎪 [${correlationId}] Researching events for ${venues.length} venues...`);
          
          const venueList = venues.map(v => ({
            name: v.name,
            city: fullSnapshot?.city || 'unknown',
            place_id: v.place_id
          }));
          
          const eventResults = await researchMultipleVenueEvents(venueList);
          
          // Update each ranking_candidate with event data and badge
          for (const eventData of eventResults) {
            const venue = venues.find(v => v.name === eventData.venue_name);
            if (venue?.place_id && eventData.has_events) {
              try {
                await db.execute(sql`
                  UPDATE ranking_candidates
                  SET venue_events = ${JSON.stringify(eventData)}
                  WHERE ranking_id = ${ranking_id}
                  AND place_id = ${venue.place_id}
                `);
                console.log(`🎪 [${correlationId}] ${venue.name}: ${eventData.badge || 'Event detected'}`);
              } catch (updateErr) {
                console.warn(`⚠️ [${correlationId}] Event update failed for ${venue.name}:`, updateErr.message);
              }
            }
          }
          
          const withEvents = eventResults.filter(e => e.has_events).length;
          console.log(`✅ [${correlationId}] Event research complete: ${withEvents}/${venues.length} venues have events today`);
        } catch (eventErr) {
          console.warn(`⚠️ [${correlationId}] Event research failed (non-blocking):`, eventErr.message);
        }
      });
      
    } catch (e) {
      console.error(`❌ [${correlationId}] TRANSACTION FAILED - Database persistence error:`, e);
      return res.status(502).json({ ok:false, error:"persist_failed", correlationId });
    }

    // ============================================
    // STEP 3.4: Log seed additions to llm_venue_suggestions (non-blocking)
    // ============================================
    if (Array.isArray(triadPlan?.seed_additions) && triadPlan.seed_additions.length > 0) {
      try {
        const { randomUUID } = await import('crypto');
        for (const seed of triadPlan.seed_additions) {
          await db.insert(llm_venue_suggestions).values({
            suggestion_id: randomUUID(),
            model_name: triadPlan.model_route || 'gemini-2.5-pro',
            ranking_id: ranking_id,
            venue_name: String(seed?.name || seed || '').slice(0, 128),
            suggested_category: seed?.category || null,
            llm_reasoning: seed?.why || seed?.reasoning || null,
            validation_status: 'pending',
            suggested_at: new Date()
          });
        }
        console.log(`💡 [${correlationId}] Logged ${triadPlan.seed_additions.length} seed additions to llm_venue_suggestions`);
      } catch (suggErr) {
        console.warn(`⚠️ [${correlationId}] Seed additions logging failed (non-blocking):`, suggErr.message);
      }
    }

    // ============================================
    // STEP 3.5: Enrich with feedback counts (non-blocking)
    // ============================================
    let feedbackMap = new Map();
    try {
      const feedbackCounts = await db
        .select({
          place_id: venue_feedback.place_id,
          up_count: sql`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'up')::int`.as('up_count'),
          down_count: sql`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'down')::int`.as('down_count'),
        })
        .from(venue_feedback)
        .where(eq(venue_feedback.ranking_id, ranking_id))
        .groupBy(venue_feedback.place_id);
      
      feedbackMap = new Map(feedbackCounts.map(f => [f.place_id || '', { up: f.up_count || 0, down: f.down_count || 0 }]));
      console.log(`📊 [${correlationId}] Feedback enrichment: ${feedbackCounts.length} venues with feedback`);
    } catch (feedbackErr) {
      console.warn(`⚠️ [${correlationId}] Feedback enrichment failed (non-blocking):`, feedbackErr.message);
    }

    // ============================================
    // STEP 3.6: Pull event data from database (non-blocking)
    // ============================================
    let eventsMap = new Map();
    try {
      const eventData = await db
        .select({
          place_id: ranking_candidates.place_id,
          venue_events: ranking_candidates.venue_events,
        })
        .from(ranking_candidates)
        .where(eq(ranking_candidates.ranking_id, ranking_id));
      
      console.log(`🎪 [${correlationId}] Event query returned ${eventData.length} rows`);
      
      for (const row of eventData) {
        if (row.venue_events && typeof row.venue_events === 'object') {
          eventsMap.set(row.place_id || '', row.venue_events);
          console.log(`🎪 [${correlationId}] Added event for place_id "${row.place_id}": ${row.venue_events.badge}`);
        }
      }
      console.log(`🎪 [${correlationId}] Event enrichment complete: ${eventsMap.size} venues with event data`);
    } catch (eventsErr) {
      console.error(`❌ [${correlationId}] Event enrichment failed:`, eventsErr);
    }

    // ============================================
    // STEP 4: Return normalized result
    // ============================================
    const blocks = triadPlan.per_venue.map((v, index) => {
      const feedback = feedbackMap.get(v.placeId || '') || { up: 0, down: 0 };
      const eventData = eventsMap.get(v.placeId || '') || null;
      
      if (eventData) {
        console.log(`🎪 [${correlationId}] Venue "${v.name}" (placeId: "${v.placeId}"): Event badge = "${eventData.badge}"`);
      } else if (v.placeId) {
        console.log(`⚠️ [${correlationId}] Venue "${v.name}" (placeId: "${v.placeId}"): NO event data found in map`);
      }
      
      return {
      name: v.name,
      address: v.address,
      category: v.category,
      placeId: v.placeId,
      coordinates: { lat: v.lat, lng: v.lng },
      estimated_distance_miles: Number(v.estimated_distance_miles),
      driveTimeMinutes: Number(v.driveTimeMinutes),
      distanceSource: v.distanceSource || "routes_api",
      value_per_min: v.value_per_min ?? null,
      value_grade: v.value_grade ?? null,
      not_worth: !!v.not_worth,
      surge: v.surge ?? 1.0,
      estimated_earnings: v.estimated_earnings ?? null,
      earnings_per_mile: v.earnings_per_mile ?? null,
      businessHours: v.businessHours ?? null,
      isOpen: v.isOpen === true,
      type: v.type || "destination",
      stagingArea: v.stagingArea ?? enrichedStagingLocation ?? null,
      // Additional fields for backward compat
      description: v.description,
      estimatedWaitTime: v.estimated_distance_miles ? Math.round(v.estimated_distance_miles * 2) : null,
      estimatedEarningsPerRide: v.estimated_earnings,
      potential: v.estimated_earnings,
      earningsPerMile: v.earnings_per_mile,
      demandLevel: v.earnings_per_mile > 4 ? 'high' : v.earnings_per_mile > 3 ? 'medium' : 'low',
      proTips: v.pro_tips || [],
      pro_tips: v.pro_tips || [],
      bestTimeWindow: v.best_time_window,
      businessStatus: v.businessStatus,
      hasSpecialHours: v.hasSpecialHours,
      closed_venue_reasoning: v.closed_venue_reasoning,
      // Feedback counts
      up_count: feedback.up,
      down_count: feedback.down,
      // Event data from database
      hasEvent: eventData?.has_events || false,
      eventBadge: eventData?.badge || null,
      eventSummary: eventData?.summary || null,
      eventImpact: eventData?.impact || null
    };
    });

    const response = {
      ok: true,
      correlationId,
      ranking_id,  // ✅ Add actual database ranking_id for action logging
      snapshot_id: fullSnapshot.snapshot_id,
      blocks,
      userId,
      generatedAt: new Date().toISOString(),
      strategy_for_now: triadPlan.strategy_for_now,
      tactical_summary: triadPlan.tactical_summary,
      best_staging_location: enrichedStagingLocation,
*/
      seed_additions: triadPlan.seed_additions || [],
      validation: triadPlan.validation || { status: 'ok', flags: [] },
      elapsed_ms: Date.now() - startTime,
      model_route: triadPlan.model_route || 'claude-opus-4.1→gpt-5',
      timing: triadPlan.timing || {},
      metadata: {
        totalBlocks: triadPlan.per_venue.length,
        processingTimeMs: Date.now() - startTime,
        modelRoute: triadPlan.model_route,
        validation: triadPlan.validation
      }
    };

    console.log(`✅ [${correlationId}] Complete in ${response.elapsed_ms}ms: ${response.blocks.length} venues with business hours`);
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