// server/lib/enhanced-smart-blocks.js
// Enhanced Smart Blocks: GPT-5 venue planner → Google APIs enrichment → rankings & candidates

import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { rankings, ranking_candidates } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateTacticalPlan } from './tactical-planner.js';
import { hasRenderableBriefing } from './strategy-utils.js';
import { enrichVenues } from './venue-enrichment.js';
import { verifyVenueEventsBatch, extractVerifiedEvents } from './venue-event-verifier.js';

/**
 * Generate enhanced smart blocks using GPT-5 venue planner
 * Takes consolidated strategy + briefing + user location → venue recommendations
 * 
 * @param {Object} params
 * @param {string} params.snapshotId - Snapshot ID
 * @param {string} params.consolidated - Consolidated strategy text (required)
 * @param {Object} params.briefing - Gemini briefing (required)
 * @param {Object} params.snapshot - Snapshot context
 * @param {string} params.user_id - User ID
 */
export async function generateEnhancedSmartBlocks({ snapshotId, consolidated, briefing, snapshot, user_id }) {
  const startTime = Date.now();
  const correlationId = randomUUID();
  const rankingId = randomUUID();
  
  console.log(`[ENHANCED-BLOCKS] Starting venue planner for snapshot ${snapshotId}`);
  
  // Guard: Check if consolidated strategy exists and is not empty
  if (!consolidated || typeof consolidated !== 'string' || !consolidated.trim()) {
    throw new Error('blocks_input_missing_consolidated');
  }
  
  // Guard: Check if briefing has renderable content
  if (!hasRenderableBriefing(briefing)) {
    throw new Error('blocks_input_missing_briefing');
  }
  
  console.log(`[ENHANCED-BLOCKS] ✅ Input validation passed`);
  console.log(`[ENHANCED-BLOCKS] Strategy preview: "${consolidated.slice(0, 100)}..."`);
  console.log(`[ENHANCED-BLOCKS] Briefing fields: ${Object.keys(briefing).filter(k => briefing[k]).join(', ')}`);
  console.log(`[ENHANCED-BLOCKS] Location: ${snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`}`);
  
  try {
    // Step 1: Call GPT-5 Venue Planner
    const plannerStart = Date.now();
    const venuesPlan = await generateTacticalPlan({
      strategy: consolidated,
      snapshot
    });
    const plannerMs = Date.now() - plannerStart;
    
    if (!venuesPlan || !venuesPlan.recommended_venues || venuesPlan.recommended_venues.length === 0) {
      throw new Error('GPT-5 planner returned no venues');
    }
    
    console.log(`[ENHANCED-BLOCKS] ✅ GPT-5 planner returned ${venuesPlan.recommended_venues.length} venues in ${plannerMs}ms`);
    
    // Step 2: Enrich venues with Google APIs (Places, Routes, Geocoding)
    const enrichmentStart = Date.now();
    const driverLocation = {
      lat: snapshot.lat,
      lng: snapshot.lng
    };
    
    console.log(`[ENHANCED-BLOCKS] 📍 Driver location (original): ${driverLocation.lat.toFixed(4)}, ${driverLocation.lng.toFixed(4)}`);
    console.log(`[ENHANCED-BLOCKS] 📍 Driver address: ${snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`}`);
    
    const enrichedVenues = await enrichVenues(
      venuesPlan.recommended_venues,
      driverLocation,
      snapshot
    );
    const enrichmentMs = Date.now() - enrichmentStart;
    
    console.log(`[ENHANCED-BLOCKS] ✅ Enriched ${enrichedVenues.length} venues with Google APIs in ${enrichmentMs}ms`);
    console.log(`[ENHANCED-BLOCKS] Distance data stored: ${enrichedVenues.map(v => `${v.name}=${v.distanceMiles}mi`).join(', ')}`);
    
    // Step 2.5: Verify venue events using Gemini 2.5 Pro
    console.log(`[ENHANCED-BLOCKS] 🔍 Verifying events for venues with events...`);
    const verificationStart = Date.now();
    const eventVerificationMap = await verifyVenueEventsBatch(
      enrichedVenues.map(v => ({
        ...v,
        city: snapshot.city,
        distance_miles: parseFloat(v.distanceMiles)
      }))
    );
    const verificationMs = Date.now() - verificationStart;
    
    const verifiedEvents = extractVerifiedEvents(enrichedVenues, eventVerificationMap);
    console.log(`[ENHANCED-BLOCKS] ✅ Event verification complete in ${verificationMs}ms - ${verifiedEvents.length} high-confidence events extracted`);
    
    // Store verified events for strategy injection
    const verifiedEventsJson = JSON.stringify(verifiedEvents);
    
    // Step 3: Create ranking record (use env var for model name)
    const venuePlannerModel = process.env.STRATEGY_CONSOLIDATOR || 'gpt-5.1';
    await db.insert(rankings).values({
      ranking_id: rankingId,
      snapshot_id: snapshotId,
      correlation_id: correlationId,
      user_id: user_id && user_id.trim() !== '' ? user_id : null,
      city: snapshot.city || null,
      ui: null,
      model_name: `${venuePlannerModel}-venue-planner`,
      scoring_ms: 0,
      planner_ms: plannerMs,
      total_ms: 0,
      timed_out: false,
      path_taken: 'enhanced-smart-blocks',
      extras: verifiedEventsJson // Store verified events for strategy injection
    });
    
    console.log(`[ENHANCED-BLOCKS] ✅ Ranking record created: ${rankingId}`);
    
    // Step 4: Insert ranking candidates with enriched Google data
    const candidates = enrichedVenues.map((enriched, index) => {
      // Calculate value metrics
      const distanceMiles = parseFloat(enriched.distanceMiles) || 0;
      const driveMinutes = enriched.driveTimeMinutes || 0;
      const estimatedEarnings = distanceMiles * 1.50; // $1.50/mile estimate
      const valuePerMin = driveMinutes > 0 ? estimatedEarnings / driveMinutes : 0;
      
      console.log(`[ENHANCED-BLOCKS] 💾 Storing candidate: "${enriched.name}" | distance=${distanceMiles}mi | time=${driveMinutes}min | source=${enriched.distanceSource}`);
      
      // Grade venues: A = $1+/min, B = $0.50-$1/min, C = <$0.50/min
      let valueGrade = 'C';
      if (valuePerMin >= 1.0) valueGrade = 'A';
      else if (valuePerMin >= 0.50) valueGrade = 'B';
      
      return {
        id: randomUUID(),
        ranking_id: rankingId,
        snapshot_id: snapshotId,
        block_id: `venue-${index + 1}`,
        name: enriched.name,
        lat: enriched.lat,
        lng: enriched.lng,
        rank: enriched.rank || index + 1,
        
        // ✅ ENRICHED DATA from Google APIs
        place_id: enriched.placeId,
        distance_miles: distanceMiles,
        drive_minutes: driveMinutes,
        value_per_min: valuePerMin,
        value_grade: valueGrade,
        not_worth: valuePerMin < 0.30, // Flag low-value venues
        
        // Venue details
        pro_tips: enriched.pro_tips || [],
        staging_tips: enriched.staging_name || null,
        staging_name: enriched.staging_name || null,
        staging_lat: enriched.staging_lat || null,
        staging_lng: enriched.staging_lng || null,
        venue_events: null,
        business_hours: enriched.businessHours,
        closed_reasoning: enriched.strategic_timing || null,
        
        // Legacy fields for compatibility
        drive_time_min: driveMinutes,
        straight_line_km: distanceMiles * 1.60934,
        est_earnings_per_ride: estimatedEarnings,
        model_score: 1.0 - (index * 0.1),
        exploration_policy: 'greedy',
        epsilon: 0.0,
        was_forced: false,
        propensity: 1.0,
        features: {
          category: enriched.category,
          pro_tips: enriched.pro_tips,
          strategic_timing: enriched.strategic_timing,
          isOpen: enriched.isOpen,
          address: enriched.address
        },
        h3_r8: null,
        estimated_distance_miles: distanceMiles,
        drive_time_minutes: driveMinutes,
        distance_source: enriched.distanceSource || 'google_routes_api',
        rate_per_min_used: 1.50,
        trip_minutes_used: driveMinutes,
        wait_minutes_used: 0
      };
    });
    
    await db.insert(ranking_candidates).values(candidates);
    
    const totalMs = Date.now() - startTime;
    console.log(`[ENHANCED-BLOCKS] ✅ Inserted ${candidates.length} venue candidates in ${totalMs}ms`);
    console.log(`[ENHANCED-BLOCKS] Venues:`, candidates.map(c => ({
      rank: c.rank,
      name: c.name,
      category: c.features.category,
      tips: c.pro_tips?.length || 0
    })));
    
    // Update ranking with total time
    await db.update(rankings).set({
      total_ms: totalMs
    }).where(eq(rankings.ranking_id, rankingId));
    
    return { ok: true, rankingId, venues: candidates.length };
    
  } catch (err) {
    console.error(`[ENHANCED-BLOCKS] ❌ Failed:`, err.message);
    console.error(err.stack);
    throw err;
  }
}
