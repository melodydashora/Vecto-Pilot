// server/routes/blocks-idempotent.js
// Idempotent enqueue pattern for triad processing
import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { strategies, triad_jobs, snapshots } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { idempotency } from '../middleware/idempotency.js';
import { ensureStrategyRow } from '../lib/strategy-utils.js';
import { runMinStrategy } from '../lib/providers/minstrategy.js';
import { runBriefing } from '../lib/providers/briefing.js';
import { runHolidayCheck } from '../lib/providers/holiday-checker.js';

const router = Router();

// POST /api/blocks - Idempotent enqueue for triad processing
router.post('/api/blocks', idempotency({ ttlMs: 60000 }), async (req, res) => {
  const { snapshotId } = req.body || {};
  
  if (!snapshotId) {
    return res.status(400).json({ ok: false, error: 'snapshotId required' });
  }

  // Validate snapshotId format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
    return res.status(400).json({ ok: false, error: 'Invalid snapshotId format' });
  }

  try {
    // Check if strategy already exists
    const [existing] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    if (existing) {
      // Strategy exists, return success
      return res.status(200).json({ 
        ok: true, 
        status: existing.status,
        snapshotId 
      });
    }

    // Enqueue triad job (idempotent insert with unique constraint)
    const [job] = await db
      .insert(triad_jobs)
      .values({
        snapshot_id: snapshotId,
        kind: 'triad',
        status: 'queued'
      })
      .onConflictDoNothing()
      .returning();

    if (!job) {
      // Job already queued (conflict), return 202
      return res.status(202).json({ 
        ok: true, 
        status: 'queued', 
        snapshotId 
      });
    }

    // Job successfully queued - NOW TRIGGER THE PROVIDERS
    // Fire-and-forget: kick providers in parallel
    // Consolidation will be triggered by NOTIFY after all providers complete
    console.log(`[blocks] 🚀 Triggering strategy generation for snapshot ${snapshotId}`);
    
    // Ensure strategy row exists first
    await ensureStrategyRow(snapshotId);
    
    // Kick providers in parallel (fire-and-forget)
    // IMPORTANT: Holiday check runs FIRST to show banner immediately
    Promise.allSettled([
      runHolidayCheck(snapshotId),    // FAST: writes strategies.holiday (1-2s)
      runMinStrategy(snapshotId),     // writes strategies.minstrategy  
      runBriefing(snapshotId)         // writes briefings table (Perplexity comprehensive research)
    ]).catch(() => { /* handled in provider logs */ });

    // Job successfully queued and providers kicked off
    return res.status(202).json({ 
      ok: true, 
      status: 'queued', 
      snapshotId,
      kicked: ['holiday', 'minstrategy', 'briefing']
    });
  } catch (error) {
    console.error('[blocks] Enqueue error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Failed to enqueue strategy generation' 
    });
  }
});

export default router;
