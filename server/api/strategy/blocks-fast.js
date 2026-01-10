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
//   1. STRATEGY_CONTEXT role → events, traffic, news (briefings table)
//   2. STRATEGY_TACTICAL role → strategy_for_now (strategies table)
//   3. VENUE_SCORER role → venue recommendations (ranking_candidates table)
//   4. Google APIs → distances, business hours, enrichment
//
// NOTE: Daily strategy (STRATEGY_DAILY) is NOT generated automatically.
//       It's on-demand via POST /api/strategy/daily/:snapshotId when user requests it.
//
// RACE CONDITION PREVENTION:
//   Uses PostgreSQL Advisory Locks to prevent duplicate AI calls when
//   multiple requests arrive simultaneously for the same snapshot.
//   This supports horizontal scaling across multiple servers.
//   Updated 2026-01-05: Replaced in-memory Map with pg_advisory_xact_lock
//
// RELATED:
//   - /api/blocks/strategy/:snapshotId (read-only polling, see content-blocks.js)
//   - server/lib/venue/enhanced-smart-blocks.js (venue generation logic)
//   - server/lib/strategy/tactical-planner.js (VENUE_SCORER role)
//
// ============================================================================
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { snapshots, rankings, ranking_candidates, strategies, triad_jobs, briefings } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { isStrategyReady, ensureStrategyRow, updatePhase } from '../../lib/strategy/strategy-utils.js';
// 2026-01-10: S-004 FIX - Use canonical status constants instead of hardcoded strings
import {
  STRATEGY_STATUS,
  STRATEGY_IN_PROGRESS_STATUSES,
  isStrategyComplete
} from '../../lib/strategy/status-constants.js';
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { runImmediateStrategy } from '../../lib/ai/providers/consolidator.js';
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';
import { resolveVenueAddressesBatch } from '../../lib/venue/venue-address-resolver.js';
import { isPlusCode } from '../utils/http-helpers.js';
// 2026-01-09: Only import phaseEmitter (for phase progress updates)
// strategyEmitter/blocksEmitter removed - DB NOTIFY is canonical for readiness events
// See LESSONS_LEARNED.md: "duplicate SSE broadcast" incident
// Extracted to dedicated module (eliminates legacy SSE router dependency)
import { phaseEmitter } from '../../events/phase-emitter.js';
import { sseLog, venuesLog, triadLog, dbLog, briefingLog } from '../../logger/workflow.js';
// 2026-01-10: Import canonical transformer (single source of truth for block mapping)
import { toApiBlock } from '../../validation/transformers.js';

const router = Router();

// PostgreSQL Advisory Lock helpers for cross-server coordination
// 2026-01-10: S-002 FIX - Now uses TRANSACTION-SCOPED locks (pg_try_advisory_xact_lock)
//
// CRITICAL CHANGE: Advisory locks are now transaction-scoped, meaning:
//   1. Lock is AUTOMATICALLY released when transaction commits/rollbacks
//   2. No risk of lock leaks due to connection pooling mismatches
//   3. Must use db.transaction() wrapper for the generation logic
//
// For long-running operations (like SmartBlocks generation that calls external APIs),
// we use a two-phase approach:
//   Phase 1: Short transaction to acquire lock + validate preconditions
//   Phase 2: Generation runs outside transaction (lock released after phase 1)
//   Phase 3: Row-level locking (UPDATE strategies SET status='ok' WHERE status='running')
//
// This is safe because:
//   - strategies.status acts as a secondary state-based lock
//   - If phase 2 fails, status remains 'running' (can be retried/cleaned)
//   - See: .serena/memories/strategy-pipeline-audit-2026-01-10.md

/**
 * Try to acquire a transaction-scoped advisory lock for a snapshot.
 * Must be called inside a db.transaction() block.
 * Lock auto-releases when transaction commits or rollbacks.
 *
 * 2026-01-10: S-002 FIX - Changed from session-level to transaction-scoped
 *
 * @param {string} snapshotId - Snapshot UUID to lock
 * @returns {Promise<boolean>} true if lock acquired, false if already held
 */
