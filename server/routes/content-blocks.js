// server/routes/content-blocks.js
// Structured content blocks for rich strategy display

import { Router } from "express";
import { db } from "../db/drizzle.js";
import {
  strategies,
  snapshots,
  rankings,
  ranking_candidates,
} from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

export const router = Router();

/**
 * GET /api/blocks/strategy/:snapshotId
 * Returns structured content blocks for a strategy
 */
router.get("/strategy/:snapshotId", requireAuth, async (req, res) => {
  const { snapshotId } = req.params;

  try {
    console.log(
      `[content-blocks] Fetching strategy for snapshot ${snapshotId}`,
    );

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
      });
    }

    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);

    // Calculate elapsed time
    const startedAt =
      strategy.strategy_timestamp ?? strategy.created_at ?? null;
    const timeElapsedMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : 0;

    // Check if consolidated strategy is ready
    const hasConsolidated = !!(
      strategy.consolidated_strategy &&
      strategy.consolidated_strategy.trim().length
    );

    if (!hasConsolidated) {
      // Strategy pending - return pending status with timeElapsedMs
      return res.json({
        status: "pending",
        snapshot_id: snapshotId,
        timeElapsedMs,
        waitFor: ["strategy"],
        strategy: {
          holiday: snapshot?.holiday || null,
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
        waitFor: ["blocks"],
        strategy: {
          min: strategy.minstrategy || "",
          consolidated: strategy.consolidated_strategy || "",
          holiday: snapshot?.holiday || null,
        },
        blocks: [],
      });
    }

    // Strategy AND blocks ready - return complete data
    res.json({
      status: "ok",
      snapshot_id: snapshotId,
      timeElapsedMs,
      strategy: {
        min: strategy.minstrategy || "",
        consolidated: strategy.consolidated_strategy || "",
        holiday: snapshot?.holiday || null,
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

/**
 * Generate structured blocks from strategy and snapshot data
 */
function generateBlocks(strategy, snapshot) {
  const blocks = [];
  let order = 1;

  // If strategy has consolidated text, parse it into blocks
  if (strategy.consolidated_strategy) {
    const text = strategy.consolidated_strategy;

    // Add header
    const hour = snapshot?.hour || new Date().getHours();
    const dayPart = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

    blocks.push({
      id: `b${order++}`,
      type: "header",
      order: blocks.length + 1,
      text: `${dayPart} Strategy`,
      level: 2,
    });

    // Split strategy text into paragraphs
    const paragraphs = text.split("\n\n").filter((p) => p.trim().length > 0);

    paragraphs.forEach((para) => {
      const trimmed = para.trim();

      // Check if it's a list (starts with bullet points or numbers)
      if (trimmed.match(/^[-•*]\s/) || trimmed.match(/^\d+\.\s/)) {
        const items = trimmed
          .split("\n")
          .map((line) =>
            line
              .replace(/^[-•*]\s/, "")
              .replace(/^\d+\.\s/, "")
              .trim(),
          )
          .filter((item) => item.length > 0);

        blocks.push({
          id: `b${order++}`,
          type: "list",
          order: blocks.length + 1,
          items,
          style: trimmed.match(/^\d+\.\s/) ? "number" : "bullet",
        });
      } else {
        // Regular paragraph
        blocks.push({
          id: `b${order++}`,
          type: "paragraph",
          order: blocks.length + 1,
          text: trimmed,
        });
      }
    });
  } else {
    // No strategy yet - return placeholder blocks
    blocks.push({
      id: `b${order++}`,
      type: "header",
      order: blocks.length + 1,
      text: "Strategy Generating...",
      level: 2,
    });

    blocks.push({
      id: `b${order++}`,
      type: "paragraph",
      order: blocks.length + 1,
      text: "Your AI-powered strategy is being generated. This typically takes 10-30 seconds.",
    });
  }

  return blocks;
}

export default router;
