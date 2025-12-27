// server/api/strategy/strategy.js
// Model-agnostic strategy API (no blocks coupling)

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { strategies, briefings, snapshots } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { runConsolidator } from '../../lib/ai/providers/consolidator.js';
import { safeElapsedMs } from '../utils/safeElapsedMs.js';
import crypto from 'crypto';
import { validateBody } from '../../middleware/validate.js';
import { strategyRequestSchema } from '../../validation/schemas.js';

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
    
    console.log(`[strategy] ✅ Strategy found: status=${row.status}, has_strategy_for_now=${!!row.strategy_for_now}`);

    const hasStrategyForNow = !!(row.strategy_for_now && row.strategy_for_now.trim().length);
    const hasConsolidated = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

    // Check briefing from separate briefings table (not from strategies)
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    const hasBriefing = !!briefingRow;

    const waitFor = [];
    if (!hasStrategyForNow) waitFor.push('strategy_for_now');
    if (!hasBriefing) waitFor.push('briefing');

    const startedAt = row.strategy_timestamp ?? row.created_at ?? null;
    const timeElapsedMs = safeElapsedMs(startedAt, Date.now());

    res.json({
      status: hasStrategyForNow ? 'ok' : 'pending',
      snapshot_id: snapshotId,
      strategy_for_now: hasStrategyForNow ? row.strategy_for_now : '',
      briefing: briefingRow ? {
        events: briefingRow.events || [],
        news: briefingRow.news || { items: [] },
        traffic: briefingRow.traffic_conditions || {},
        school_closures: briefingRow.school_closures || []
      } : { events: [], holidays: [], traffic: [], news: [] },
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

    console.log(`[strategy] ⚠️  POST /run endpoint deprecated - use POST /api/blocks-fast instead for complete pipeline`);
    
    res.status(202).json({ 
      status: 'deprecated', 
      message: 'Use POST /api/blocks-fast for complete pipeline',
      snapshot_id: snapshotId 
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
        news: briefingRow.news || { items: [] },
        weather_current: briefingRow.weather_current || null,
        weather_forecast: briefingRow.weather_forecast || [],
        traffic_conditions: briefingRow.traffic_conditions || null,
        events: briefingRow.events || [],
        school_closures: briefingRow.school_closures || []
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
    
    // Calculate "today" in the driver's local timezone (not server timezone)
    // This ensures Hawaii, Alaska, etc. get the correct date
    const driverTimezone = originalSnapshot.timezone || 'America/Chicago';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: driverTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const today = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
    
    await db.insert(snapshots).values({
      snapshot_id: newSnapshotId,
      created_at: now,
      date: today,
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
      device: originalSnapshot.device,
      permissions: originalSnapshot.permissions,
      holiday: originalSnapshot.holiday,
      is_holiday: originalSnapshot.is_holiday
    });

    // Create strategy row and set trigger_reason on strategies table (not snapshots)
    await ensureStrategyRow(newSnapshotId);
    await db.update(strategies)
      .set({ trigger_reason: 'retry' })
      .where(eq(strategies.snapshot_id, newSnapshotId));

    // Retry uses the same blocks-fast pipeline
    console.log(`[strategy] ℹ️  Retry: Use POST /api/blocks-fast with snapshot_id=${newSnapshotId} for complete pipeline`);
    
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

/**
 * POST /api/strategy/daily/:snapshotId
 * On-demand daily strategy generation (8-12 hour planning)
 *
 * Called when user clicks "Generate Daily Strategy" button in BriefingTab.
 * Uses: snapshot + briefing → Gemini 3 Pro → consolidated_strategy
 *
 * Prerequisites:
 *   - snapshot must exist (location/time context)
 *   - briefing must exist (from blocks-fast pipeline)
 *
 * Returns:
 *   - 200: { ok: true, consolidated_strategy: "..." }
 *   - 202: { ok: false, reason: "already_generating" } if in progress
 *   - 400: { error: "missing_prerequisites" } if briefing missing
 */
router.post('/daily/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    console.log(`[strategy] POST /api/strategy/daily/${snapshotId} - Generating daily strategy on-demand...`);

    // Check if strategy row exists
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!strategyRow) {
      return res.status(404).json({
        error: 'snapshot_not_found',
        message: 'No strategy row found. Run /api/blocks-fast first.'
      });
    }

    // Check if already has daily strategy
    if (strategyRow.consolidated_strategy && strategyRow.consolidated_strategy.trim().length > 0) {
      console.log(`[strategy] ✅ Daily strategy already exists for ${snapshotId}`);
      return res.json({
        ok: true,
        cached: true,
        consolidated_strategy: strategyRow.consolidated_strategy
      });
    }

    // Check prerequisites - need briefing data for daily strategy
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (!briefingRow) {
      return res.status(400).json({
        error: 'missing_prerequisites',
        message: 'Briefing data not available. Strategy pipeline may still be running.'
      });
    }

    // Fetch snapshot for consolidator
    const [snapshot] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (!snapshot) {
      return res.status(404).json({
        error: 'snapshot_not_found',
        message: 'Snapshot not found.'
      });
    }

    // Generate daily strategy using Gemini with snapshot + briefing
    console.log(`[strategy] 🔄 Calling runConsolidator for daily strategy...`);
    const result = await runConsolidator(snapshotId, { snapshot });

    if (!result.ok) {
      return res.status(500).json({
        error: 'generation_failed',
        message: result.error || 'Failed to generate daily strategy'
      });
    }

    // Fetch the updated strategy
    const [updatedRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    console.log(`[strategy] ✅ Daily strategy generated: ${updatedRow?.consolidated_strategy?.length || 0} chars`);

    res.json({
      ok: true,
      cached: false,
      consolidated_strategy: updatedRow?.consolidated_strategy || '',
      metrics: result.metrics
    });
  } catch (error) {
    console.error(`[strategy] POST /daily error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