async function tryAcquireXactLock(snapshotId) {
  const result = await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) as acquired`
  );
  return result.rows[0]?.acquired === true;
}

/**
 * Check if a generation lock is currently held (for status checking only).
 * This is a non-blocking check that doesn't acquire the lock.
 *
 * @param {string} snapshotId - Snapshot UUID to check
 * @returns {Promise<boolean>} true if lock is NOT held (available), false if held
 */
async function isLockAvailable(snapshotId) {
  // pg_try_advisory_lock returns true if we got it - if so, release immediately
  const result = await db.execute(
    sql`SELECT pg_try_advisory_lock(hashtext(${snapshotId})) as acquired`
  );
  const acquired = result.rows[0]?.acquired === true;
  if (acquired) {
    // Release immediately - we just wanted to check
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${snapshotId}))`);
  }
  return acquired; // If we got it (and released), it was available
}

// DEPRECATED: Session-level locks - kept for reference only
// async function tryAcquireGenerationLock(snapshotId) { ... }
// async function waitForGenerationLock(snapshotId) { ... }
// async function releaseGenerationLock(snapshotId) { ... }

// ============================================================================
// SHARED HELPERS - DRY principle: single source of truth for blocks logic
// ============================================================================

/**
 * Ensure SmartBlocks exist for a snapshot, generating them if missing.
 * Single function replaces 3 duplicate call sites.
 *
 * 2026-01-10: S-002 FIX - Uses two-phase locking approach:
 *   Phase 1: Short transaction to check/claim via strategies.status
 *   Phase 2: Long-running generation (external APIs) outside transaction
 *
 * This avoids advisory lock leaks with connection pooling.
 *
 * @param {string} snapshotId - Snapshot UUID
 * @param {Object} options - Optional overrides
 * @param {Object} options.strategyRow - Pre-fetched strategy row (avoids extra DB call)
 * @param {Object} options.briefingRow - Pre-fetched briefing row (avoids extra DB call)
 * @param {Object} options.snapshot - Pre-fetched snapshot row (avoids extra DB call)
 * @param {string} options.userId - Authenticated user ID (required for ownership)
 * @returns {Promise<{ranking: Object|null, generated: boolean, error: string|null}>}
 */
