// server/lib/venue/enhanced-smart-blocks.js
// ============================================================================
// ENHANCED SMART BLOCKS - Venue Generation Engine
// ============================================================================
//
// PURPOSE: Generates venue recommendations using GPT-5.2 + Google APIs
//
// PIPELINE:
//   1. Input: immediateStrategy (strategy_for_now) + briefing + snapshot
//   2. GPT-5.2 Tactical Planner → 4-6 venue recommendations with coords
//   3. Google Routes API → accurate distances and drive times
//   4. Google Places API → business hours, addresses, open/closed status
//   5. Gemini 2.5 Pro → event verification (optional)
//   6. Output: rankings + ranking_candidates tables populated
//
// CALLED BY:
//   - blocks-fast.js POST route (via ensureSmartBlocksExist)
//   - triad-worker.js (background worker via NOTIFY)
//
// KEY EXPORTS:
//   - generateEnhancedSmartBlocks({ snapshotId, immediateStrategy, briefing, snapshot, user_id })
//
// ============================================================================

import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { rankings, ranking_candidates } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateTacticalPlan } from '../strategy/tactical-planner.js';
import { hasRenderableBriefing, updatePhase } from '../strategy/strategy-utils.js';
import { enrichVenues } from './venue-enrichment.js';
import { verifyVenueEventsBatch, extractVerifiedEvents } from './venue-event-verifier.js';
import { venuesLog } from '../../logger/workflow.js';

/**
 * Generate enhanced smart blocks using GPT-5 venue planner
 * Takes IMMEDIATE strategy (where to go NOW) + briefing + user location → venue recommendations
 *
 * @param {Object} params
 * @param {string} params.snapshotId - Snapshot ID
 * @param {string} params.immediateStrategy - "Where to go NOW" strategy (required)
 * @param {Object} params.briefing - Gemini briefing (optional)
 * @param {Object} params.snapshot - Snapshot context
 * @param {string} params.user_id - User ID
 * @param {EventEmitter} params.phaseEmitter - Optional emitter for SSE phase updates
 */
export async function generateEnhancedSmartBlocks({ snapshotId, immediateStrategy, briefing, snapshot, user_id, phaseEmitter }) {
  const startTime = Date.now();
  const correlationId = randomUUID();
  const rankingId = randomUUID();

  const location = snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`;
  venuesLog.start(`${location} (${snapshotId.slice(0, 8)})`);

  // Guard: Check if immediate strategy exists and is not empty
  if (!immediateStrategy || typeof immediateStrategy !== 'string' || !immediateStrategy.trim()) {
    throw new Error('blocks_input_missing_immediate_strategy');
  }

  // NOTE: Briefing is now OPTIONAL - blocks generation proceeds even without briefing content
  if (!briefing) {
    briefing = { events: [], news: [], traffic: {}, holidays: [] };
  }

  venuesLog.phase(1, `Input ready: strategy=${immediateStrategy.length}chars, briefing=${Object.keys(briefing).filter(k => briefing[k]).length} fields`);

  try {
    // Step 1: Call GPT-5.2 Venue Planner with IMMEDIATE strategy (where to go NOW)
    // Phase: 'venues' - AI venue recommendation
    await updatePhase(snapshotId, 'venues', { phaseEmitter });

    const plannerStart = Date.now();
    const venuesPlan = await generateTacticalPlan({
      strategy: immediateStrategy,  // Uses "where to go NOW" strategy
      snapshot
    });
    const plannerMs = Date.now() - plannerStart;

    if (!venuesPlan || !venuesPlan.recommended_venues || venuesPlan.recommended_venues.length === 0) {
      throw new Error('GPT-5.2 planner returned no venues');
    }

    venuesLog.done(1, `GPT-5.2 planner returned ${venuesPlan.recommended_venues.length} venues`, plannerMs);

    // Step 2: Enrich venues with Google APIs (Places, Routes, Geocoding)
    // Phase: 'routing' - Google Routes + Places APIs
    await updatePhase(snapshotId, 'routing', { phaseEmitter });

    const enrichmentStart = Date.now();
    const driverLocation = {
      lat: snapshot.lat,
      lng: snapshot.lng
    };

    venuesLog.phase(2, `Driver at ${driverLocation.lat.toFixed(4)},${driverLocation.lng.toFixed(4)} - calling Google Routes API`);

    const enrichedVenues = await enrichVenues(
      venuesPlan.recommended_venues,
      driverLocation,
      snapshot
    );
    const enrichmentMs = Date.now() - enrichmentStart;

    venuesLog.done(2, `Routes API: ${enrichedVenues.map(v => `${v.name.slice(0,20)}=${v.distanceMiles}mi`).join(', ')}`, enrichmentMs);

    // Step 2.5: Verify venue events using Gemini 2.5 Pro
    // Phase: 'verifying' - Gemini event verification
    await updatePhase(snapshotId, 'verifying', { phaseEmitter });

    venuesLog.phase(3, `Places API: Fetching hours + verifying events for ${enrichedVenues.length} venues`);
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
    venuesLog.done(3, `${verifiedEvents.length} verified events extracted`, verificationMs);
    
    // Store verified events for strategy injection
    const verifiedEventsJson = JSON.stringify(verifiedEvents);
    
    // Step 3: Create ranking record (use env var for model name)
    const venuePlannerModel = process.env.STRATEGY_CONSOLIDATOR || 'gpt-5.2';
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
    
    venuesLog.phase(4, `Storing ${enrichedVenues.length} candidates to DB`);

    // Step 4: Insert ranking candidates with enriched Google data
    const candidates = enrichedVenues.map((enriched, index) => {
      // Calculate value metrics
      const distanceMiles = parseFloat(enriched.distanceMiles) || 0;
      const driveMinutes = enriched.driveTimeMinutes || 0;
      const estimatedEarnings = distanceMiles * 1.50; // $1.50/mile estimate
      const valuePerMin = driveMinutes > 0 ? estimatedEarnings / driveMinutes : 0;

      console.log(`🏢 [VENUE "${enriched.name}"] ${distanceMiles}mi, ${driveMinutes}min, isOpen=${enriched.isOpen}, hours=${enriched.businessHours || 'unknown'}`);
      
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
          address: enriched.address,
          streetViewUrl: enriched.streetViewUrl
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
    venuesLog.done(4, `Stored ${candidates.length} candidates`, totalMs);
    venuesLog.complete(`${candidates.length} venues for ${location}`, totalMs);

    // Update ranking with total time
    await db.update(rankings).set({
      total_ms: totalMs
    }).where(eq(rankings.ranking_id, rankingId));

    return { ok: true, rankingId, venues: candidates.length };

  } catch (err) {
    venuesLog.error(0, `Failed for ${snapshotId}`, err);
    throw err;
  }
}
