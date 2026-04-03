// server/lib/venue/enhanced-smart-blocks.js
// ============================================================================
// ENHANCED SMART BLOCKS - Venue Generation Engine
// ============================================================================
//
// PURPOSE: Generates venue recommendations using VENUE_SCORER role + Google APIs
//
// PIPELINE:
//   1. Input: immediateStrategy (strategy_for_now) + briefing + snapshot
//   2. VENUE_SCORER role → 4-6 venue recommendations with coords
//   3. Google Routes API → accurate distances and drive times
//   4. Google Places API → business hours, addresses, open/closed status
//   5. Catalog promotion → verified venues upserted to venue_catalog (venue_id returned)
//   6. Output: rankings + ranking_candidates tables populated (with venue_id FK)
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

// 2026-01-14: Time-sensitive event badge filtering
// Only show event badges for events that are time-relevant (within 2h future or 4h past start)
// 2026-01-31: Removed hardcoded timezone fallback - timezone is required per NO FALLBACKS rule
function isEventTimeRelevant(eventStartTime, snapshotTimezone) {
  if (!eventStartTime) return false;
  // 2026-01-31: NO FALLBACKS - timezone is required for global app
  if (!snapshotTimezone) return false;

  // Get current time in venue's timezone
  const now = new Date();
  const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone: snapshotTimezone }));
  const currentMinutes = nowInTimezone.getHours() * 60 + nowInTimezone.getMinutes();

  // Parse event start time (HH:MM format)
  const [hours, minutes] = eventStartTime.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return false;
  const eventMinutes = hours * 60 + minutes;

  // Check: starts within next 2 hours OR started within last 4 hours
  const minutesUntilStart = eventMinutes - currentMinutes;
  const minutesSinceStart = currentMinutes - eventMinutes;

  // Event starts within 2 hours (120 min) OR started within last 4 hours (240 min)
  return (minutesUntilStart >= 0 && minutesUntilStart <= 120) ||
         (minutesSinceStart >= 0 && minutesSinceStart <= 240);
}
import { eq } from 'drizzle-orm';
import { generateTacticalPlan } from '../strategy/tactical-planner.js';
import { hasRenderableBriefing, updatePhase } from '../strategy/strategy-utils.js';
import { enrichVenues } from './venue-enrichment.js';
import { verifyVenueEventsBatch, extractVerifiedEvents } from './venue-event-verifier.js';
import { matchVenuesToEvents } from './event-matcher.js';
import { upsertVenue } from './venue-cache.js';
import { venuesLog } from '../../logger/workflow.js';
// 2026-01-31: Filter briefing data for venue planner to reduce token usage
import { filterBriefingForPlanner } from '../briefing/filter-for-planner.js';

/**
 * 2026-03-28: Promote verified enriched venues to venue_catalog.
 * Closes the canonicalization gap — SmartBlocks venues become first-class catalog entities
 * for cross-session learning, event joins, and map/bars systems.
 *
 * Uses Promise.allSettled so one DB failure doesn't break the pipeline.
 * Only promotes venues where Google Places verified the match (placeVerified + placeId).
 *
 * @param {Array} enrichedVenues - Output from enrichVenues()
 * @param {Object} snapshot - Snapshot context (city, state for upsertVenue)
 * @returns {Promise<Map<string, string>>} Map of venue name -> venue_id (UUID)
 */
async function promoteToVenueCatalog(enrichedVenues, snapshot) {
  // 2026-04-02: FIX - Also require a valid address to avoid NOT NULL constraint violations.
  // Address can be null when geocode/Places API fails to resolve during enrichment.
  const promotable = enrichedVenues.filter(v =>
    v.placeVerified === true &&
    v.placeId &&
    v.address &&
    v.address !== 'Address unavailable'
  );

  if (promotable.length === 0) {
    venuesLog.info(3, 'No verified venues to promote to catalog');
    return new Map();
  }

  const results = await Promise.allSettled(
    promotable.map(v =>
      upsertVenue(
        {
          venueName: v.name,
          city: snapshot.city,
          state: snapshot.state,
          lat: v.lat,
          lng: v.lng,
          placeId: v.placeId,
          address: v.address,
          formattedAddress: v.address,
          hours: v.businessHours,
          category: v.category || 'venue',
          source: 'smart_blocks_promotion',
        },
        { recordStatus: 'verified' }
      )
    )
  );

  const venueIdMap = new Map();
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value?.venue_id) {
      venueIdMap.set(promotable[index].name, result.value.venue_id);
    } else if (result.status === 'rejected') {
      // 2026-04-02: FIX - Log the actual DB error code/detail, not just the Drizzle wrapper
      const err = result.reason;
      venuesLog.warn(3, `Catalog promotion failed for "${promotable[index].name}": ${err?.code || 'unknown'} — ${err?.detail || err?.message || 'no detail'}`);
    }
  });

  return venueIdMap;
}

