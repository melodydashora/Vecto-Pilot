// server/routes/diagnostics-strategy.js
// Test routes for strategy pipeline components

import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { strategies, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { ensureStrategyRow } from '../lib/strategy-utils.js';
import { runMinStrategy } from '../lib/providers/minstrategy.js';
import { runBriefing } from '../lib/providers/briefing.js';

export const router = Router();

/** POST /api/diagnostics/test-claude/:snapshotId */
router.post('/test-claude/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    // Check snapshot exists
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found', snapshot_id: snapshotId });
    }

    await ensureStrategyRow(snapshotId);
    await runMinStrategy(snapshotId);

    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      has_minstrategy: !!(row.minstrategy && row.minstrategy.trim().length),
      minstrategy_length: row.minstrategy?.length || 0,
      minstrategy: row.minstrategy
    });
  } catch (error) {
    console.error(`[diagnostics] test-claude error:`, error);
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
    await runBriefing(snapshotId);

    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    const briefing = row.briefing || { events: [], holidays: [], traffic: [], news: [] };

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      has_briefing: JSON.stringify(briefing) !== '{}',
      briefing
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

    const hasMin = !!(row.minstrategy && row.minstrategy.trim().length);
    const briefing = row.briefing || {};
    const hasBriefing = JSON.stringify(briefing) !== '{}';
    const hasConsolidated = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

    res.json({
      snapshot_id: snapshotId,
      has_min: hasMin,
      has_briefing: hasBriefing,
      has_consolidated: hasConsolidated,
      user_resolved_address: row.user_resolved_address,
      user_resolved_city: row.user_resolved_city,
      user_resolved_state: row.user_resolved_state,
      status: row.status,
      briefing
    });
  } catch (error) {
    console.error(`[diagnostics] strategy-status error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
