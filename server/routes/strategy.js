// server/routes/strategy.js
// Model-agnostic strategy API (no blocks coupling)

import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { ensureStrategyRow } from '../lib/strategy-utils.js';
import { runMinStrategy } from '../lib/providers/minstrategy.js';
import { runBriefing } from '../lib/providers/briefing.js';
import { safeElapsedMs } from './utils/safeElapsedMs.js';

export const router = Router();

/** GET /api/strategy/:snapshotId */
router.get('/strategy/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[strategy] GET /api/strategy/${snapshotId} - Fetching from DB...`);
    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!row) {
      console.log(`[strategy] ❌ Strategy not found for snapshot ${snapshotId}`);
      return res.status(404).json({ error: 'not_found', snapshot_id: snapshotId });
    }
    
    console.log(`[strategy] ✅ Strategy found: status=${row.status}, has_consolidated=${!!row.consolidated_strategy}`);

    const hasMin = !!(row.minstrategy && row.minstrategy.trim().length);
    const hasBriefing = !!(row.briefing && JSON.stringify(row.briefing) !== '{}');
    const hasConsolidated = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

    const waitFor = [];
    if (!hasMin) waitFor.push('minstrategy');
    if (!hasBriefing) waitFor.push('briefing');
    if (!hasConsolidated) waitFor.push('consolidated');

    const startedAt = row.strategy_timestamp ?? row.created_at ?? null;
    const timeElapsedMs = safeElapsedMs(startedAt, Date.now());

    res.json({
      status: hasConsolidated ? 'ok' : 'pending',
      snapshot_id: snapshotId,
      min: hasMin ? row.minstrategy : '',
      briefing: row.briefing || { events: [], holidays: [], traffic: [], news: [] },
      consolidated: hasConsolidated ? row.consolidated_strategy : '',
      waitFor,
      timeElapsedMs
    });
  } catch (error) {
    console.error(`[strategy] GET error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/seed  { snapshot_id } */
router.post('/strategy/seed', async (req, res) => {
  const { snapshot_id } = req.body || {};
  
  if (!snapshot_id) {
    return res.status(400).json({ error: 'snapshot_id_required' });
  }

  try {
    await ensureStrategyRow(snapshot_id);
    res.json({ ok: true, snapshot_id });
  } catch (error) {
    console.error(`[strategy] Seed error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/run/:snapshotId  (fire-and-forget providers) */
router.post('/strategy/run/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    await ensureStrategyRow(snapshotId);

    // Kick providers in parallel; consolidation will be triggered by NOTIFY
    Promise.allSettled([
      runMinStrategy(snapshotId),     // writes strategies.minstrategy
      runBriefing(snapshotId)         // writes strategies.briefing_news/events/traffic
    ]).catch(() => { /* handled in provider logs */ });

    res.status(202).json({ 
      status: 'pending', 
      snapshot_id: snapshotId, 
      kicked: ['minstrategy', 'briefing'] 
    });
  } catch (error) {
    console.error(`[strategy] Run error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
