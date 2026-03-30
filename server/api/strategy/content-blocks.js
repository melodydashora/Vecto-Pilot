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
  snapshots,
  rankings,
  ranking_candidates,
  briefings,
} from "../../../shared/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth.js";
import { PHASE_EXPECTED_DURATIONS, updatePhase } from "../../lib/strategy/strategy-utils.js";
import { toApiBlock } from "../../validation/transformers.js";
// 2026-01-10: S-004 FIX - Use canonical status constants
import { STRATEGY_STATUS } from "../../lib/strategy/status-constants.js";

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
router.get("/strategy/:snapshotId", requireAuth, async (req, res) => {
  const { snapshotId } = req.params;

  try {
    // Fetch strategy and snapshot data
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    if (!strategy) {
      // 2026-01-10: Use camelCase for API response per contract
      return res.json({
        status: "missing",
        snapshotId: snapshotId,
        timeElapsedMs: 0,
        phase: "starting", // Strategy row not yet created, still initializing
      });
    }

    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);

    // Fetch briefing from separate briefings table
    const [briefingRow] = await db
      .select()
      .from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId))
      .limit(1);

    // Format briefing for frontend (useStrategy expects camelCase per API contract)
    // 2026-01-10: Fixed snake_case → camelCase for schoolClosures
    // 2026-01-14: Removed holidays (column dropped in 20251209_drop_unused_briefing_columns.sql)
    //             Holiday info is now in snapshots table (holiday, is_holiday)
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
    // NOTE: consolidated_strategy is for the daily briefing tab (user-request only)
    const hasStrategyForNow = !!(
      strategy.strategy_for_now && strategy.strategy_for_now.trim().length
    );

    if (!hasStrategyForNow) {
      // Strategy pending - return pending status with phase info and timing metadata
      // Log when phase is NULL (should not happen after fix)
      const currentPhase = strategy.phase || 'starting';
      if (!strategy.phase) {
        console.warn(`[content-blocks] WARNING: phase is NULL for ${snapshotId.slice(0, 8)} - falling back to 'starting'`);
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
        waitFor: ["strategy"],
        strategy: {
          consolidated: strategy.consolidated_strategy || "",
          strategyForNow: "",
          holiday: snapshot?.holiday || 'none',
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
        status: STRATEGY_STATUS.PENDING_BLOCKS,
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
        waitFor: ["blocks"],
        strategy: {
          consolidated: strategy.consolidated_strategy || "",
          strategyForNow: strategy.strategy_for_now || "",
          holiday: snapshot?.holiday || 'none',
          briefing: briefingData,
        },
        blocks: [],
      });
    }

    // Auto-correct phase if blocks exist but phase stuck (Fix #15.2)
    if (strategy.phase !== 'complete') {
      console.log(`[content-blocks] Auto-correcting phase: ${strategy.phase} → complete for ${snapshotId.slice(0, 8)}`);
      await updatePhase(snapshotId, 'complete');
    }

    // Strategy AND blocks ready - return complete data
    // 2026-01-10: Use camelCase for API response per contract
    res.json({
      status: STRATEGY_STATUS.OK,
      snapshotId: snapshotId,
      timeElapsedMs,
      phase: 'complete',
      strategy: {
        consolidated: strategy.consolidated_strategy || "",
        strategyForNow: strategy.strategy_for_now || "",
        holiday: snapshot?.holiday || null,
        briefing: briefingData,
      },
      blocks,
      rankingId: ranking.ranking_id,
    });
  } catch (error) {
    console.error(`[content-blocks] Error:`, error);
    res.status(500).json({
      status: "error",
      error: "internal_error",
      message: error.message,
      timeElapsedMs: 0,
    });
  }
});

export default router;
