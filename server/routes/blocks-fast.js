// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// Model-agnostic Venue Generation + Google Places enrichment
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates, strategies, venue_events, users, triad_jobs, briefings } from '../../shared/schema.js';
import { eq, sql, and, lte, gte, or, isNotNull } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { generateVenueCoordinates } from '../lib/venue-generator.js';
import { isStrategyReady, ensureStrategyRow } from '../lib/strategy-utils.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { blocksRequestSchema, snapshotIdQuerySchema } from '../validation/schemas.js';
import { requireAuth } from '../middleware/auth.js';
import { expensiveEndpointLimiter } from '../middleware/rate-limit.js';
import { runMinStrategy } from '../lib/providers/minstrategy.js';
import { runBriefing } from '../lib/providers/briefing.js';
import { runHolidayCheck } from '../lib/providers/holiday-checker.js';
import { consolidateStrategy } from '../lib/strategy-generator-parallel.js';
import { generateEnhancedSmartBlocks } from '../lib/enhanced-smart-blocks.js';
import { resolveVenueAddressesBatch } from '../lib/venue-address-resolver.js';

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
// ISSUE #24 FIX: Rate limited to prevent quota exhaustion
router.get('/', expensiveEndpointLimiter, requireAuth, async (req, res) => {
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
    
    // Fetch strategy row (model-agnostic columns)
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    const briefing = strategyRow ? {
      minstrategy: strategyRow.minstrategy || null,
      consolidated_strategy: strategyRow.consolidated_strategy || null
    } : null;
    
    // GATE 2: Find ranking for this snapshot
    const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
    
    if (!ranking) {
      return res.status(202).json({ 
        ok: false,
        reason: 'blocks_generating',
        status: 'pending_blocks',
        message: 'Venue recommendations are being generated',
        blocks: []
      });
    }

    // Get candidates for this ranking
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);
    
    // Fetch snapshot to check holiday status
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    const isHoliday = snapshot?.is_holiday === true;
    const hasSpecialHours = snapshot?.holiday && snapshot?.is_holiday === true;
    
    // 25-mile perimeter enforcement (show all if distance not calculated yet)
    const within25Miles = (distanceMiles) => {
      // If distance not calculated yet, include the venue (will show "calculating...")
      if (!Number.isFinite(distanceMiles)) return true;
      return distanceMiles <= 25;
    };
    
    // Batch resolve venue addresses for all candidates in parallel
    const venueKeys = candidates.map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
    const addressMap = await resolveVenueAddressesBatch(venueKeys);
    
    const allBlocks = candidates.map(c => {
      const coordKey = `${c.lat},${c.lng}`;
      // Filter out Plus Codes - use resolved address if it exists and is not a Plus Code
      let resolvedAddress = addressMap[coordKey];
      if (resolvedAddress && isPlusCode(resolvedAddress)) {
        resolvedAddress = null;
      }
      // Fallback to candidate address if not a Plus Code
      if (!resolvedAddress && c.address && !isPlusCode(c.address)) {
        resolvedAddress = c.address;
      }
      // If we still have a Plus Code from candidate, reject it too
      if (resolvedAddress && isPlusCode(resolvedAddress)) {
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

    return res.json({ blocks, ranking_id: ranking.ranking_id, briefing, audit });
  } catch (error) {
    console.error('[blocks-fast GET] ❌ Error:', error.message);
    console.error('[blocks-fast GET] Stack:', error.stack);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', async (req, res) => {
  console.log('[blocks-fast POST] 🚀 REQUEST RECEIVED:', { body: JSON.stringify(req.body).substring(0, 200) });
  
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
      console.log('[blocks-fast POST] SENDING RESPONSE:', code, body.error || 'ok');
      res.status(code).json({ ...body, audit });
    }
  };

  try {
    // Manual validation to avoid HTML error pages from validateBody middleware
    const { userId = 'demo', snapshotId } = req.body;
    console.log('[blocks-fast POST] 📝 EXTRACTED snapshotId:', snapshotId);

    if (!snapshotId) {
      console.log('[blocks-fast POST] ❌ MISSING snapshotId');
      return sendOnce(400, { error: 'snapshot_required', message: 'snapshot_id is required' });
    }
    
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      console.log('[blocks-fast POST] ❌ INVALID UUID:', snapshotId);
      return sendOnce(400, { error: 'invalid_uuid', message: 'snapshotId must be a valid UUID' });
    }
    
    console.log('[blocks-fast POST] ✅ UUID validated, fetching snapshot...');

    // CRITICAL: Fetch snapshot FIRST to get location data
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return sendOnce(404, { error: 'snapshot_not_found', message: 'snapshot_id does not exist' });
    }

    // DEDUPLICATION CHECK: If strategy already exists (pending/running/complete/ok), don't re-trigger it
    const [existingStrategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    if (existingStrategy && ['pending', 'running', 'complete', 'ok'].includes(existingStrategy.status)) {
      console.log(`[blocks-fast POST] ⏭️ Strategy already ${existingStrategy.status} for ${snapshotId}, skipping re-trigger`);
      return sendOnce(202, { 
        ok: false, 
        reason: 'strategy_already_exists',
        status: existingStrategy.status,
        message: `Strategy is ${existingStrategy.status} - polling/waiting...`,
        snapshot_id: snapshotId
      });
    }

    // CRITICAL: Create triad_job AND run synchronous waterfall (autoscale compatible)
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
        
        // Ensure strategy row exists with snapshot location data
        await ensureStrategyRow(snapshotId);
        
        // Run providers in parallel (allSettled allows briefing to fail gracefully)
        const results = await Promise.allSettled([
          runHolidayCheck(snapshotId),
          runMinStrategy(snapshotId),
          runBriefing(snapshotId)
        ]);
        
        // Check if MinStrategy (Critical) failed
        if (results[1].status === 'rejected') {
          throw new Error(`Critical Strategy Error: ${results[1].reason}`);
        }
        
        // Briefing (Optional) - we don't care if results[2] rejected
        
        // Fetch provider outputs
        const [strategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        const [briefing] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
        
        // Make briefing OPTIONAL - consolidation proceeds even if Perplexity fails
        if (snapshot && strategy?.minstrategy) {
          await consolidateStrategy({
            snapshotId,
            claudeStrategy: strategy.minstrategy,
            briefing: briefing || { events: [], news: [], traffic: [] },
            user: null,
            snapshot: snapshot,
            holiday: strategy.holiday
          });
          
          // Generate smart blocks
          const [consolidated] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
          
          if (consolidated?.consolidated_strategy) {
            try {
              await generateEnhancedSmartBlocks({
                snapshotId,
                consolidated: consolidated.consolidated_strategy,
                briefing: briefing || { 
                  events: [],
                  news: [],
                  traffic: { summary: 'Traffic conditions gathering...', incidents: [] },
                  holidays: []
                },
                snapshot: snapshot,
                user_id: null
              });
            } catch (blocksError) {
              console.error(`[blocks-fast POST] Smart blocks failed:`, blocksError.message);
              return sendOnce(500, {
                error: 'blocks_generation_failed',
                message: blocksError.message
              });
            }
            
            // Fetch the generated blocks to return to client
            const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
            
            if (ranking) {
              const candidates = await db.select().from(ranking_candidates)
                .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
                .orderBy(ranking_candidates.rank);
              
              // Batch resolve venue addresses
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
        
        // SECURITY FIX: Join with rankings table to find candidates by snapshot
        const [existing] = await db.select()
          .from(ranking_candidates)
          .innerJoin(rankings, eq(ranking_candidates.ranking_id, rankings.ranking_id))
          .where(eq(rankings.snapshot_id, snapshotId))
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
