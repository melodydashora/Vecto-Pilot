// server/api/strategy/content-blocks.js
// ============================================================================
// STRATEGY + BLOCKS READ API (Read-Only Endpoint)
// ============================================================================
//
// PURPOSE: Returns strategy + venue blocks status for polling/display
// MOUNT POINT: /api/blocks (see bootstrap/routes.js)
//
// ENDPOINTS:
//   GET /api/blocks/strategy/:snapshotId - Poll for strategy + blocks status
//
// USAGE:
//   - useStrategy.ts hook polls this endpoint
//   - co-pilot.tsx uses this for React Query polling
//   - Returns status: 'missing' | 'pending' | 'pending_blocks' | 'ok' | 'error'
//
// NOTE: This endpoint does NOT generate blocks. For generation, use:
//   - POST /api/blocks-fast (triggers full waterfall)
//   - GET /api/blocks-fast?snapshotId=X (generates if missing)
//
// ============================================================================

import { Router } from "express";
import { db } from "../../db/drizzle.js";
import {
  strategies,
  rankings,
  ranking_candidates,
  briefings,
} from "../../../shared/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth.js";
import { requireSnapshotOwnership } from "../../middleware/require-snapshot-ownership.js";
import { PHASE_EXPECTED_DURATIONS, updatePhase } from "../../lib/strategy/strategy-utils.js";
import { toApiBlock } from "../../validation/transformers.js";
// 2026-01-10: S-004 FIX - Use canonical status constants
import { getBriefingReadiness, BriefingNotReadyError, cachedBriefingRetryReason } from '../../lib/briefing/briefing-readiness.js';
import { STRATEGY_STATUS, isStrategyComplete } from "../../lib/strategy/status-constants.js";

export const router = Router();

/**
 * GET /api/blocks/strategy/:snapshotId
 *
 * Poll endpoint for strategy and venue blocks status.
 *
 * Response statuses:
 * - 'missing': No strategy row exists for this snapshot
 * - 'pending': Strategy is being generated (check waitFor array)
 * - 'pending_blocks': Strategy ready, blocks still generating
 * - 'ok': Everything ready, includes strategy + blocks
 * - 'error': Internal error occurred
 *
 * @param {string} snapshotId - UUID of the snapshot
 * @returns {Object} { status, snapshot_id, timeElapsedMs, strategy?, blocks?, ranking_id? }
 */
