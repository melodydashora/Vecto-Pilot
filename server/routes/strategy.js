// server/routes/strategy.js
// Model-agnostic strategy API (no blocks coupling)

import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { strategies, briefings, snapshots } from '../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { ensureStrategyRow } from '../lib/strategy-utils.js';
import { runMinStrategy } from '../lib/providers/minstrategy.js';
import { runBriefing } from '../lib/providers/briefing.js';
import { runHolidayCheck } from '../lib/providers/holiday-checker.js';
import { safeElapsedMs } from './utils/safeElapsedMs.js';
import crypto from 'crypto';
import { validateBody } from '../middleware/validate.js';
import { strategyRequestSchema } from '../validation/schemas.js';

const router = Router();

/** GET /api/strategy/:snapshotId */
router.get('/:snapshotId', async (req, res) => {
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
router.post('/seed', validateBody(strategyRequestSchema), async (req, res) => {
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
router.post('/run/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    await ensureStrategyRow(snapshotId);

    // Kick providers in parallel; consolidation will be triggered by NOTIFY
    // IMPORTANT: Holiday check runs FIRST to show banner immediately
    Promise.allSettled([
      runHolidayCheck(snapshotId),    // FAST: writes strategies.holiday (1-2s)
      runMinStrategy(snapshotId),     // writes strategies.minstrategy
      runBriefing(snapshotId)         // writes briefings table (Perplexity comprehensive research)
    ]).catch(() => { /* handled in provider logs */ });

    res.status(202).json({ 
      status: 'pending', 
      snapshot_id: snapshotId, 
      kicked: ['holiday', 'minstrategy', 'briefing'] 
    });
  } catch (error) {
    console.error(`[strategy] Run error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** GET /api/strategy/briefing/:snapshotId - Fetch briefing data from briefings table */
router.get('/briefing/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[strategy] GET /api/strategy/briefing/${snapshotId} - Fetching briefing...`);
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (!briefingRow) {
      console.log(`[strategy] ❌ Briefing not found for snapshot ${snapshotId}`);
      return res.status(404).json({ 
        error: 'not_found', 
        snapshot_id: snapshotId,
        message: 'No briefing data available. Create a snapshot to generate briefing data.' 
      });
    }
    
    console.log(`[strategy] ✅ Briefing found for ${snapshotId}`);

    res.json({
      ok: true,
      snapshot_id: snapshotId,
      briefing: {
        // Perplexity comprehensive research
        global_travel: briefingRow.global_travel || '',
        domestic_travel: briefingRow.domestic_travel || '',
        local_traffic: briefingRow.local_traffic || '',
        weather_impacts: briefingRow.weather_impacts || '',
        events_nearby: briefingRow.events_nearby || '',
        holidays: briefingRow.holidays || '',
        rideshare_intel: briefingRow.rideshare_intel || '',
        citations: briefingRow.citations || [],
        // GPT-5 tactical 30-minute intelligence
        tactical_traffic: briefingRow.tactical_traffic || '',
        tactical_closures: briefingRow.tactical_closures || '',
        tactical_enforcement: briefingRow.tactical_enforcement || '',
        tactical_sources: briefingRow.tactical_sources || ''
      },
      created_at: briefingRow.created_at,
      updated_at: briefingRow.updated_at
    });
  } catch (error) {
    console.error(`[strategy] GET briefing error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/:snapshotId/retry - Retry strategy generation with same location context */
router.post('/:snapshotId/retry', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[strategy] POST /api/strategy/${snapshotId}/retry - Retrying strategy generation...`);
    
    // Fetch the original snapshot and strategy
    const [originalSnapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (!originalSnapshot) {
      return res.status(404).json({ error: 'original_snapshot_not_found', snapshot_id: snapshotId });
    }
    
    // Create new snapshot with same location context but new timestamp
    // Location data references user_id; only API-enriched fields are stored
    const newSnapshotId = crypto.randomUUID();
    const now = new Date();
    
    await db.insert(snapshots).values({
      snapshot_id: newSnapshotId,
      created_at: now,
      user_id: originalSnapshot.user_id,
      device_id: originalSnapshot.device_id,
      session_id: originalSnapshot.session_id,
      lat: originalSnapshot.lat,
      lng: originalSnapshot.lng,
      city: originalSnapshot.city,
      state: originalSnapshot.state,
      country: originalSnapshot.country,
      formatted_address: originalSnapshot.formatted_address,
      timezone: originalSnapshot.timezone,
      h3_r8: originalSnapshot.h3_r8,
      weather: originalSnapshot.weather,
      air: originalSnapshot.air,
      airport_context: originalSnapshot.airport_context,
      local_news: originalSnapshot.local_news,
      news_briefing: originalSnapshot.news_briefing,
      device: originalSnapshot.device,
      permissions: originalSnapshot.permissions,
      extras: originalSnapshot.extras,
      trigger_reason: 'retry',
      holiday: originalSnapshot.holiday,
      is_holiday: originalSnapshot.is_holiday
    });
    
    // Create strategy row and trigger generation
    await ensureStrategyRow(newSnapshotId);
    
    // Kick providers in parallel
    Promise.allSettled([
      runHolidayCheck(newSnapshotId),
      runMinStrategy(newSnapshotId),
      runBriefing(newSnapshotId)
    ]).catch(() => {});
    
    console.log(`[strategy] ✅ Retry triggered: new snapshot ${newSnapshotId}`);
    
    res.status(202).json({ 
      ok: true,
      new_snapshot_id: newSnapshotId,
      original_snapshot_id: snapshotId,
      status: 'pending'
    });
  } catch (error) {
    console.error(`[strategy] Retry error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** GET /api/strategy/history?user_id=X - Get all strategy attempts for a user */
router.get('/history', async (req, res) => {
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id_required' });
  }
  
  try {
    console.log(`[strategy] GET /api/strategy/history?user_id=${user_id}`);
    
    const attempts = await db.select({
      snapshot_id: strategies.snapshot_id,
      status: strategies.status,
      created_at: strategies.created_at,
      updated_at: strategies.updated_at,
      has_consolidated: strategies.consolidated_strategy,
      has_minstrategy: strategies.minstrategy,
      error_message: strategies.error_message
    })
      .from(strategies)
      .where(eq(strategies.user_id, user_id))
      .orderBy(desc(strategies.created_at))
      .limit(50);
    
    // Map database status to UI status
    const mappedAttempts = attempts.map(a => ({
      snapshot_id: a.snapshot_id,
      status: a.has_consolidated ? 'complete' : 
              a.status === 'failed' ? 'failed' : 
              a.error_message ? 'write_failed' : 
              'pending',
      created_at: a.created_at,
      updated_at: a.updated_at
    }));
    
    res.json({ ok: true, attempts: mappedAttempts });
  } catch (error) {
    console.error(`[strategy] GET history error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