async function ensureSmartBlocksExist(snapshotId, options = {}) {
  // Check if blocks already exist
  const [existingRanking] = await db.select().from(rankings)
    .where(eq(rankings.snapshot_id, snapshotId)).limit(1);

  if (existingRanking) {
    return { ranking: existingRanking, generated: false, error: null };
  }

  // 2026-01-10: S-002 FIX - Use two-phase approach with state-based locking
  // Phase 1: Try to claim generation via transaction-scoped advisory lock + status check
  let canGenerate = false;
  let strategyRow = options.strategyRow;
  let briefingRow = options.briefingRow;
  let snapshot = options.snapshot;

  try {
    // Short transaction to atomically check and claim
    await db.transaction(async (tx) => {
      // Try to acquire transaction-scoped advisory lock
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) as acquired`
      );
      const lockAcquired = lockResult.rows[0]?.acquired === true;

      if (!lockAcquired) {
        // Another process has the lock - they're generating
        venuesLog.info(`[S-002] Transaction lock held by another process for ${snapshotId.slice(0, 8)}`);
        return; // Transaction commits, lock check was atomic
      }

      // Lock acquired - check if strategy is ready and not already being processed
      if (!strategyRow) {
        const [row] = await tx.select().from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        strategyRow = row;
      }

      if (!strategyRow?.strategy_for_now) {
        venuesLog.warn(`[S-002] No strategy_for_now for ${snapshotId.slice(0, 8)}`);
        return;
      }

      // Check if status indicates generation is already happening
      if (strategyRow.status === STRATEGY_STATUS.PENDING_BLOCKS) {
        // Already being generated by another process
        venuesLog.info(`[S-002] Status already pending_blocks for ${snapshotId.slice(0, 8)}`);
        return;
      }

      // Claim by marking status as pending_blocks (atomic state transition)
      await tx.update(strategies).set({
        status: STRATEGY_STATUS.PENDING_BLOCKS,
        phase: 'venues',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));

      // Fetch other required data while we have the lock
      if (!briefingRow) {
        const [row] = await tx.select().from(briefings)
          .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
        briefingRow = row;
      }

      if (!snapshot) {
        const [row] = await tx.select().from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
        snapshot = row;
      }

      canGenerate = true;
      // Transaction commits here, advisory lock auto-releases
    });
  } catch (err) {
    venuesLog.error(4, `[S-002] Lock transaction failed`, err);
    return { ranking: null, generated: false, error: `lock_failed: ${err.message}` };
  }

  if (!canGenerate) {
    // Another process is handling it - poll for completion
    venuesLog.info(`[S-002] Waiting for other process to complete ${snapshotId.slice(0, 8)}`);

    // Poll with exponential backoff (max 30s)
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, Math.min(1000 * (i + 1), 5000)));
      const [ranking] = await db.select().from(rankings)
        .where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      if (ranking) {
        return { ranking, generated: false, error: null };
      }
    }
    return { ranking: null, generated: false, error: 'generation_timeout' };
  }

  // Validate we have all required data
  if (!strategyRow?.strategy_for_now) {
    return { ranking: null, generated: false, error: 'missing_immediate_strategy' };
  }
  if (!briefingRow) {
    return { ranking: null, generated: false, error: 'missing_briefing' };
  }
  if (!snapshot) {
    return { ranking: null, generated: false, error: 'missing_snapshot' };
  }

  // Phase 2: Generate SmartBlocks (outside transaction - makes external API calls)
  venuesLog.info(`[blocks-fast] Generating SmartBlocks for ${snapshotId.slice(0, 8)}`);

  try {
    // 2026-01-09: P0-3 FIX - Pass authenticated userId instead of null
    await generateEnhancedSmartBlocks({
      snapshotId,
      immediateStrategy: strategyRow.strategy_for_now,
      briefing: briefingRow,
      snapshot: snapshot,
      user_id: options.userId || snapshot.user_id,
      phaseEmitter: options.phaseEmitter
    });

    // Fetch newly created ranking
    const [newRanking] = await db.select().from(rankings)
      .where(eq(rankings.snapshot_id, snapshotId)).limit(1);

    if (newRanking) {
      venuesLog.done(4, `SmartBlocks generated for ${snapshotId.slice(0, 8)}`);
      await updatePhase(snapshotId, 'complete', { phaseEmitter: options.phaseEmitter });
      return { ranking: newRanking, generated: true, error: null };
    } else {
      venuesLog.warn(4, `SmartBlocks generated but no ranking found`);
      return { ranking: null, generated: true, error: 'ranking_not_created' };
    }
  } catch (err) {
    venuesLog.error(4, `SmartBlocks generation failed`, err);
    // Reset status so retry is possible
    await db.update(strategies).set({
      status: STRATEGY_STATUS.OK,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId)).catch(() => {});
    return { ranking: null, generated: false, error: err.message };
  }
}

/**
 * Resolve addresses and transform candidates to API blocks using canonical transformer.
 *
 * 2026-01-10: REFACTORED - Uses toApiBlock from transformers.js as single source of truth.
 * This eliminates duplicate field mapping logic and ensures consistent casing.
 *
 * Steps:
 * 1. Batch resolve venue addresses (efficient, parallel)
 * 2. Filter Plus Codes from resolved addresses
 * 3. Merge resolved address into candidate
 * 4. Transform using toApiBlock (handles all snake/camel variants)
 *
 * @param {Array} candidates - Raw candidates from ranking_candidates table
 * @param {Object} options - Configuration options
 * @param {boolean} options.isHoliday - Whether today is a holiday (suppresses businessHours)
 * @param {boolean} options.hasSpecialHours - Whether special hours are in effect
 * @param {boolean} options.logPlusCodes - Whether to log filtered Plus Codes
 * @returns {Promise<Array>} Formatted blocks ready for client
 */
async function mapCandidatesToBlocks(candidates, options = {}) {
  const { isHoliday = false, hasSpecialHours = false, logPlusCodes = false } = options;

  // Step 1: Batch resolve venue addresses for all candidates in parallel
  const venueKeys = candidates.map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
  const addressMap = await resolveVenueAddressesBatch(venueKeys);

  // Step 2-4: Map each candidate using canonical transformer
  // toApiBlock imported at top of file from '../../validation/transformers.js'
  return candidates.map(c => {
    const coordKey = `${c.lat},${c.lng}`;

    // Step 2: Extract and filter address
    const venueData = addressMap[coordKey];
    let resolvedAddress = venueData?.formatted_address || venueData?.address || null;

    // Filter Plus Codes
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

    // Final Plus Code check
    if (resolvedAddress && isPlusCode(resolvedAddress)) {
      if (logPlusCodes) {
        console.log(`[blocks-fast] ⚠️ Filtering Plus Code from candidate: "${resolvedAddress}" for ${c.name}`);
      }
      resolvedAddress = null;
    }

    // Step 3: Prepare input for transformer with resolved address
    // If holiday/special hours, suppress businessHours by setting to null
    const inputForTransformer = {
      ...c,
      address: resolvedAddress || c.address,
      // Suppress business hours on holidays (transformer will pass through null)
      businessHours: (isHoliday || hasSpecialHours) ? null : c.business_hours,
      business_hours: (isHoliday || hasSpecialHours) ? null : c.business_hours
    };

    // Step 4: Use canonical transformer (single source of truth for field mapping)
    // toApiBlock handles: snake/camel variants, event_start_time/event_time, staging normalization
    return toApiBlock(inputForTransformer);
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

  // 2026-01-09: Phase 1 schema cleanup - use camelCase property names matching mapCandidatesToBlocks output
  // BUG FIX: Was using snake_case which didn't match the transformed blocks (25mi filter was broken!)
  const filtered = blocks.filter(b => within25Miles(b.estimatedDistanceMiles));
  const rejected = blocks.filter(b => !within25Miles(b.estimatedDistanceMiles)).length;

  // Sort: closest high-value first → furthest high-value last
  // Primary sort: valuePerMin DESC (highest value first)
  // Secondary sort: estimatedDistanceMiles ASC (closest first within same value tier)
  const sorted = filtered.sort((a, b) => {
    const valueDiff = (b.valuePerMin || 0) - (a.valuePerMin || 0);
    if (Math.abs(valueDiff) > 0.01) return valueDiff; // Different value tiers
    return (a.estimatedDistanceMiles || 999) - (b.estimatedDistanceMiles || 999); // Same tier: closest first
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
  // 2026-01-09: P0-3 FIX - Get authenticated userId for ownership check
  const authUserId = req.auth?.userId;
  venuesLog.info(`[blocks-fast] GET request for ${snapshotId?.slice(0, 8) || 'unknown'}`);

  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshot_required' });
  }

  try {
    // GATE 1: Strategy must be ready before blocks
    const { ready, strategy, status } = await isStrategyReady(snapshotId);
    venuesLog.info(`[blocks-fast] Strategy check: ready=${ready}, status=${status}`);

    if (!ready) {
      // 2026-01-10: S-003 FIX - Error message was misleading
      // isStrategyReady() checks strategy_for_now, NOT consolidated_strategy
      return res.status(202).json({
        ok: false,
        reason: 'strategy_pending',
        status: status || 'pending',
        message: 'Waiting for immediate strategy to complete'
      });
    }

    // Fetch strategy row (model-agnostic columns)
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    // 2026-01-10: D-027 - Use camelCase for API response (single contract)
    // consolidatedStrategy = Briefing tab 6-12hr shift strategy (differs from strategy.consolidated)
    const briefing = strategyRow ? {
      consolidatedStrategy: strategyRow.consolidated_strategy || null,
      strategyForNow: strategyRow.strategy_for_now || null
    } : null;

    // Fetch snapshot for holiday status check
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // 2026-01-09: P0-3 FIX - Enforce snapshot ownership
    // User can only access blocks for their own snapshots
    if (snapshot.user_id && snapshot.user_id !== authUserId) {
      venuesLog.warn(`[blocks-fast] Ownership mismatch: auth=${authUserId?.slice(0, 8)} vs snapshot=${snapshot.user_id?.slice(0, 8)}`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // GATE 2: Ensure blocks exist (generate if missing)
    // 2026-01-09: P0-3 FIX - Pass authUserId for ownership
    const { ranking, error } = await ensureSmartBlocksExist(snapshotId, {
      strategyRow,
      snapshot,
      phaseEmitter,
      userId: authUserId
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

    return res.json({ blocks, rankingId: ranking.ranking_id, briefing, audit });
  } catch (error) {
    triadLog.error(4, 'GET request failed', error);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', requireAuth, expensiveEndpointLimiter, async (req, res) => {
  triadLog.start(`POST request for ${req.body?.snapshotId?.slice(0, 8) || 'unknown'}`);

  const wallClockStart = Date.now();
  const correlationId = req.headers['x-correlation-id'] || randomUUID();

  // Audit trail for deployment verification
  const audit = [];
  const logAudit = (step, data) => {
    const entry = { step, ...data, ts: Date.now() - wallClockStart };
    audit.push(entry);
    dbLog.info(`[audit:${correlationId.slice(0, 8)}] ${step}`);
  };

  let responded = false;
  const sendOnce = (code, body) => {
    if (!responded) {
      responded = true;
      triadLog.info(`Response: ${code} ${body.error || 'ok'}`);
      res.status(code).json({ ...body, audit });
    }
  };

  try {
    // 2026-01-09: P0-3 FIX - Removed userId from body (was accepting arbitrary userId='demo')
    // Authentication ONLY comes from req.auth.userId (set by requireAuth middleware)
    const { snapshotId } = req.body;
    const authUserId = req.auth?.userId;

    if (!snapshotId) {
      triadLog.warn(1, 'Missing snapshotId in request');
      return sendOnce(400, { error: 'snapshot_required', message: 'snapshot_id is required' });
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      triadLog.warn(1, `Invalid UUID: ${snapshotId}`);
      return sendOnce(400, { error: 'invalid_uuid', message: 'snapshotId must be a valid UUID' });
    }

    // CRITICAL: Fetch FULL snapshot row to get location data
    // LLMs cannot reverse geocode - we must provide formatted_address
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return sendOnce(404, { error: 'snapshot_not_found', message: 'snapshot_id does not exist' });
    }

    // 2026-01-09: P0-3 FIX - Enforce snapshot ownership
    // User can only generate blocks for their own snapshots
    if (snapshot.user_id && snapshot.user_id !== authUserId) {
      triadLog.warn(1, `Ownership mismatch: auth=${authUserId?.slice(0, 8)} vs snapshot=${snapshot.user_id?.slice(0, 8)}`);
      return sendOnce(404, { error: 'snapshot_not_found', message: 'snapshot_id does not exist' });
    }

    // CRITICAL: Validate formatted_address exists - LLMs cannot reverse geocode
    if (!snapshot.formatted_address) {
      triadLog.error(1, `Missing formatted_address in snapshot ${snapshotId.slice(0, 8)}`);
      return sendOnce(400, {
        error: 'snapshot_incomplete',
        message: 'Snapshot missing formatted_address - location not resolved'
      });
    }

    triadLog.phase(1, `Snapshot resolved: ${snapshot.city}, ${snapshot.state}`);

    // DEDUPLICATION CHECK: If strategy already running, don't re-trigger it
    // 2026-01-10: S-004 FIX - Use canonical status constants
    const [existingStrategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    // 2026-01-10: STALENESS FIX - Reset stale strategies that never completed
    // Root cause: Previous session left status='pending_blocks' but blocks never generated.
    // Without this check, app serves stale cached data and TRIAD pipeline never runs.
    // Staleness threshold: 30 minutes (TRIAD pipeline should complete in ~2 minutes)
    const STALENESS_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    if (existingStrategy) {
      const strategyAge = Date.now() - new Date(existingStrategy.updated_at || existingStrategy.created_at).getTime();
      const isStale = strategyAge > STALENESS_THRESHOLD_MS;

      // Check for incomplete stale strategies that need reset
      const isStuckPendingBlocks = existingStrategy.status === STRATEGY_STATUS.PENDING_BLOCKS;
      const isStuckInProgress = STRATEGY_IN_PROGRESS_STATUSES.includes(existingStrategy.status);

      if (isStale && (isStuckPendingBlocks || isStuckInProgress)) {
        triadLog.warn(1, `STALENESS FIX: Resetting stale strategy (status=${existingStrategy.status}, age=${Math.round(strategyAge/60000)}min) for ${snapshotId.slice(0, 8)}`);

        // Reset strategy status so fresh pipeline runs
        await db.update(strategies).set({
          status: STRATEGY_STATUS.PENDING,
          phase: 'starting',
          strategy_for_now: null,
          updated_at: new Date()
        }).where(eq(strategies.snapshot_id, snapshotId));

        // Delete stale triad_job so new one can be created
        await db.delete(triad_jobs).where(eq(triad_jobs.snapshot_id, snapshotId));

        // Delete stale briefing so fresh data is generated
        await db.delete(briefings).where(eq(briefings.snapshot_id, snapshotId));

        triadLog.info(`STALENESS FIX: Reset complete, running fresh pipeline for ${snapshotId.slice(0, 8)}`);
        // Fall through to create new job and run full pipeline
      } else if (!isStale && STRATEGY_IN_PROGRESS_STATUSES.includes(existingStrategy.status)) {
        // Recent strategy is still running - don't interfere
        triadLog.info(`Strategy already ${existingStrategy.status} for ${snapshotId.slice(0, 8)}, skipping`);
        return sendOnce(202, {
          ok: false,
          reason: 'strategy_already_running',
          status: existingStrategy.status,
          message: `Strategy is ${existingStrategy.status} - polling/waiting...`,
          snapshotId: snapshotId
        });
      }
    }

    // Re-fetch strategy after potential reset
    const [currentStrategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    // If strategy is COMPLETE/OK/PENDING_BLOCKS, generate SmartBlocks if not already done
    // 2026-01-10: S-004 FIX - Use isStrategyComplete() which handles legacy 'complete' value
    if (currentStrategy && isStrategyComplete(currentStrategy.status)) {
      const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      if (ranking) {
        triadLog.done(4, `Blocks already exist for ${snapshotId.slice(0, 8)}`);
        // Blocks already exist - return with strategy included
        const candidates = await db.select().from(ranking_candidates)
          .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
          .orderBy(ranking_candidates.rank);
        const blocks = await mapCandidatesToBlocks(candidates, { isHoliday: false, hasSpecialHours: false });
        return sendOnce(200, {
          ok: true,
          status: 'ok',
          reason: 'blocks_ready',
          snapshotId: snapshotId,
          blocks,
          rankingId: ranking.ranking_id,
          // 2026-01-10: D-027 - Use camelCase for API response (single contract)
          strategy: {
            strategyForNow: currentStrategy.strategy_for_now || '',
            consolidated: currentStrategy.consolidated_strategy || ''
          }
        });
      }
      // Strategy is ready but blocks don't exist yet - generate them
      venuesLog.info(`Strategy status=${currentStrategy.status}, generating SmartBlocks for ${snapshotId.slice(0, 8)}`);
    }

    // CRITICAL: Create triad_job AND run synchronous waterfall (autoscale compatible)
    try {
      // 2026-01-09: FIX - Use snake_case property name to match Drizzle schema
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
        await updatePhase(snapshotId, 'resolving', { phaseEmitter });

        // Phase 2: Run briefing provider (Gemini with Google Search)
        // Note: Holiday is already in snapshot table from holiday-detector.js
        await updatePhase(snapshotId, 'analyzing', { phaseEmitter });

        // 2026-01-08: FIX - Briefing is now BLOCKING (was non-blocking)
        // The immediate strategy REQUIRES briefing data (traffic, events, news) to be useful.
        // Without briefing, GPT consolidator runs with empty context = poor quality strategy.
        // If briefing fails, we should fail the whole pipeline rather than continue with bad data.
        // 2026-01-10: Capture fresh briefing to pass directly to strategist (no DB re-read)
        let freshBriefing = null;
        try {
          const briefingResult = await runBriefing(snapshotId, { snapshot });
          freshBriefing = briefingResult.briefing;
          // Note: runBriefing logs completion via briefingLog.done()
        } catch (briefingErr) {
          briefingLog.error(2, `Briefing failed (BLOCKING): ${briefingErr.message}`);
          // Mark strategy as error so client knows to retry
          await db.update(strategies).set({
            status: 'error',
            error_message: `briefing_failed: ${briefingErr.message}`.slice(0, 500),
            updated_at: new Date()
          }).where(eq(strategies.snapshot_id, snapshotId));

          return sendOnce(500, {
            error: 'briefing_failed',
            message: `Briefing generation failed: ${briefingErr.message}`,
            snapshotId: snapshotId
          });
        }

        // Phase 3: Immediate Strategy (STRATEGY_TACTICAL role)
        await updatePhase(snapshotId, 'immediate', { phaseEmitter });

        triadLog.phase(3, `[blocks-fast] Calling runImmediateStrategy for ${snapshot.city}, ${snapshot.state}`);

        try {
          // STRATEGY_TACTICAL → strategy_for_now (immediate 1hr strategy for Strategy Tab)
          // 2026-01-10: Pass fresh briefing directly (no DB re-read for stale data)
          await runImmediateStrategy(snapshotId, { snapshot, briefingRow: freshBriefing });

          // 2026-01-09: Removed strategyEmitter.emit - DB NOTIFY 'strategy_ready' is canonical
          // SSE clients receive via subscribeToChannel('strategy_ready') in strategy-events.js
          sseLog.info(`[blocks-fast] strategy_ready (DB NOTIFY) for ${snapshotId.slice(0, 8)}`);
        } catch (immediateErr) {
          triadLog.error(3, `runImmediateStrategy failed`, immediateErr);
          throw immediateErr;
        }

        // Phase 4: Venue Discovery
        await updatePhase(snapshotId, 'venues', { phaseEmitter });

        // 2026-01-10: Use fresh briefing captured earlier, only fetch strategy row
        // This ensures freshBriefing (not stale DB read) is passed to SmartBlocks
        const [consolidatedRow] = await db.select().from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

        triadLog.phase(4, `[blocks-fast] Strategy ready (${consolidatedRow?.strategy_for_now?.length || 0} chars), generating venues`);

        // Use shared helper for block generation
        // 2026-01-09: P0-3 FIX - Pass authUserId for ownership
        // 2026-01-10: Pass freshBriefing directly (captured from runBriefing above)
        const { ranking, error: blocksError } = await ensureSmartBlocksExist(snapshotId, {
          strategyRow: consolidatedRow,
          briefingRow: freshBriefing,
          snapshot,
          phaseEmitter,
          userId: authUserId
        });

        if (blocksError) {
          venuesLog.error(4, `SmartBlocks generation failed: ${blocksError}`);
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

          triadLog.done(4, `Returning ${blocks.length} blocks for ${snapshotId.slice(0, 8)}`);

          // Ensure phase is marked complete (Fix #15 - prevents 98% stuck issue)
          await updatePhase(snapshotId, 'complete', { phaseEmitter });

          // 2026-01-09: Removed blocksEmitter.emit - DB NOTIFY 'blocks_ready' is canonical
          // SSE clients receive via subscribeToChannel('blocks_ready') in strategy-events.js
          sseLog.info(`blocks_ready (DB NOTIFY) for ${snapshotId.slice(0, 8)} (${blocks.length} blocks)`);

          return sendOnce(200, {
            status: 'ok',
            snapshotId: snapshotId,
            blocks: blocks,
            rankingId: ranking.ranking_id,
            // 2026-01-10: D-027 - Use camelCase for API response (single contract)
            strategy: {
              strategyForNow: strategyRow?.strategy_for_now || '',
              consolidated: strategyRow?.consolidated_strategy || ''
            },
            message: 'Smart blocks generated successfully'
          });
        } else {
          venuesLog.warn(4, `No ranking found for ${snapshotId.slice(0, 8)} after generation`);

          // Ensure phase is marked complete even without ranking
          await updatePhase(snapshotId, 'complete', { phaseEmitter });

          // Still include strategy even if no ranking
          const [strategyRow] = await db.select().from(strategies)
            .where(eq(strategies.snapshot_id, snapshotId))
            .limit(1);

          return sendOnce(200, {
            status: 'ok',
            snapshotId: snapshotId,
            blocks: [],
            // 2026-01-10: D-027 - Use camelCase for API response (single contract)
            strategy: {
              strategyForNow: strategyRow?.strategy_for_now || '',
              consolidated: strategyRow?.consolidated_strategy || ''
            },
            message: 'Smart blocks generated (details pending)'
          });
        }
      } else {
        // Job already exists - use shared helper to ensure blocks exist
        triadLog.info(`Job already exists for ${snapshotId.slice(0, 8)}, checking if blocks need generation`);

        const [strategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

        // If strategy is complete but ranking missing, generate SmartBlocks now
        // 2026-01-10: S-004 FIX - Use isStrategyComplete() (includes legacy 'complete')
        if (strategy && isStrategyComplete(strategy.status)) {
          // 2026-01-09: P0-3 FIX - Pass authUserId for ownership
          const { ranking, error } = await ensureSmartBlocksExist(snapshotId, {
            strategyRow: strategy,
            snapshot,
            phaseEmitter,
            userId: authUserId
          });

          if (error) {
            venuesLog.error(4, `SmartBlocks generation failed: ${error}`);
            return sendOnce(500, {
              error: 'blocks_generation_failed',
              message: error
            });
          }

          if (ranking) {
            venuesLog.done(4, `SmartBlocks generated for existing job ${snapshotId.slice(0, 8)}`);
          }
        }

        return sendOnce(202, {
          status: 'pending',
          snapshotId: snapshotId,
          blocks: [],
          message: 'Smart Blocks generating - they will appear automatically when ready'
        });
      }
    } catch (jobErr) {
      triadLog.error(4, `Waterfall error`, jobErr);
      return sendOnce(500, {
        error: 'waterfall_failed',
        message: jobErr.message
      });
    }
  } catch (error) {
    triadLog.error(4, `Unexpected error`, error);
    return sendOnce(500, { error: 'internal_error' });
  }
});

export default router;
