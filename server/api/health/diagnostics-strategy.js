// server/api/health/diagnostics-strategy.js
// Test routes for strategy pipeline components

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { strategies, snapshots, briefings } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { runImmediateStrategy } from '../../lib/ai/providers/consolidator.js';

export const router = Router();

/** POST /api/diagnostics/test-immediate/:snapshotId - Test GPT-5.2 immediate strategy */
router.post('/test-immediate/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    // Check snapshot exists
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found', snapshot_id: snapshotId });
    }

    await ensureStrategyRow(snapshotId);

    // Run briefing first (required for immediate strategy)
    await runBriefing(snapshotId, { snapshot });

    // Run immediate strategy
    await runImmediateStrategy(snapshotId, { snapshot });

    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      has_strategy_for_now: !!(row.strategy_for_now && row.strategy_for_now.trim().length),
      strategy_for_now_length: row.strategy_for_now?.length || 0,
      strategy_for_now: row.strategy_for_now
    });
  } catch (error) {
    console.error(`[diagnostics] test-immediate error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/diagnostics/test-briefing/:snapshotId */
router.post('/test-briefing/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    // Check snapshot exists
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found', snapshot_id: snapshotId });
    }

    await ensureStrategyRow(snapshotId);
    await runBriefing(snapshotId, { snapshot });

    // Fetch briefing from briefings table (not strategies)
    const [briefingRow] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    const briefingData = briefingRow || { events: [], traffic_conditions: {}, news: {} };

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      has_briefing: !!briefingRow,
      briefing: briefingData
    });
  } catch (error) {
    console.error(`[diagnostics] test-briefing error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** GET /api/diagnostics/strategy-status/:snapshotId */
router.get('/strategy-status/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!row) {
      return res.status(404).json({ error: 'not_found', snapshot_id: snapshotId });
    }

    // Fetch briefing from briefings table
    const [briefingRow] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    // Fetch snapshot for location context
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    const hasStrategyForNow = !!(row.strategy_for_now && row.strategy_for_now.trim().length);
    const hasBriefing = !!briefingRow;
    const hasConsolidated = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

    res.json({
      snapshot_id: snapshotId,
      has_strategy_for_now: hasStrategyForNow,
      has_briefing: hasBriefing,
      has_consolidated: hasConsolidated,
      formatted_address: snapshot?.formatted_address || null,
      city: snapshot?.city || null,
      state: snapshot?.state || null,
      status: row.status,
      briefing: briefingRow || null
    });
  } catch (error) {
    console.error(`[diagnostics] strategy-status error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
