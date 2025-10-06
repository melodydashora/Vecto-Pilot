// server/routes/blocks.js
// PRODUCTION ROUTE: Triad Architecture - Claude (Strategist) → GPT-5 (Planner) → Gemini (Validator)
// All model parameters driven by process.env - see .env.example
import { Router } from 'express';
import { latLngToCell } from 'h3-js';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, strategies, rankings, ranking_candidates } from '../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { runTriadPlan } from '../lib/triad-orchestrator.js';
import { generateTacticalPlan } from '../lib/gpt5-tactical-planner.js';

const router = Router();

// GET /api/blocks/strategy/:snapshotId - Fetch strategy for a specific snapshot
router.get('/strategy/:snapshotId', async (req, res) => {
  try {
    const { snapshotId } = req.params;
    
    // Cheap crawler screen: missing UA or classic bot strings → no content
    const ua = String(req.get("user-agent") || "").toLowerCase();
    if (!ua || /bot|crawler|spider|scrape|fetch|httpclient|monitor|headless/i.test(ua)) {
      console.log('[blocks] Crawler detected, returning 204', { ua });
      return res.status(204).end();
    }
    
    if (!snapshotId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      return res.status(400).json({ error: 'Invalid snapshot ID' });
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
        
        // Snapshot is complete but strategy not written yet → report pending
        return res.json({
          status: 'pending',
          hasStrategy: false,
          strategy: null
        });
      }
      
      // Truly unknown snapshot ID
      return res.status(404).json({
        status: 'not_found',
        hasStrategy: false,
        strategy: null
      });
    }
    
    // Return current status from DB
    if (strategyRow.status === 'ok') {
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
      return res.json({
        status: 'failed',
        hasStrategy: false,
        strategy: null,
        error_code: strategyRow.error_code,
        error_message: strategyRow.error_message,
        next_retry_at: strategyRow.next_retry_at
      });
    }
    
    // Still pending
    return res.json({
      status: 'pending',
      hasStrategy: false,
      strategy: null,
      attempt: strategyRow.attempt
    });
  } catch (error) {
    console.error('[blocks] Strategy fetch error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch strategy',
      hasStrategy: false 
    });
  }
});