/**
 * Generate enhanced smart blocks using VENUE_SCORER role
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
  // 2026-01-14: Removed holidays (column dropped in 20251209_drop_unused_briefing_columns.sql)
  // Holiday info is now in snapshots table (holiday, is_holiday)
  if (!briefing) {
    briefing = { events: [], news: [], traffic: {}, school_closures: [] };
  }

  venuesLog.phase(1, `Input ready: strategy=${immediateStrategy.length}chars, briefing=${Object.keys(briefing).filter(k => briefing[k]).length} fields`);

  try {
    // Step 1: Call VENUE_SCORER role with IMMEDIATE strategy (where to go NOW)
    // Phase: 'venues' - AI venue recommendation
    await updatePhase(snapshotId, 'venues', { phaseEmitter });

    // 2026-01-31: Filter briefing data for venue planner
    // Reduces token usage by only including today's events + traffic summary
    // Large market-wide events (stadiums) kept from entire region
    // Small local events filtered to user's city only
    const filteredBriefing = filterBriefingForPlanner(briefing, snapshot);

    const plannerStart = Date.now();
    const venuesPlan = await generateTacticalPlan({
      strategy: immediateStrategy,  // Uses "where to go NOW" strategy
      snapshot,
      briefingContext: filteredBriefing  // 2026-01-31: Pass filtered briefing for enhanced recommendations
    });
    const plannerMs = Date.now() - plannerStart;

    if (!venuesPlan || !venuesPlan.recommended_venues || venuesPlan.recommended_venues.length === 0) {
      throw new Error('VENUE_SCORER role returned no venues');
    }

    venuesLog.done(1, `VENUE_SCORER returned ${venuesPlan.recommended_venues.length} venues`, plannerMs);

    // Step 2: Enrich venues with Google APIs (Places, Routes, Geocoding)
    // Phase: 'routing' - Google Routes + Places APIs
    console.log(`[PHASE] ${snapshotId.slice(0, 8)} venues → routing`);
    await updatePhase(snapshotId, 'routing', { phaseEmitter });

    const enrichmentStart = Date.now();
    const driverLocation = {
      lat: snapshot.lat,
      lng: snapshot.lng
    };

    venuesLog.phase(2, `Driver at ${driverLocation.lat.toFixed(6)},${driverLocation.lng.toFixed(6)} - calling Google Routes API`);

    const enrichedVenues = await enrichVenues(
      venuesPlan.recommended_venues,
      driverLocation,
      snapshot
    );
    const enrichmentMs = Date.now() - enrichmentStart;

    venuesLog.done(2, `Routes API: ${enrichedVenues.map(v => `${v.name.slice(0,20)}=${v.distanceMiles}mi`).join(', ')}`, enrichmentMs);

    // Step 2.3: Match venues to discovered events from DB
    // Phase: 'places' - Google Places API (event matching happens here too)
    console.log(`[PHASE] ${snapshotId.slice(0, 8)} routing → places`);
    await updatePhase(snapshotId, 'places', { phaseEmitter });

    const eventDate = snapshot.date || new Date().toISOString().slice(0, 10);
    const eventMatches = await matchVenuesToEvents(
      enrichedVenues,
      snapshot.city,
      snapshot.state,
      eventDate
    );
    venuesLog.phase(3, `Event matching: ${eventMatches.size} venues matched to events`);

    // Step 2.5: Verify venue events using Gemini 2.5 Pro
    // Phase: 'verifying' - Gemini event verification
    console.log(`[PHASE] ${snapshotId.slice(0, 8)} places → verifying`);
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
    const venuePlannerModel = process.env.STRATEGY_CONSOLIDATOR || 'gpt-5.4';
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
    
    // Step 3.5: Promote verified venues to venue_catalog
    // 2026-03-28: Bridges SmartBlocks to canonical venue identity
    const venueIdMap = await promoteToVenueCatalog(enrichedVenues, snapshot);
    venuesLog.phase(4, `Promoted ${venueIdMap.size}/${enrichedVenues.length} venues to catalog, storing ${enrichedVenues.length} candidates`);

    // Step 4: Insert ranking candidates with enriched Google data
    const candidates = enrichedVenues.map((enriched, index) => {
      // Calculate value metrics
      const distanceMiles = parseFloat(enriched.distanceMiles) || 0;
      const driveMinutes = enriched.driveTimeMinutes || 0;
      const estimatedEarnings = distanceMiles * 1.50; // $1.50/mile estimate
      const valuePerMin = driveMinutes > 0 ? estimatedEarnings / driveMinutes : 0;

      // Get matched events for this venue
      // 2026-01-14: Filter to only time-relevant events (within 2h future or 4h past start)
      const allMatchedEvents = eventMatches.get(enriched.name) || [];
      const matchedEvents = allMatchedEvents.filter(evt =>
        isEventTimeRelevant(evt.event_start_time, snapshot.timezone)
      );
      const hasEvent = matchedEvents.length > 0;

      console.log(`🏢 [VENUE "${enriched.name}"] ${distanceMiles}mi, ${driveMinutes}min, isOpen=${enriched.isOpen}, hours=${enriched.businessHours || 'unknown'}${hasEvent ? `, 🎫 EVENT: ${matchedEvents[0].title}` : (allMatchedEvents.length > 0 ? ' (event stale)' : '')}`);

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

        // Canonical identity
        place_id: enriched.placeId,
        venue_id: venueIdMap.get(enriched.name) || null,
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
        venue_events: matchedEvents,  // 2026-01-14: Time-relevant events only (within 2h future or 4h past)
        business_hours: enriched.businessHours,
        closed_reasoning: enriched.strategic_timing || null,

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
          streetViewUrl: enriched.streetViewUrl,
          hasEvent: hasEvent,
          eventBadge: hasEvent ? matchedEvents[0].title : null
        },
        h3_r8: null,
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
