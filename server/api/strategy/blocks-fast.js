// server/api/strategy/blocks-fast.js
// ============================================================================
// FAST TACTICAL PATH - Strategy + Venue Generation API
// ============================================================================
//
// PURPOSE: Generates AI strategy and venue recommendations (SmartBlocks)
// MOUNT POINT: /api/blocks-fast (see bootstrap/routes.js)
//
// ENDPOINTS:
//   POST /api/blocks-fast - Trigger full waterfall (strategy + venues)
//   GET /api/blocks-fast?snapshotId=X - Get blocks (generates if missing)
//
// PIPELINE (POST):
//   1. Briefing (Gemini 3.0 Pro) → events, traffic, news
//   2. Immediate Strategy (GPT-5.1) → strategy_for_now (for Strategy Tab)
//   3. Venue Planner (GPT-5.1) → venue recommendations
//   4. Google APIs → distances, business hours, enrichment
//
// NOTE: Daily strategy (consolidated_strategy) is NOT generated automatically.
//       It's on-demand via POST /api/strategy/daily/:snapshotId when user requests it.
//
// RACE CONDITION PREVENTION:
//   Uses `generationLocks` Map to prevent duplicate GPT-5 calls when
//   multiple requests arrive simultaneously for the same snapshot.
//
// RELATED:
//   - /api/blocks/strategy/:snapshotId (read-only polling, see content-blocks.js)
//   - server/lib/venue/enhanced-smart-blocks.js (venue generation logic)
//   - server/lib/strategy/tactical-planner.js (GPT-5 venue planner)
//
// ============================================================================
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { snapshots, rankings, ranking_candidates, strategies, triad_jobs, briefings } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { isStrategyReady, ensureStrategyRow, updatePhase } from '../../lib/strategy/strategy-utils.js';
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { runImmediateStrategy } from '../../lib/ai/providers/consolidator.js';
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';
import { resolveVenueAddressesBatch } from '../../lib/venue/venue-address-resolver.js';
import { isPlusCode } from '../utils/http-helpers.js';

const router = Router();

// In-memory lock to prevent duplicate SmartBlocks generation for same snapshot
// Key: snapshotId, Value: Promise that resolves when generation is complete
const generationLocks = new Map();

// ============================================================================
// SHARED HELPERS - DRY principle: single source of truth for blocks logic
// ============================================================================

/**
 * Ensure SmartBlocks exist for a snapshot, generating them if missing.
 * Single function replaces 3 duplicate call sites.
 *
 * @param {string} snapshotId - Snapshot UUID
 * @param {Object} options - Optional overrides
 * @param {Object} options.strategyRow - Pre-fetched strategy row (avoids extra DB call)
 * @param {Object} options.briefingRow - Pre-fetched briefing row (avoids extra DB call)
 * @param {Object} options.snapshot - Pre-fetched snapshot row (avoids extra DB call)
 * @returns {Promise<{ranking: Object|null, generated: boolean, error: string|null}>}
 */
