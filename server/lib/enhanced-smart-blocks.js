// server/lib/enhanced-smart-blocks.js
// Enhanced Smart Blocks: GPT-5 venue planner → rankings & candidates

import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { rankings, ranking_candidates } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateTacticalPlan } from './gpt5-tactical-planner.js';

/**
 * Generate enhanced smart blocks using GPT-5 venue planner
 * Takes consolidated strategy + user location → venue recommendations
 * 
 * @param {Object} params
 * @param {string} params.snapshotId - Snapshot ID
 * @param {string} params.strategy - Consolidated strategy text
 * @param {Object} params.snapshot - Snapshot context
 * @param {string} params.user_id - User ID
 */
export async function generateEnhancedSmartBlocks({ snapshotId, strategy, snapshot, user_id }) {
  const startTime = Date.now();
  const correlationId = randomUUID();
  const rankingId = randomUUID();
  
  console.log(`[ENHANCED-BLOCKS] Starting venue planner for snapshot ${snapshotId}`);
  console.log(`[ENHANCED-BLOCKS] Strategy preview: "${strategy.slice(0, 100)}..."`);
  console.log(`[ENHANCED-BLOCKS] Location: ${snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`}`);
  
  try {
    // Step 1: Call GPT-5 Venue Planner
    const plannerStart = Date.now();
    const venuesPlan = await generateTacticalPlan({
      strategy,
      snapshot
    });
    const plannerMs = Date.now() - plannerStart;
    
    if (!venuesPlan || !venuesPlan.recommended_venues || venuesPlan.recommended_venues.length === 0) {
      throw new Error('GPT-5 planner returned no venues');
    }
    
    console.log(`[ENHANCED-BLOCKS] ✅ GPT-5 planner returned ${venuesPlan.recommended_venues.length} venues in ${plannerMs}ms`);
    
    // Step 2: Create ranking record
    await db.insert(rankings).values({
      ranking_id: rankingId,
      snapshot_id: snapshotId,
      correlation_id: correlationId,
      user_id: user_id || null,
      city: snapshot.city || null,
      ui: null,
      model_name: 'gpt-5-venue-planner',
      scoring_ms: 0,
      planner_ms: plannerMs,
      total_ms: 0,
      timed_out: false,
      path_taken: 'enhanced-smart-blocks',
      created_at: new Date()
    });
    
    console.log(`[ENHANCED-BLOCKS] ✅ Ranking record created: ${rankingId}`);
    
    // Step 3: Insert ranking candidates for each venue
    const candidates = venuesPlan.recommended_venues.map((venue, index) => ({
      id: randomUUID(),
      ranking_id: rankingId,
      snapshot_id: snapshotId,
      block_id: `venue-${index + 1}`,
      name: venue.name,
      lat: venue.lat,
      lng: venue.lng,
      rank: venue.rank || index + 1,
      place_id: null,  // Will be enriched later by Google Places API
      distance_miles: null,  // Will be calculated later
      drive_minutes: null,  // Will be calculated later
      value_per_min: null,  // Will be calculated later
      value_grade: null,  // Will be calculated later
      not_worth: false,
      pro_tips: venue.pro_tips || [],
      staging_tips: venue.staging_name || null,
      staging_name: venue.staging_name || null,
      staging_lat: venue.staging_lat || null,
      staging_lng: venue.staging_lng || null,
      venue_events: null,  // Will be enriched later
      business_hours: null,  // Will be enriched later
      closed_reasoning: venue.strategic_timing || null,
      
      // Legacy fields for compatibility
      drive_time_min: null,
      straight_line_km: null,
      est_earnings_per_ride: null,
      model_score: 1.0 - (index * 0.1),  // Simple scoring: rank 1 = 1.0, rank 2 = 0.9, etc.
      exploration_policy: 'greedy',
      epsilon: 0.0,
      was_forced: false,
      propensity: 1.0,
      features: {
        category: venue.category,
        pro_tips: venue.pro_tips,
        strategic_timing: venue.strategic_timing
      },
      h3_r8: null,
      estimated_distance_miles: null,
      drive_time_minutes: null,
      distance_source: 'gpt5-coords',
      rate_per_min_used: null,
      trip_minutes_used: null,
      wait_minutes_used: null
    }));
    
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
