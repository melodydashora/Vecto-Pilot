// server/api/strategy/strategy.js
// Model-agnostic strategy API (no blocks coupling)

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { strategies, briefings, snapshots } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { safeElapsedMs } from '../utils/safeElapsedMs.js';
import { validateBody } from '../../middleware/validate.js';
import { strategyRequestSchema } from '../../validation/schemas.js';
// 2026-02-12: Added requireAuth - all strategy routes require authentication
import { requireAuth } from '../../middleware/auth.js';
import { requireSnapshotOwnership, verifySnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { readStrategySource } from '../../lib/strategy/strategy-source-store.js';
import { strategyMatchesBriefing, STRATEGY_SOURCE_RETRY } from '../../lib/strategy/strategy-source.js';
import { getBriefingReadiness } from '../../lib/briefing/briefing-readiness.js';
import { getSnapshotReadiness } from '../../lib/location/snapshot-readiness.js';
import { assertMainRunForSnapshot, MainRunAdmissionError } from '../../lib/main-run-admission.js';

const router = Router();

// 2026-02-12: SECURITY FIX - All strategy routes now require authentication
// Previously these were completely open, allowing anyone to fetch/run strategies for any snapshotId
router.use(requireAuth);

// 2026-04-25 (P2-9): /history MUST be declared BEFORE /:snapshotId or Express
// matches the param route first and "history" is treated as a snapshotId.

/** GET /api/strategy/history - Get the CALLER's strategy attempts */
router.get('/history', async (req, res) => {
  // 2026-09-10 (IDOR found while verifying VP-007): this route filtered by the query-string
  // `user_id`, so any signed-in account could list any other driver's strategy history.
  // Identity comes from the bearer token only; a query-string user_id is ignored.
  const user_id = req.auth?.userId;

  if (typeof user_id !== 'string' || !user_id) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log(`[STRATEGY] GET /api/strategy/history user=${user_id.slice(0, 8)}`);

    const attempts = await db.select({
      snapshot_id: strategies.snapshot_id,
      status: strategies.status,
      created_at: strategies.created_at,
      updated_at: strategies.updated_at,
      has_strategy_for_now: strategies.strategy_for_now,
      error_message: strategies.error_message
    })
      .from(strategies)
      .where(eq(strategies.user_id, user_id))
      .orderBy(desc(strategies.created_at))
      .limit(50);

    // Map database status to UI status
    const mappedAttempts = attempts.map(a => ({
      snapshot_id: a.snapshot_id,
      status: a.has_strategy_for_now ? 'complete' :
              a.status === 'failed' ? 'failed' :
              a.error_message ? 'write_failed' :
              'pending',
      created_at: a.created_at,
      updated_at: a.updated_at
    }));

    res.json({ ok: true, attempts: mappedAttempts });
  } catch (error) {
    console.error(`[STRATEGY] GET history error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// 2026-09-10 (security finding [3], verified): every per-snapshot route below now proves the
// caller owns the snapshot (central policy, 404 on mismatch/NULL-owned). Before this, any
// driver could read another driver's strategy/briefing, fire paid providers for it (/run),
// or clone their snapshot under THEIR identity (/retry).
/** GET /api/strategy/:snapshotId */
router.get('/:snapshotId', requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[STRATEGY] GET /api/strategy/${snapshotId} - Fetching from DB...`);
    const { strategy: row, briefing: briefingRow } = await readStrategySource(snapshotId);

    if (!row) {
      console.log(`[STRATEGY] Strategy not found for snapshot ${snapshotId}`);
      return res.status(404).json({ error: 'not_found', snapshot_id: snapshotId });
    }
    
    console.log(`[STRATEGY] Strategy found: status=${row.status}, has_strategy_for_now=${!!row.strategy_for_now}`);

    const hasStrategyForNow = !!(row.strategy_for_now && row.strategy_for_now.trim().length);

    // Check briefing from separate briefings table (not from strategies)
    const readiness = getBriefingReadiness(briefingRow, snapshotId);
    const hasBriefing = readiness.ready;
    const snapshotReady = getSnapshotReadiness(req.snapshot, snapshotId).ready;
    const current = snapshotReady && hasStrategyForNow && hasBriefing && strategyMatchesBriefing(row, briefingRow, snapshotId);
    if (['failed', 'error'].includes(row.status) || readiness.failed || !snapshotReady || (hasStrategyForNow && hasBriefing && !current)) {
      return res.json({ status: 'error', snapshot_id: snapshotId, strategyFresh: false,
        error: ['failed', 'error'].includes(row.status) ? 'strategy_failed' : !snapshotReady ? 'snapshot_incomplete' : readiness.failed ? 'briefing_failed' : 'strategy_source_changed',
        message: !snapshotReady ? 'Refresh location to complete the saved location data.' : STRATEGY_SOURCE_RETRY,
        retry: 'new_snapshot', strategy_for_now: '' });
    }

    const waitFor = [];
    if (!hasStrategyForNow) waitFor.push('strategy_for_now');
    if (!hasBriefing) waitFor.push('briefing');

    // 2026-01-14: Lean strategies - use created_at as canonical timestamp (strategy_timestamp dropped)
    const startedAt = row.created_at ?? null;
    const timeElapsedMs = safeElapsedMs(startedAt, Date.now());

    // 2026-07-06: Holiday now lives in briefings.holiday (jsonb section
    // { holiday, is_holiday, detectedAt }, errorMarker on failure)
    res.json({
      status: current ? 'ok' : 'pending',
      strategyFresh: current,
      snapshot_id: snapshotId,
      strategy_for_now: current ? row.strategy_for_now : '',
      briefing: briefingRow ? {
        events: briefingRow.events || [],
        news: briefingRow.news || { items: [] },
        traffic: briefingRow.traffic_conditions || {},
        school_closures: briefingRow.school_closures || []
      } : { events: [], traffic: [], news: [], school_closures: [] },
      waitFor,
      timeElapsedMs
    });
  } catch (error) {
    console.error(`[STRATEGY] GET error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/seed  { snapshot_id } */
router.post('/seed', validateBody(strategyRequestSchema), async (req, res) => {
  const { snapshot_id } = req.body || {};
  
  if (!snapshot_id) {
    return res.status(400).json({ error: 'snapshot_id_required' });
  }

  try {
    // 2026-09-10 (security finding [3]): body-supplied snapshot id — prove ownership before
    // creating a strategy row for it (same policy as the param routes above).
    const owned = await verifySnapshotOwnership(snapshot_id, req.auth?.userId);
    if (!owned.ok) return res.status(owned.status).json(owned.body);
    await assertMainRunForSnapshot(snapshot_id, { auth: req.auth });
    await ensureStrategyRow(snapshot_id);
    res.json({ ok: true, snapshot_id });
  } catch (error) {
    console.error(`[STRATEGY] Seed error:`, error);
    if (error instanceof MainRunAdmissionError) return res.status(error.status).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/run/:snapshotId  (fire-and-forget providers) */
router.post('/run/:snapshotId', requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;

  try {
    await assertMainRunForSnapshot(snapshotId, { auth: req.auth });
    await ensureStrategyRow(snapshotId);

    console.log(`[STRATEGY]  POST /run endpoint deprecated - use POST /api/blocks-fast instead for complete pipeline`);
    
    res.status(202).json({ 
      status: 'deprecated', 
      message: 'Use POST /api/blocks-fast for complete pipeline',
      snapshot_id: snapshotId 
    });
  } catch (error) {
    console.error(`[STRATEGY] Run error:`, error);
    if (error instanceof MainRunAdmissionError) return res.status(error.status).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** GET /api/strategy/briefing/:snapshotId - Fetch briefing data from briefings table */
router.get('/briefing/:snapshotId', requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[STRATEGY] GET /api/strategy/briefing/${snapshotId} - Fetching briefing...`);
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (!briefingRow) {
      console.log(`[STRATEGY] Briefing not found for snapshot ${snapshotId}`);
      return res.status(404).json({ 
        error: 'not_found', 
        snapshot_id: snapshotId,
        message: 'No briefing data available. Create a snapshot to generate briefing data.' 
      });
    }
    
    console.log(`[STRATEGY] Briefing found for ${snapshotId}`);

    // 2026-04-14: Issue U — Added airport_conditions (was missing from response, see Issue K)
    res.json({
      ok: true,
      snapshot_id: snapshotId,
      briefing: {
        news: briefingRow.news || { items: [] },
        weather_current: briefingRow.weather_current || null,
        weather_forecast: briefingRow.weather_forecast || [],
        traffic_conditions: briefingRow.traffic_conditions || null,
        events: briefingRow.events || [],
        school_closures: briefingRow.school_closures || [],
        airport_conditions: briefingRow.airport_conditions || null,
      },
      created_at: briefingRow.created_at,
      updated_at: briefingRow.updated_at
    });
  } catch (error) {
    console.error(`[STRATEGY] GET briefing error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** Legacy retry cannot re-date old GPS and measurements as a new observation. */
router.post('/:snapshotId/retry', requireSnapshotOwnership, async (req, res) => {
  return res.status(409).json({
    ok: false, error: 'fresh_location_required', retry: 'new_snapshot',
    snapshot_id: req.params.snapshotId,
    message: 'Refresh location for a fresh snapshot before retrying Strategy.',
  });
});

export default router;