// 2026-08-11 (todo #31): ownership middleware before any strategy/briefing read
router.get("/strategy/:snapshotId", requireAuth, requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;

  try {
    // Fetch strategy and snapshot data
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    // Fetch briefing from separate briefings table.
    // 2026-07-06: the snapshots fetch that used to sit here is gone — its only
    // consumers were the holiday reads, which now come from briefings.holiday.
    const [briefingRow] = await db
      .select()
      .from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId))
      .limit(1);

    // A stored failure must win over pending text, old text, or existing venues.
    // Returning 200 with the canonical error status lets the poller stop and show
    // the blocking retry screen instead of spinning forever.
    const readiness = getBriefingReadiness(briefingRow, snapshotId);
    if ((strategy?.status === 'error' || strategy?.status === STRATEGY_STATUS.FAILED) || readiness.failed) {
      const briefingFailed = readiness.failed || strategy?.error_message?.startsWith('briefing_failed:');
      return res.json({
        status: 'error',
        snapshotId,
        phase: strategy?.phase,
        error: briefingFailed ? 'briefing_failed' : 'strategy_failed',
        message: readiness.failed
          ? new BriefingNotReadyError(briefingRow, snapshotId).message
          : strategy.error_message || 'Strategy generation failed. Please retry.',
        timeElapsedMs: 0,
      });
    }

    if (!strategy) {
      // 2026-01-10: Use camelCase for API response per contract
      return res.json({
        status: "missing",
        snapshotId: snapshotId,
        timeElapsedMs: 0,
        phase: "starting", // Strategy row not yet created, still initializing
      });
    }
    const retryReason = isStrategyComplete(strategy.status)
      ? cachedBriefingRetryReason(briefingRow, snapshotId) : null;
    if (retryReason) {
      return res.json({
        status: 'error', snapshotId, error: 'briefing_failed', message: retryReason,
        retry: 'new_snapshot', strategyFresh: false, timeElapsedMs: 0,
      });
    }

    // Holiday from the briefing section (errorMarker-guarded; null when the
    // section failed or hasn't landed yet — never a fabricated value)
    const briefingHoliday =
      (briefingRow?.holiday && !briefingRow.holiday._generationFailed && briefingRow.holiday.holiday) || null;

    // Format briefing for frontend (useStrategy expects camelCase per API contract)
    // 2026-01-10: Fixed snake_case → camelCase for schoolClosures
    // 2026-07-06: Holiday info now in briefings.holiday jsonb section
    const briefingData = briefingRow ? {
      events: briefingRow.events || [],
      news: briefingRow.news?.items || briefingRow.news || [],
      traffic: briefingRow.traffic_conditions || {},
      schoolClosures: briefingRow.school_closures || [],
    } : null;

    // Calculate elapsed time
    // 2026-01-14: Lean strategies - use created_at as canonical timestamp (strategy_timestamp dropped)
    const startedAt = strategy.created_at ?? null;
    const timeElapsedMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : 0;

    // Check if immediate strategy is ready (strategy_for_now)
    const hasStrategyForNow = !!(
      strategy.strategy_for_now && strategy.strategy_for_now.trim().length
    );

    if (!hasStrategyForNow) {
      // Strategy pending - return pending status with phase info and timing metadata
      // Log when phase is NULL (should not happen after fix)
      const currentPhase = strategy.phase || 'starting';
      if (!strategy.phase) {
        console.warn(`[VENUE] WARNING: phase is NULL for ${snapshotId.slice(0, 8)} - falling back to 'starting'`);
      }

      // Calculate phase timing for dynamic progress
      const phaseStartedAt = strategy.phase_started_at
        ? new Date(strategy.phase_started_at).toISOString()
        : null;
      const phaseElapsedMs = strategy.phase_started_at
        ? Date.now() - new Date(strategy.phase_started_at).getTime()
        : 0;
      const expectedDurationMs = PHASE_EXPECTED_DURATIONS[currentPhase] || 5000;

      // 2026-01-10: Use camelCase for API response per contract
      return res.json({
        status: STRATEGY_STATUS.PENDING,
        snapshotId: snapshotId,
        timeElapsedMs,
        phase: currentPhase,
        // Timing metadata for dynamic progress calculation
        timing: {
          phaseStartedAt: phaseStartedAt,
          phaseElapsedMs: phaseElapsedMs,
          expectedDurationMs: expectedDurationMs,
          expectedDurations: PHASE_EXPECTED_DURATIONS
        },
        briefingStatus: readiness.ready ? 'complete' : 'pending',
        strategyFresh: false,
        waitFor: readiness.ready ? ["strategy"] : ["briefing"],
        strategy: {
          strategyForNow: "",
          holiday: briefingHoliday || 'none',
          briefing: briefingData,
        },
      });
    }

    // Fetch venue blocks/recommendations
    let blocks = [];
    const [ranking] = await db
      .select()
      .from(rankings)
      .where(eq(rankings.snapshot_id, snapshotId))
      .limit(1);

    if (ranking) {
      const candidates = await db
        .select()
        .from(ranking_candidates)
        .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
        .orderBy(ranking_candidates.rank);

      // 2026-01-10: Use centralized transformer for snake/camel tolerance
      // toApiBlock handles isOpen, streetViewUrl, businessHours casing automatically
      blocks = candidates.map((c) => ({
        ...toApiBlock(c),
        rankingId: ranking.ranking_id,
      }));
    } else {
      // Rankings not yet created - strategy is ready but blocks are still generating
      const currentPhase = strategy.phase || 'venues';
      const phaseStartedAt = strategy.phase_started_at
        ? new Date(strategy.phase_started_at).toISOString()
        : null;
      const phaseElapsedMs = strategy.phase_started_at
        ? Date.now() - new Date(strategy.phase_started_at).getTime()
        : 0;
      const expectedDurationMs = PHASE_EXPECTED_DURATIONS[currentPhase] || 5000;

      // 2026-01-10: Use camelCase for API response per contract
      return res.json({
        status: readiness.ready ? STRATEGY_STATUS.PENDING_BLOCKS : STRATEGY_STATUS.PENDING,
        snapshotId: snapshotId,
        timeElapsedMs,
        phase: readiness.ready ? currentPhase : 'analyzing',
        // Timing metadata for dynamic progress calculation
        timing: {
          phaseStartedAt: phaseStartedAt,
          phaseElapsedMs: phaseElapsedMs,
          expectedDurationMs: expectedDurationMs,
          expectedDurations: PHASE_EXPECTED_DURATIONS
        },
        briefingStatus: readiness.ready ? 'complete' : 'pending',
        ...(!readiness.ready ? { strategyFresh: false } : {}),
        waitFor: readiness.ready ? ["blocks"] : ["briefing"],
        strategy: {
          strategyForNow: strategy.strategy_for_now || "",
          holiday: briefingHoliday || 'none',
          briefing: briefingData,
        },
        blocks: [],
      });
    }

    // Auto-correct phase if blocks exist but phase stuck (Fix #15.2)
    if (readiness.ready && strategy.phase !== 'complete') {
      console.log(`[VENUE] Auto-correcting phase: ${strategy.phase} → complete for ${snapshotId.slice(0, 8)}`);
      await updatePhase(snapshotId, 'complete');
    }

    // Strategy AND blocks ready - return complete data
    // 2026-01-10: Use camelCase for API response per contract
    res.json({
      status: readiness.ready ? STRATEGY_STATUS.OK : STRATEGY_STATUS.PENDING,
      snapshotId: snapshotId,
      timeElapsedMs,
      phase: readiness.ready ? 'complete' : 'analyzing',
      briefingStatus: readiness.ready ? 'complete' : 'pending',
      ...(!readiness.ready ? { strategyFresh: false, waitFor: ['briefing'] } : {}),
      strategy: {
        strategyForNow: strategy.strategy_for_now || "",
        holiday: briefingHoliday,
        briefing: briefingData,
      },
      blocks,
      rankingId: ranking.ranking_id,
    });
  } catch (error) {
    console.error(`[VENUE] Error:`, error);
    res.status(500).json({
      status: "error",
      error: "internal_error",
      message: error.message,
      timeElapsedMs: 0,
    });
  }
});

export default router;