async function ensureSmartBlocksExist(snapshotId, options = {}) {
  // Check if blocks already exist
  const [existingRanking] = await db.select().from(rankings)
    .where(eq(rankings.snapshot_id, snapshotId)).limit(1);

  if (existingRanking) {
    return { ranking: existingRanking, generated: false, error: null };
  }

  // Check if generation is already in progress for this snapshot (race condition prevention)
  if (generationLocks.has(snapshotId)) {
    console.log(`[blocks-fast] ⏳ Generation already in progress for ${snapshotId}, waiting...`);
    try {
      await generationLocks.get(snapshotId);
      // After waiting, check for the ranking again
      const [ranking] = await db.select().from(rankings)
        .where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      return { ranking: ranking || null, generated: false, error: ranking ? null : 'generation_in_progress_completed_without_ranking' };
    } catch (err) {
      return { ranking: null, generated: false, error: `generation_in_progress_failed: ${err.message}` };
    }
  }

  // Fetch required data (use provided or fetch fresh)
  const strategyRow = options.strategyRow || (await db.select().from(strategies)
    .where(eq(strategies.snapshot_id, snapshotId)).limit(1))[0];

  if (!strategyRow?.strategy_for_now) {
    return { ranking: null, generated: false, error: 'missing_immediate_strategy' };
  }

  const briefingRow = options.briefingRow || (await db.select().from(briefings)
    .where(eq(briefings.snapshot_id, snapshotId)).limit(1))[0];

  if (!briefingRow) {
    return { ranking: null, generated: false, error: 'missing_briefing' };
  }

  const snapshot = options.snapshot || (await db.select().from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId)).limit(1))[0];

  if (!snapshot) {
    return { ranking: null, generated: false, error: 'missing_snapshot' };
  }

  // Create a lock for this snapshot to prevent duplicate generation
  let resolveLock, rejectLock;
  const lockPromise = new Promise((resolve, reject) => {
    resolveLock = resolve;
    rejectLock = reject;
  });
  generationLocks.set(snapshotId, lockPromise);

  // Generate SmartBlocks
  console.log(`[blocks-fast] 🔨 Generating SmartBlocks for ${snapshotId}`);

  try {
    // Phase: enriching (venue enrichment and ranking)
    await updatePhase(snapshotId, 'enriching');

    await generateEnhancedSmartBlocks({
      snapshotId,
      immediateStrategy: strategyRow.strategy_for_now,
      briefing: briefingRow,
      snapshot: snapshot,
      user_id: null
    });

    // Fetch newly created ranking
    const [newRanking] = await db.select().from(rankings)
      .where(eq(rankings.snapshot_id, snapshotId)).limit(1);

    // Release lock
    generationLocks.delete(snapshotId);
    resolveLock();

    if (newRanking) {
      console.log(`[blocks-fast] ✅ SmartBlocks generated successfully for ${snapshotId}`);
      // Mark phase complete (updatePhase is imported at file level)
      await updatePhase(snapshotId, 'complete');
      return { ranking: newRanking, generated: true, error: null };
    } else {
      console.error(`[blocks-fast] ⚠️ SmartBlocks generated but no ranking found`);
      return { ranking: null, generated: true, error: 'ranking_not_created' };
    }
  } catch (err) {
    // Release lock on error
    generationLocks.delete(snapshotId);
    rejectLock(err);
    console.error(`[blocks-fast] ❌ SmartBlocks generation failed:`, err.message);
    return { ranking: null, generated: false, error: err.message };
  }
}

/**
 * Map ranking candidates to client-friendly block format.
 * Single function replaces duplicate mapping logic in GET and POST routes.
 *
 * @param {Array} candidates - Raw candidates from ranking_candidates table
 * @param {Object} options - Configuration options
 * @param {boolean} options.isHoliday - Whether today is a holiday (affects businessHours)
 * @param {boolean} options.hasSpecialHours - Whether special hours are in effect
 * @param {boolean} options.logPlusCodes - Whether to log filtered Plus Codes
 * @returns {Promise<Array>} Formatted blocks ready for client
 */
async function mapCandidatesToBlocks(candidates, options = {}) {
  const { isHoliday = false, hasSpecialHours = false, logPlusCodes = false } = options;

  // Batch resolve venue addresses for all candidates in parallel
  const venueKeys = candidates.map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
  const addressMap = await resolveVenueAddressesBatch(venueKeys);

  return candidates.map(c => {
    const coordKey = `${c.lat},${c.lng}`;

    // Filter out Plus Codes - use resolved address if it exists and is not a Plus Code
    let resolvedAddress = addressMap[coordKey];
    if (resolvedAddress && isPlusCode(resolvedAddress)) {
      if (logPlusCodes) {
        console.log(`[blocks-fast] ⚠️ Filtering Plus Code: "${resolvedAddress}" for ${c.name}`);
      }
      resolvedAddress = null;
    }

    // Fallback to candidate address if not a Plus Code
    if (!resolvedAddress && c.address && !isPlusCode(c.address)) {
      resolvedAddress = c.address;
    }

    // If we still have a Plus Code from candidate, reject it too
    if (resolvedAddress && isPlusCode(resolvedAddress)) {
      if (logPlusCodes) {
        console.log(`[blocks-fast] ⚠️ Filtering Plus Code from candidate: "${resolvedAddress}" for ${c.name}`);
      }
      resolvedAddress = null;
    }

    const block = {
      name: c.name,
      address: resolvedAddress || null,
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
      isOpen: c.features?.isOpen,
      eventBadge: c.venue_events?.badge,
      eventSummary: c.venue_events?.summary,
    };

    // Dynamic business hours enrichment - only include if NOT holiday/special hours
    if (c.business_hours && !isHoliday && !hasSpecialHours) {
      block.businessHours = c.business_hours;
    }

    return block;
  });
}

/**
 * Filter and sort blocks by value and distance.
 * @param {Array} blocks - Raw blocks array
 * @param {number} maxMiles - Maximum distance in miles (default 25)
 * @returns {{blocks: Array, rejected: number}} Filtered and sorted blocks
 */
