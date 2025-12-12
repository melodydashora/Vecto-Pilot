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
      return res.json({
        status: "missing",
        snapshot_id: snapshotId,
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

    // Format briefing for frontend (useStrategy expects this shape)
    const briefingData = briefingRow ? {
      events: briefingRow.events || [],
      news: briefingRow.news?.items || briefingRow.news || [],
      traffic: briefingRow.traffic_conditions || {},
      holidays: briefingRow.holidays || [],
      school_closures: briefingRow.school_closures || [],
    } : null;

    // Calculate elapsed time
    const startedAt =
      strategy.strategy_timestamp ?? strategy.created_at ?? null;
    const timeElapsedMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : 0;

    // Check if immediate strategy is ready (strategy_for_now)
    // NOTE: consolidated_strategy is for the daily briefing tab (user-request only)
    const hasStrategyForNow = !!(
      strategy.strategy_for_now && strategy.strategy_for_now.trim().length
    );

    if (!hasStrategyForNow) {
      // Strategy pending - return pending status with phase info
      // Log when phase is NULL (should not happen after fix)
      if (!strategy.phase) {
        console.warn(`[content-blocks] WARNING: phase is NULL for ${snapshotId.slice(0, 8)} - falling back to 'starting'`);
      }
      return res.json({
        status: "pending",
        snapshot_id: snapshotId,
        timeElapsedMs,
        phase: strategy.phase || 'starting',
        waitFor: ["strategy"],
        strategy: {
          consolidated: strategy.consolidated_strategy || "",
          strategy_for_now: "",
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

      blocks = candidates.map((c) => ({
        name: c.name,
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
        isOpen: c.features?.isOpen,
        streetViewUrl: c.features?.streetViewUrl,
        eventBadge: c.venue_events?.badge,
        eventSummary: c.venue_events?.summary,
        ranking_id: ranking.ranking_id,
      }));
    } else {
      // Rankings not yet created - strategy is ready but blocks are still generating
      return res.json({
        status: "pending_blocks",
        snapshot_id: snapshotId,
        timeElapsedMs,
        phase: strategy.phase || 'venues',
        waitFor: ["blocks"],
        strategy: {
          consolidated: strategy.consolidated_strategy || "",
          strategy_for_now: strategy.strategy_for_now || "",
          holiday: snapshot?.holiday || 'none',
          briefing: briefingData,
        },
        blocks: [],
      });
    }

    // Strategy AND blocks ready - return complete data
    res.json({
      status: "ok",
      snapshot_id: snapshotId,
      timeElapsedMs,
      phase: 'complete',
      strategy: {
        consolidated: strategy.consolidated_strategy || "",
        strategy_for_now: strategy.strategy_for_now || "",
        holiday: snapshot?.holiday || null,
        briefing: briefingData,
      },
      blocks,
      ranking_id: ranking.ranking_id,
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