router.post('/', async (req, res) => {
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
    const { userId = 'demo', origin } = req.body;
    
    if (!origin?.lat || !origin?.lng) {
      return sendOnce(400, {
        error: 'Missing origin coordinates',
        message: 'Request body must include origin.lat and origin.lng'
      });
    }
    
    const { lat, lng } = origin;
    console.log(`🎯 [${correlationId}] BLOCKS REQUEST: lat=${lat} lng=${lng} userId=${userId}`);
    
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
    
    const scored = venues.map(venue => ({
      ...venue,
      score: scoreCandidate(venue, { lat, lng })
    }));
    
    scored.sort((a, b) => b.score - a.score);
    const diverse = applyDiversityGuardrails(scored, { minCategories: 2, maxPerCategory: 3 });
    const shortlist = diverse.slice(0, 6);
    
    // Enrich with drive times
    const driveCtx = { 
      tz: 'America/Chicago', // Default to Central (DFW area)
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
    // STEP 1: Load snapshot for context
    // ============================================
    const snapshotId = req.headers['x-snapshot-id'];
    let fullSnapshot = null;
    
    // Only load from DB if we have a valid UUID (not "live-snapshot" dummy)
    if (snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      try {
        const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
        if (snap) {
          fullSnapshot = {
            ...snap,
            weather: `${snap.weather?.temp || ''}°F ${snap.weather?.description || ''}`.trim(),
            air_quality: `AQI ${snap.air?.aqi || ''}`,
            airport_context: snap.airport_context ? JSON.stringify(snap.airport_context) : 'No delays'
          };
        }
      } catch (err) {
        console.log(`⚠️ Snapshot load failed: ${err.message}`);
      }
    } else if (snapshotId === 'live-snapshot') {
      console.log(`📸 Using live snapshot mode (no DB lookup)`);
    }
    
    // ============================================
    // STEP 2: Generate Claude's Strategy (synchronous triad)
    // ============================================
    let claudeStrategy = null;
    
    if (snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      // Check if strategy already exists or is in progress
      const [existing] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .orderBy(desc(strategies.created_at))
        .limit(1);
      
      if (existing && existing.status === 'ok') {
        // Strategy already generated successfully
        claudeStrategy = existing.strategy;
        console.log(`✅ [${correlationId}] Using existing Claude strategy from DB`);
      } else if (existing && existing.status === 'pending') {
        // Strategy generation in progress from snapshot background task
        console.log(`⏳ [${correlationId}] Strategy generation already in progress, skipping duplicate attempt`);
        return sendOnce(202, { 
          message: 'Strategy generation in progress',
          status: 'pending',
          attempt: existing.attempt,
          correlationId 
        });
      } else if (!existing || existing.status === 'failed') {
        // No strategy or failed - generate new one
        console.log(`🧠 [${correlationId}] Generating Claude strategy for snapshot ${snapshotId} (synchronous triad)...`);
        
        const claudeStart = Date.now();
        const { generateStrategyForSnapshot } = await import('../lib/strategy-generator.js');
        
        try {
          claudeStrategy = await generateStrategyForSnapshot(snapshotId);
          const claudeElapsed = Date.now() - claudeStart;
          
          if (!claudeStrategy) {
            console.error(`❌ [${correlationId}] Claude returned null/empty strategy`);
            return sendOnce(500, { 
              error: 'Claude strategy generation failed', 
              details: 'Strategy generator returned no content',
              correlationId 
            });
          }
          
          console.log(`✅ [${correlationId}] Claude strategy generated in ${claudeElapsed}ms: "${claudeStrategy.slice(0, 80)}..."`);
        } catch (err) {
          console.error(`❌ [${correlationId}] Claude strategy generation failed: ${err.message}`);
          return sendOnce(500, { 
            error: 'Claude strategy generation failed', 
            details: err.message,
            correlationId 
          });
        }
      }
    }
    
    // ============================================
    // STEP 3: Run GPT-5 Tactical Planner with Claude's Strategy
    // ============================================
    const plannerStart = Date.now();
    let tacticalPlan = null;
    
    try {
      tacticalPlan = await generateTacticalPlan({
        strategy: claudeStrategy,
        snapshot: fullSnapshot
      });
      
      const plannerElapsed = Date.now() - plannerStart;
      console.log(`✅ [${correlationId}] GPT-5 tactical plan complete (${plannerElapsed}ms): ${tacticalPlan.recommended_venues?.length || 0} venues recommended`);
    } catch (err) {
      console.error(`❌ [${correlationId}] GPT-5 tactical planner failed: ${err.message}`);
      return sendOnce(500, { error: 'Tactical planning failed', details: err.message, correlationId });
    }
    
    if (!tacticalPlan || !tacticalPlan.recommended_venues?.length) {
      console.error(`❌ [${correlationId}] No valid output from GPT-5 tactical planner`);
      return sendOnce(500, { error: 'Tactical planning failed', correlationId });
    }
    
    // ============================================
    // STEP 4: Enrich venues with business hours from Google Places API
    // ============================================
    console.log(`🔍 [${correlationId}] Enriching ${tacticalPlan.recommended_venues.length} venues with business hours...`);
    const { findPlaceId, getFormattedHours } = await import('../lib/places-hours.js');
    
    const enrichedVenues = await Promise.all(
      tacticalPlan.recommended_venues.map(async (v) => {
        try {
          // Find Place ID using name and coordinates
          const placeId = await findPlaceId(v.name, { lat: v.lat, lng: v.lng });
          
          // Get business hours, address, AND precise coordinates from Google Places API
          const hoursData = await getFormattedHours(placeId);
          
          console.log(`✅ [${correlationId}] Enriched ${v.name}: ${hoursData.status}, ${hoursData.hours?.length || 0} hours, address: ${hoursData.address || 'N/A'}`);
          
          return {
            ...v,
            address: hoursData.address || null,
            lat: hoursData.lat || v.lat, // Use API coords if available, fallback to GPT-5
            lng: hoursData.lng || v.lng,
            placeId,
            businessHours: hoursData.hours,
            isOpen: hoursData.status === 'open',
            businessStatus: hoursData.status,
            hasSpecialHours: hoursData.hasSpecialHours
          };
        } catch (error) {
          console.warn(`⚠️ [${correlationId}] Failed to enrich ${v.name}: ${error.message}`);
          // Return venue without hours enrichment
          return {
            ...v,
            address: null,
            businessHours: null,
            isOpen: null,
            businessStatus: 'unknown',
            hasSpecialHours: false
          };
        }
      })
    );
    
    console.log(`✅ [${correlationId}] Business hours enrichment complete`);
    
    // ============================================
    // STEP 4.5: Enrich staging location with Google Places API
    // ============================================
    let enrichedStagingLocation = tacticalPlan.best_staging_location;
    if (tacticalPlan.best_staging_location) {
      try {
        console.log(`🔍 [${correlationId}] Resolving staging location: ${tacticalPlan.best_staging_location.name}`);
        const stagingPlaceId = await findPlaceId(
          tacticalPlan.best_staging_location.name, 
          { lat: tacticalPlan.best_staging_location.lat, lng: tacticalPlan.best_staging_location.lng }
        );
        const stagingData = await getFormattedHours(stagingPlaceId);
        
        enrichedStagingLocation = {
          ...tacticalPlan.best_staging_location,
          address: stagingData.address || null,
          lat: stagingData.lat || tacticalPlan.best_staging_location.lat,
          lng: stagingData.lng || tacticalPlan.best_staging_location.lng
        };
        
        console.log(`✅ [${correlationId}] Staging location enriched: ${enrichedStagingLocation.address}`);
      } catch (error) {
        console.warn(`⚠️ [${correlationId}] Failed to enrich staging location: ${error.message}`);
      }
    }
    
    // ============================================
    // STEP 5: Calculate precise distance using API-validated coordinates
    // ============================================
    console.log(`🔍 [${correlationId}] Calculating precise distances from validated coordinates...`);
    
    // Use Haversine formula with precise coords: driver snapshot + Google Places API coords
    const venuesWithDistance = enrichedVenues.map(v => {
      const R = 3959; // Earth radius in miles
      const lat1 = fullSnapshot.lat * Math.PI / 180;
      const lat2 = v.lat * Math.PI / 180;
      const dLat = (v.lat - fullSnapshot.lat) * Math.PI / 180;
      const dLng = (v.lng - fullSnapshot.lng) * Math.PI / 180;
      
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = parseFloat((R * c).toFixed(2));
      
      console.log(`📏 [${correlationId}] ${v.name}: ${distance} miles from driver`);
      
      return { ...v, calculated_distance_miles: distance };
    });
    
    // Use Gemini to calculate earnings and validate (with closed venue reasoning)
    const { enrichVenuesWithGemini } = await import('../lib/gemini-enricher.js');
    const geminiEnriched = await enrichVenuesWithGemini({
      venues: venuesWithDistance,
      driverLocation: { lat: fullSnapshot.lat, lng: fullSnapshot.lng },
      snapshot: fullSnapshot
    });
    
    console.log(`🔍 [${correlationId}] Gemini raw response (first venue):`, JSON.stringify(geminiEnriched[0], null, 2));
    
    // Merge Gemini data back with venue data
    const fullyEnrichedVenues = venuesWithDistance.map((v, i) => ({
      ...v,
      estimated_distance_miles: geminiEnriched[i]?.estimated_distance_miles || v.calculated_distance_miles,
      estimated_earnings: geminiEnriched[i]?.estimated_earnings_per_ride || geminiEnriched[i]?.estimated_earnings || 0,
      earnings_per_mile: geminiEnriched[i]?.earnings_per_mile || 0,
      ranking_score: geminiEnriched[i]?.ranking_score || 0,
      validation_status: geminiEnriched[i]?.validation_status || 'unknown',
      closed_venue_reasoning: geminiEnriched[i]?.closed_venue_reasoning || null
    }));
    
    console.log(`✅ [${correlationId}] Gemini enrichment complete`);
    console.log(`💰 [${correlationId}] Sample enriched venue:`, {
      name: fullyEnrichedVenues[0]?.name,
      distance: fullyEnrichedVenues[0]?.estimated_distance_miles,
      earnings: fullyEnrichedVenues[0]?.estimated_earnings,
      earningsPerMile: fullyEnrichedVenues[0]?.earnings_per_mile,
      validation: fullyEnrichedVenues[0]?.validation_status
    });
    
    // Convert to compatible format for existing ML pipeline
    const triadPlan = {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      strategy_for_now: claudeStrategy,
      per_venue: fullyEnrichedVenues.map(v => ({
        name: v.name,
        description: v.description,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        category: v.category,
        estimated_distance_miles: v.estimated_distance_miles,
        estimated_earnings: v.estimated_earnings,
        earnings_per_mile: v.earnings_per_mile,
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
      model_route: "claude-opus-4.1→gpt-5→gemini-2.0",
      tactical_summary: tacticalPlan.tactical_summary,
      suggested_db_fields: tacticalPlan.suggested_db_fields,
      validation: { status: "ok", flags: [] },
      metadata: tacticalPlan.metadata
    };
    
    // ============================================
    // STEP 3: ML Training Data Capture
    // ============================================
    const validated = triadPlan;
    
    // Log to ML tables for training
    try {
      const rankingId = correlationId; // Use correlation ID as ranking ID
      
      // Only use userId if it's a valid UUID format
      const isValidUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      
      // Only use snapshotId if it's a valid UUID (not "live-snapshot")
      const isValidSnapshotId = snapshotId && snapshotId !== 'live-snapshot' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);
      
      // Create ranking record
      await db.insert(rankings).values({
        ranking_id: rankingId,
        created_at: new Date(),
        snapshot_id: isValidSnapshotId ? snapshotId : null,
        user_id: isValidUuid ? userId : null,
        city: fullSnapshot?.city || null,
        model_name: triadPlan.model_route,
        ui: { 
          model_route: triadPlan.model_route,
          version: triadPlan.version,
          timing: triadPlan.timing || {},
          validation: triadPlan.validation
        }
      });
      
      // Log each venue as a ranking candidate for ML training
      for (let i = 0; i < enriched.length; i++) {
        const venue = enriched[i];
        await db.insert(ranking_candidates).values({
          id: randomUUID(),
          ranking_id: rankingId,
          block_id: venue.venue_id,
          name: venue.name,
          lat: venue.lat,
          lng: venue.lng,
          drive_time_min: venue.data.driveTimeMinutes,
          est_earnings_per_ride: venue.data.potential,
          model_score: null, // LLM-based, not scored
          rank: i + 1,
          exploration_policy: 'llm_based',
          epsilon: null,
          was_forced: false,
          propensity: 1.0 / enriched.length, // Equal propensity for LLM selections
          features: {
            category: venue.category,
            surge: parseFloat(venue.data.surge),
            reliability_score: venue.reliability_score,
            daypart,
            weather: fullSnapshot?.weather || null,
            airport_context: fullSnapshot?.airport_context || null
          },
          h3_r8: fullSnapshot?.h3_r8 || null
        });
      }
      
      console.log(`📊 ML Training: Logged ranking ${rankingId} with ${enriched.length} LLM-recommended venues`);
    } catch (mlError) {
      console.error('⚠️ ML logging failed (non-blocking):', mlError);
    }
    
    // ============================================
    // STEP 4: Return complete result
    // ============================================
    const response = {
      correlationId,
      userId,
      generatedAt: new Date().toISOString(),
      strategy_for_now: triadPlan.strategy_for_now,
      tactical_summary: triadPlan.tactical_summary, // GPT-5's tactical summary
      best_staging_location: enrichedStagingLocation, // GPT-5's staging recommendation (enriched with Google Places API)
      blocks: triadPlan.per_venue.map((venue, index) => ({
        name: venue.name,
        description: venue.description,
        address: venue.address,
        category: venue.category,
        coordinates: { lat: venue.lat, lng: venue.lng },
        estimatedWaitTime: venue.estimated_distance_miles ? Math.round(venue.estimated_distance_miles * 2) : null, // ~2 min per mile estimate
        estimatedEarningsPerRide: venue.estimated_earnings,
        earningsPerMile: venue.earnings_per_mile,
        potential: venue.estimated_earnings,
        demandLevel: venue.earnings_per_mile > 4 ? 'high' : venue.earnings_per_mile > 3 ? 'medium' : 'low',
        proTips: venue.pro_tips || [],
        pro_tips: venue.pro_tips || [],
        bestTimeWindow: venue.best_time_window,
        // Business hours enrichment
        placeId: venue.placeId,
        businessHours: venue.businessHours,
        isOpen: venue.isOpen,
        businessStatus: venue.businessStatus,
        hasSpecialHours: venue.hasSpecialHours,
        // Gemini closed venue reasoning
        closed_venue_reasoning: venue.closed_venue_reasoning,
        // Staging area if this is one of the top venues
        stagingArea: (index < 3 && enrichedStagingLocation) ? {
          type: "Free Lot",
          name: enrichedStagingLocation.name,
          address: enrichedStagingLocation.address,
          walkTime: "Position nearby",
          parkingTip: enrichedStagingLocation.reason
        } : null
      })),
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