function filterAndSortBlocks(blocks, maxMiles = 25) {
  const within25Miles = (distanceMiles) => {
    // If distance not calculated yet, include the venue (will show "calculating...")
    if (!Number.isFinite(distanceMiles)) return true;
    return distanceMiles <= maxMiles;
  };

  const filtered = blocks.filter(b => within25Miles(b.estimated_distance_miles));
  const rejected = blocks.filter(b => !within25Miles(b.estimated_distance_miles)).length;

  // Sort: closest high-value first → furthest high-value last
  // Primary sort: value_per_min DESC (highest value first)
  // Secondary sort: estimated_distance_miles ASC (closest first within same value tier)
  const sorted = filtered.sort((a, b) => {
    const valueDiff = (b.value_per_min || 0) - (a.value_per_min || 0);
    if (Math.abs(valueDiff) > 0.01) return valueDiff; // Different value tiers
    return (a.estimated_distance_miles || 999) - (b.estimated_distance_miles || 999); // Same tier: closest first
  });

  return { blocks: sorted, rejected };
}

// ============================================================================
// ROUTES
// ============================================================================

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
      consolidated_strategy: strategyRow.consolidated_strategy || null
    } : null;

    // Fetch snapshot for holiday status check
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // GATE 2: Ensure blocks exist (generate if missing)
    const { ranking, error } = await ensureSmartBlocksExist(snapshotId, {
      strategyRow,
      snapshot
    });

    if (error === 'missing_briefing') {
      return res.status(202).json({
        ok: false,
        reason: 'briefing_pending',
        status: 'pending_briefing',
        message: 'Briefing data is still being generated'
      });
    }

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

    const isHoliday = snapshot?.is_holiday === true;
    const hasSpecialHours = snapshot?.holiday && snapshot?.is_holiday === true;

    // Map candidates to blocks and filter/sort
    const allBlocks = await mapCandidatesToBlocks(candidates, { isHoliday, hasSpecialHours });
    const { blocks, rejected } = filterAndSortBlocks(allBlocks);

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

    // CRITICAL: Fetch FULL snapshot row to get location data
    // LLMs cannot reverse geocode - we must provide formatted_address
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return sendOnce(404, { error: 'snapshot_not_found', message: 'snapshot_id does not exist' });
    }

    // CRITICAL: Validate formatted_address exists - LLMs cannot reverse geocode
    if (!snapshot.formatted_address) {
      console.error(`[blocks-fast POST] ❌ CRITICAL: Missing formatted_address in snapshot ${snapshotId}`);
      return sendOnce(400, {
        error: 'snapshot_incomplete',
        message: 'Snapshot missing formatted_address - location not resolved'
      });
    }

    console.log('[blocks-fast POST] 📍 Snapshot has resolved address:', {
      formatted_address: snapshot.formatted_address,
      city: snapshot.city,
      state: snapshot.state
    });

    // DEDUPLICATION CHECK: If strategy already running, don't re-trigger it
    const [existingStrategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    if (existingStrategy && ['pending', 'running'].includes(existingStrategy.status)) {
      console.log(`[blocks-fast POST] ⏭️ Strategy already ${existingStrategy.status} for ${snapshotId}, skipping re-trigger`);
      return sendOnce(202, {
        ok: false,
        reason: 'strategy_already_running',
        status: existingStrategy.status,
        message: `Strategy is ${existingStrategy.status} - polling/waiting...`,
        snapshot_id: snapshotId
      });
    }

    // If strategy is COMPLETE/OK/PENDING_BLOCKS, generate SmartBlocks if not already done
    if (existingStrategy && ['complete', 'ok', 'pending_blocks'].includes(existingStrategy.status)) {
      const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      if (ranking) {
        console.log(`[blocks-fast POST] ✅ Strategy ready and blocks already exist for ${snapshotId}`);
        // Blocks already exist - return with strategy included
        const candidates = await db.select().from(ranking_candidates)
          .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
          .orderBy(ranking_candidates.rank);
        const blocks = await mapCandidatesToBlocks(candidates, { isHoliday: false, hasSpecialHours: false });
        return sendOnce(200, {
          ok: true,
          status: 'ok',
          reason: 'blocks_ready',
          snapshot_id: snapshotId,
          blocks,
          ranking_id: ranking.ranking_id,
          strategy: {
            strategy_for_now: existingStrategy.strategy_for_now || '',
            consolidated: existingStrategy.consolidated_strategy || ''
          }
        });
      }
      // Strategy is ready but blocks don't exist yet - generate them
      console.log(`[blocks-fast POST] 🔨 Strategy status=${existingStrategy.status}, generating SmartBlocks now for ${snapshotId}`);
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

        // Phase 1: Resolving location and examining conditions
        await updatePhase(snapshotId, 'resolving');

        // Phase 2: Run briefing provider (Gemini with Google Search)
        // Note: Holiday is already in snapshot table from holiday-detector.js
        await updatePhase(snapshotId, 'analyzing');

        try {
          await runBriefing(snapshotId, { snapshot });
          console.log(`[blocks-fast POST] ✅ Briefing generated`);
        } catch (briefingErr) {
          console.warn(`[blocks-fast POST] ⚠️ Briefing failed (non-blocking):`, briefingErr.message);
          // Continue - immediate strategy can still work with snapshot weather data
        }

        // Phase 3: Immediate Strategy (GPT-5.1 with snapshot + briefing)
        await updatePhase(snapshotId, 'immediate');

        console.log(`[blocks-fast POST] 🔄 Calling runImmediateStrategy`);
        console.log(`[blocks-fast POST] 📊 Inputs: snapshot=${snapshot.formatted_address}`);

        try {
          // GPT-5.1 → strategy_for_now (immediate 1hr strategy for Strategy Tab)
          // Uses snapshot data + briefing (traffic, events) directly
          await runImmediateStrategy(snapshotId, { snapshot });
        } catch (immediateErr) {
          console.error(`[blocks-fast POST] ❌ runImmediateStrategy failed:`, immediateErr.message);
          throw immediateErr;
        }

        // Phase 3: Venue Discovery
        await updatePhase(snapshotId, 'venues');

        // Generate smart blocks using shared helper
        const [consolidatedRow] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        const [briefingRowForBlocks] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

        console.log(`[blocks-fast POST] 📝 After consolidation, strategy status:`, {
          snapshot_id: snapshotId,
          status: consolidatedRow?.status,
          strategy_for_now_length: consolidatedRow?.strategy_for_now?.length || 0,
          strategy_for_now_preview: consolidatedRow?.strategy_for_now?.substring(0, 100) || '(empty)',
          error_message: consolidatedRow?.error_message || 'none'
        });

        // Use shared helper for block generation
        const { ranking, error: blocksError } = await ensureSmartBlocksExist(snapshotId, {
          strategyRow: consolidatedRow,
          briefingRow: briefingRowForBlocks,
          snapshot
        });

        if (blocksError) {
          console.error(`[blocks-fast POST] ❌ SmartBlocks generation failed:`, blocksError);
          return sendOnce(500, {
            error: 'blocks_generation_failed',
            message: blocksError
          });
        }

        if (ranking) {
          const candidates = await db.select().from(ranking_candidates)
            .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
            .orderBy(ranking_candidates.rank);

          // Use shared helper for mapping (POST route always includes businessHours)
          const blocks = await mapCandidatesToBlocks(candidates, {
            isHoliday: false,
            hasSpecialHours: false,
            logPlusCodes: true
          });

          // Fetch strategy for response
          const [strategyRow] = await db.select().from(strategies)
            .where(eq(strategies.snapshot_id, snapshotId))
            .limit(1);

          console.log(`[blocks-fast POST] ✅ Returning ${blocks.length} generated blocks`);
          return sendOnce(200, {
            status: 'ok',
            snapshot_id: snapshotId,
            blocks: blocks,
            ranking_id: ranking.ranking_id,
            strategy: {
              strategy_for_now: strategyRow?.strategy_for_now || '',
              consolidated: strategyRow?.consolidated_strategy || ''
            },
            message: 'Smart blocks generated successfully'
          });
        } else {
          console.error(`[blocks-fast POST] ⚠️  No ranking found for snapshot after generation`);

          // Still include strategy even if no ranking
          const [strategyRow] = await db.select().from(strategies)
            .where(eq(strategies.snapshot_id, snapshotId))
            .limit(1);

          return sendOnce(200, {
            status: 'ok',
            snapshot_id: snapshotId,
            blocks: [],
            strategy: {
              strategy_for_now: strategyRow?.strategy_for_now || '',
              consolidated: strategyRow?.consolidated_strategy || ''
            },
            message: 'Smart blocks generated (details pending)'
          });
        }
      } else {
        // Job already exists - use shared helper to ensure blocks exist
        console.log(`[blocks-fast POST] Job already exists for ${snapshotId}, checking if blocks need generation...`);

        const [strategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

        // If strategy is complete but ranking missing, generate SmartBlocks now
        if (strategy && ['complete', 'ok'].includes(strategy.status)) {
          const { ranking, error } = await ensureSmartBlocksExist(snapshotId, {
            strategyRow: strategy,
            snapshot
          });

          if (error) {
            console.error(`[blocks-fast POST] SmartBlocks generation failed:`, error);
            return sendOnce(500, {
              error: 'blocks_generation_failed',
              message: error
            });
          }

          if (ranking) {
            console.log(`[blocks-fast POST] ✅ SmartBlocks generated for existing job`);
          }
        }

        return sendOnce(202, {
          status: 'pending',
          snapshot_id: snapshotId,
          blocks: [],
          message: 'Smart Blocks generating - they will appear automatically when ready'
        });
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
