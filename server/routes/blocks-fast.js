// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// Model-agnostic Venue Generation + Google Places enrichment
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates, strategies, venue_events, users } from '../../shared/schema.js';
import { eq, sql, and, lte, gte, or, isNotNull } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { generateVenueCoordinates } from '../lib/venue-generator.js';
import { isStrategyReady } from '../lib/strategy-utils.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { blocksRequestSchema, snapshotIdQuerySchema } from '../validation/schemas.js';

const router = Router();

// Helper to detect Plus Codes (e.g., "C4PW+2V Waxahachie, TX, USA" or "35XR+RV Frisco, TX, USA")
function isPlusCode(address) {
  if (!address) return false;
  const trimmed = address.trim();
  // Google Plus Codes: 4-6 alphanumerics, plus sign, 2-3 alphanumerics, optional space and location
  // Examples: "C4PW+2V", "35XR+RV", "C4PW+2V Waxahachie, TX, USA"
  return /^[A-Z0-9]{4,6}\+[A-Z0-9]{2,3}(\s|$)/.test(trimmed);
}

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
  
  console.log(`[blocks-fast GET] 🔍 Request for snapshot: ${snapshotId}`);
  
  if (!snapshotId) {
    console.log('[blocks-fast GET] ❌ No snapshot ID provided');
    return res.status(400).json({ error: 'snapshot_required' });
  }

  try {
    // GATE 1: Strategy must be ready before blocks
    console.log(`[blocks-fast GET] Checking if strategy ready for ${snapshotId}...`);
    const { ready, strategy, status } = await isStrategyReady(snapshotId);
    console.log(`[blocks-fast GET] Strategy ready: ${ready}, status: ${status}`);
    
    if (!ready) {
      console.log(`[blocks-fast GET] Strategy not ready, returning 202`);
      return res.status(202).json({ 
        ok: false, 
        reason: 'strategy_pending',
        status: status || 'pending',
        message: 'Waiting for consolidated strategy to complete'
      });
    }
    
    // Fetch strategy row (model-agnostic columns)
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    const briefing = strategyRow ? {
      minstrategy: strategyRow.minstrategy || null,
      consolidated_strategy: strategyRow.consolidated_strategy || null
    } : null;
    
    // GATE 2: Find ranking for this snapshot
    console.log(`[blocks-fast GET] Querying rankings for snapshot ${snapshotId}...`);
    const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
    console.log(`[blocks-fast GET] Ranking found:`, ranking ? `YES (${ranking.ranking_id})` : 'NO');
    
    if (!ranking) {
      console.log(`[blocks-fast GET] ℹ️ Ranking not ready yet for snapshot ${snapshotId} - returning 202 pending_blocks`);
      return res.status(202).json({ 
        ok: false,
        reason: 'blocks_generating',
        status: 'pending_blocks',
        message: 'Venue recommendations are being generated',
        blocks: []
      });
    }

    // Get candidates for this ranking
    console.log(`[blocks-fast GET] Querying candidates for ranking ${ranking.ranking_id}...`);
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);
    console.log(`[blocks-fast GET] Found ${candidates.length} candidates`);
    
    // Fetch snapshot to check holiday status
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    const isHoliday = snapshot?.is_holiday === true;
    const hasSpecialHours = snapshot?.holiday && snapshot?.is_holiday === true;
    console.log(`[blocks-fast GET] Holiday context: isHoliday=${isHoliday}, hasSpecialHours=${hasSpecialHours}`);
    
    // 25-mile perimeter enforcement (show all if distance not calculated yet)
    const within25Miles = (distanceMiles) => {
      // If distance not calculated yet, include the venue (will show "calculating...")
      if (!Number.isFinite(distanceMiles)) return true;
      return distanceMiles <= 25;
    };
    
    // Batch resolve venue addresses for all candidates in parallel
    const { resolveVenueAddressesBatch } = await import('../lib/venue-address-resolver.js');
    const venueKeys = candidates.map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
    const addressMap = await resolveVenueAddressesBatch(venueKeys);
    
    const allBlocks = candidates.map(c => {
      const coordKey = `${c.lat},${c.lng}`;
      // Filter out Plus Codes - use resolved address if it exists and is not a Plus Code
      let resolvedAddress = addressMap[coordKey];
      if (resolvedAddress && isPlusCode(resolvedAddress)) {
        console.log(`[blocks-fast GET] ⚠️ Filtering Plus Code: "${resolvedAddress}" for ${c.name}`);
        resolvedAddress = null;
      }
      // Fallback to candidate address if not a Plus Code
      if (!resolvedAddress && c.address && !isPlusCode(c.address)) {
        resolvedAddress = c.address;
      }
      // If we still have a Plus Code from candidate, reject it too
      if (resolvedAddress && isPlusCode(resolvedAddress)) {
        console.log(`[blocks-fast GET] ⚠️ Filtering Plus Code from candidate: "${resolvedAddress}" for ${c.name}`);
        resolvedAddress = null;
      }
      resolvedAddress = resolvedAddress || null;
      
      // Only include businessHours if NOT a holiday or special hours in effect
      const block = {
        name: c.name,
        address: resolvedAddress, // 🎯 NOW INCLUDES VENUE ADDRESS
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
        isOpen: c.business_hours?.isOpen,
        eventBadge: c.venue_events?.badge,
        eventSummary: c.venue_events?.summary,
      };
      
      // Dynamic business hours enrichment - only include if NOT holiday/special hours
      if (c.business_hours && !isHoliday && !hasSpecialHours) {
        block.businessHours = c.business_hours;
      }
      
      return block;
    });
    
    // Filter to 25-mile perimeter
    const filtered = allBlocks.filter(b => within25Miles(b.estimated_distance_miles));
    const rejected = allBlocks.filter(b => !within25Miles(b.estimated_distance_miles)).length;
    
    // Sort: closest high-value first → furthest high-value last
    // Primary sort: value_per_min DESC (highest value first)
    // Secondary sort: estimated_distance_miles ASC (closest first within same value tier)
    const blocks = filtered.sort((a, b) => {
      const valueDiff = (b.value_per_min || 0) - (a.value_per_min || 0);
      if (Math.abs(valueDiff) > 0.01) return valueDiff; // Different value tiers
      return (a.estimated_distance_miles || 999) - (b.estimated_distance_miles || 999); // Same tier: closest first
    });
    
    const audit = [
      { step: 'gating', strategy_ready: true },
      { step: 'perimeter', accepted: blocks.length, rejected, max_miles: 25 },
      { step: 'sorting', method: 'value_desc_distance_asc' }
    ];

    console.log(`[blocks-fast GET] ✅ Returning ${blocks.length} blocks (${rejected} rejected by 15-min perimeter)`);
    return res.json({ blocks, ranking_id: ranking.ranking_id, briefing, audit });
  } catch (error) {
    console.error('[blocks-fast GET] ❌ Error:', error.message);
    console.error('[blocks-fast GET] Stack:', error.stack);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', validateBody(blocksRequestSchema), async (req, res) => {
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

    // CRITICAL: Fetch snapshot FIRST to get location data
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return sendOnce(404, { error: 'snapshot_not_found', message: 'snapshot_id does not exist' });
    }

    // CRITICAL: Create triad_job AND run synchronous waterfall (autoscale compatible)
    const { triad_jobs, briefings } = await import('../../shared/schema.js');
    try {
      const [job] = await db.insert(triad_jobs).values({
        snapshot_id: snapshotId,
        formatted_address: snapshot.formatted_address,
        city: snapshot.city,
        state: snapshot.state,
        kind: 'triad',
        status: 'queued'
      }).onConflictDoNothing().returning();
      
      if (job) {
        // New job created - run full pipeline synchronously (no worker needed)
        console.log(`[blocks-fast POST] 🚀 Running synchronous waterfall for ${snapshotId}`);
        const { runMinStrategy } = await import('../lib/providers/minstrategy.js');
        const { runBriefing } = await import('../lib/providers/briefing.js');
        const { runHolidayCheck } = await import('../lib/providers/holiday-checker.js');
        const { consolidateStrategy } = await import('../lib/strategy-generator-parallel.js');
        const { generateEnhancedSmartBlocks } = await import('../lib/enhanced-smart-blocks.js');
        const { ensureStrategyRow } = await import('../lib/strategy-utils.js');
        
        // Ensure strategy row exists with snapshot location data
        await ensureStrategyRow(snapshotId);
        
        // Pre-populate briefing endpoints to start auto-generation in background
        console.log(`[blocks-fast POST] 🔄 Pre-warming briefing endpoints...`);
        try {
          await Promise.allSettled([
            fetch(`http://localhost:5000/api/briefing/weather/${snapshotId}`).catch(() => null),
            fetch(`http://localhost:5000/api/briefing/traffic/${snapshotId}`).catch(() => null),
            fetch(`http://localhost:5000/api/briefing/rideshare-news/${snapshotId}`).catch(() => null),
            fetch(`http://localhost:5000/api/briefing/events/${snapshotId}`).catch(() => null),
            fetch(`http://localhost:5000/api/briefing/school-closures/${snapshotId}`).catch(() => null)
          ]);
        } catch (e) {
          console.warn(`[blocks-fast POST] ⚠️ Briefing pre-warm failed (non-critical):`, e.message);
        }
        
        // STEP 1: Run providers in parallel (10-15s)
        console.log(`[blocks-fast POST] 📡 Step 1/4: Providers...`);
        await Promise.all([
          runHolidayCheck(snapshotId),
          runMinStrategy(snapshotId),
          runBriefing(snapshotId)
        ]);
        
        // STEP 2: Fetch provider outputs (use denormalized location from snapshots)
        console.log(`[blocks-fast POST] 📚 Step 2/4: Fetching outputs...`);
        console.log(`[blocks-fast POST] 📍 Driver location: ${snapshot?.lat}, ${snapshot?.lng} (${snapshot?.city}, ${snapshot?.state})`);
        const [strategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        const [briefing] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
        
        // CRITICAL: Make briefing OPTIONAL - consolidation proceeds even if Perplexity fails
        // Only REQUIRE snapshot and minstrategy (strategist is critical, briefing is enhancement)
        if (snapshot && strategy?.minstrategy) {
          // STEP 3: Run consolidation (15-20s) - with or without briefing
          console.log(`[blocks-fast POST] 🔄 Step 3/4: Consolidation...`);
          if (!briefing) {
            console.warn(`[blocks-fast POST] ⚠️ Briefing missing - proceeding with strategist output only`);
          }
          await consolidateStrategy({
            snapshotId,
            claudeStrategy: strategy.minstrategy,
            briefing: briefing || { events: [], news: [], traffic: [] }, // Provide empty briefing as fallback
            user: null,
            snapshot: snapshot,
            holiday: strategy.holiday
          });
          
          // STEP 4: Generate smart blocks (10-15s)
          console.log(`[blocks-fast POST] 🎯 Step 4/4: Generating blocks...`);
          const [consolidated] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
          
          if (consolidated?.consolidated_strategy) {
            try {
              await generateEnhancedSmartBlocks({
                snapshotId,
                consolidated: consolidated.consolidated_strategy,
                briefing: briefing,
                snapshot: snapshot,
                user_id: null
              });
              console.log(`[blocks-fast POST] ✅ Smart blocks generation complete`);
            } catch (blocksError) {
              console.error(`[blocks-fast POST] ❌ Smart blocks generation failed:`, blocksError.message);
              console.error(`[blocks-fast POST] Stack:`, blocksError.stack);
              return sendOnce(500, {
                error: 'blocks_generation_failed',
                message: blocksError.message
              });
            }
            
            console.log(`[blocks-fast POST] ✅ Synchronous waterfall complete`);
            
            // Fetch the generated blocks to return to client
            console.log(`[blocks-fast POST] 🔍 Fetching generated blocks...`);
            const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
            
            if (ranking) {
              const candidates = await db.select().from(ranking_candidates)
                .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
                .orderBy(ranking_candidates.rank);
              
              // Batch resolve venue addresses
              const { resolveVenueAddressesBatch } = await import('../lib/venue-address-resolver.js');
              const venueKeys = candidates.map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
              const addressMap = await resolveVenueAddressesBatch(venueKeys);
              
              const blocks = candidates.map(c => {
                const coordKey = `${c.lat},${c.lng}`;
                // Filter out Plus Codes - use resolved address if it exists and is not a Plus Code
                let resolvedAddress = addressMap[coordKey];
                if (resolvedAddress && isPlusCode(resolvedAddress)) {
                  console.log(`[blocks-fast POST] ⚠️ Filtering Plus Code: "${resolvedAddress}" for ${c.name}`);
                  resolvedAddress = null;
                }
                // Fallback to candidate address if not a Plus Code
                if (!resolvedAddress && c.address && !isPlusCode(c.address)) {
                  resolvedAddress = c.address;
                }
                // If we still have a Plus Code from candidate, reject it too
                if (resolvedAddress && isPlusCode(resolvedAddress)) {
                  console.log(`[blocks-fast POST] ⚠️ Filtering Plus Code from candidate: "${resolvedAddress}" for ${c.name}`);
                  resolvedAddress = null;
                }
                resolvedAddress = resolvedAddress || null;
                
                return {
                  name: c.name,
                  address: resolvedAddress, // 🎯 NOW INCLUDES VENUE ADDRESS
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
                };
              });
              
              console.log(`[blocks-fast POST] ✅ Returning ${blocks.length} generated blocks`);
              return sendOnce(200, {
                status: 'ok',
                snapshot_id: snapshotId,
                blocks: blocks,
                ranking_id: ranking.ranking_id,
                message: 'Smart blocks generated successfully'
              });
            } else {
              console.error(`[blocks-fast POST] ⚠️  No ranking found for snapshot after generation`);
              return sendOnce(200, {
                status: 'ok',
                snapshot_id: snapshotId,
                blocks: [],
                message: 'Smart blocks generated (details pending)'
              });
            }
          } else {
            console.error(`[blocks-fast POST] ❌ Consolidation failed - no consolidated_strategy`);
            return sendOnce(500, {
              error: 'consolidation_failed',
              message: 'Strategy consolidation did not produce output'
            });
          }
        } else {
          console.error(`[blocks-fast POST] ❌ Providers failed - missing required data`);
          return sendOnce(500, {
            error: 'providers_failed',
            message: 'One or more AI providers did not complete successfully'
          });
        }
      } else {
        // Job already exists - check if blocks are ready
        console.log(`[blocks-fast POST] Job already queued for ${snapshotId}, checking for existing blocks...`);
        
        const [existing] = await db.select().from(ranking_candidates)
          .where(eq(ranking_candidates.snapshot_id, snapshotId))
          .limit(1);
        
        if (existing) {
          return sendOnce(200, {
            status: 'ok',
            snapshot_id: snapshotId,
            blocks: [],
            message: 'Smart Blocks ready - use GET /api/blocks-fast to retrieve'
          });
        } else {
          return sendOnce(202, {
            status: 'pending',
            snapshot_id: snapshotId,
            blocks: [],
            message: 'Smart Blocks generating - they will appear automatically when ready'
          });
        }
      }
    } catch (jobErr) {
      console.error(`[blocks-fast POST] Waterfall error:`, jobErr.message);
      console.error(`[blocks-fast POST] Stack:`, jobErr.stack);
      return sendOnce(500, {
        error: 'waterfall_failed',
        message: jobErr.message
      });
    }
  } catch (error) {
    console.error('[blocks-fast POST] Unexpected error:', error);
    return sendOnce(500, { error: 'internal_error' });
  }
});

export default router;
