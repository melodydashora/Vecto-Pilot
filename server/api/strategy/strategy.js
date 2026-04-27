// server/api/strategy/strategy.js
// Model-agnostic strategy API (no blocks coupling)

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { strategies, briefings, snapshots } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';
// 2026-01-14: Import shared snapshot validation to prevent incomplete snapshots
import { validateSnapshotFields } from '../../util/validate-snapshot.js';
import { runBriefing } from '../../lib/ai/providers/briefing.js';
import { safeElapsedMs } from '../utils/safeElapsedMs.js';
import crypto from 'crypto';
import { validateBody } from '../../middleware/validate.js';
import { strategyRequestSchema } from '../../validation/schemas.js';
// 2026-02-12: Added requireAuth - all strategy routes require authentication
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// 2026-02-12: SECURITY FIX - All strategy routes now require authentication
// Previously these were completely open, allowing anyone to fetch/run strategies for any snapshotId
router.use(requireAuth);

// 2026-04-25 (P2-9): /history MUST be declared BEFORE /:snapshotId or Express
// matches the param route first and "history" is treated as a snapshotId.

/** GET /api/strategy/history?user_id=X - Get all strategy attempts for a user */
router.get('/history', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id_required' });
  }

  try {
    console.log(`[STRATEGY] GET /api/strategy/history?user_id=${user_id}`);

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

/** GET /api/strategy/:snapshotId */
router.get('/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[STRATEGY] GET /api/strategy/${snapshotId} - Fetching from DB...`);
    const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!row) {
      console.log(`[STRATEGY] Strategy not found for snapshot ${snapshotId}`);
      return res.status(404).json({ error: 'not_found', snapshot_id: snapshotId });
    }
    
    console.log(`[STRATEGY] Strategy found: status=${row.status}, has_strategy_for_now=${!!row.strategy_for_now}`);

    const hasStrategyForNow = !!(row.strategy_for_now && row.strategy_for_now.trim().length);

    // Check briefing from separate briefings table (not from strategies)
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    const hasBriefing = !!briefingRow;

    const waitFor = [];
    if (!hasStrategyForNow) waitFor.push('strategy_for_now');
    if (!hasBriefing) waitFor.push('briefing');

    // 2026-01-14: Lean strategies - use created_at as canonical timestamp (strategy_timestamp dropped)
    const startedAt = row.created_at ?? null;
    const timeElapsedMs = safeElapsedMs(startedAt, Date.now());

    // 2026-01-14: Removed holidays from briefing fallback (column dropped in 20251209_drop_unused_briefing_columns.sql)
    // Holiday info is now in snapshots table (holiday, is_holiday)
    res.json({
      status: hasStrategyForNow ? 'ok' : 'pending',
      snapshot_id: snapshotId,
      strategy_for_now: hasStrategyForNow ? row.strategy_for_now : '',
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
    await ensureStrategyRow(snapshot_id);
    res.json({ ok: true, snapshot_id });
  } catch (error) {
    console.error(`[STRATEGY] Seed error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** POST /api/strategy/run/:snapshotId  (fire-and-forget providers) */
router.post('/run/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;

  try {
    await ensureStrategyRow(snapshotId);

    console.log(`[STRATEGY]  POST /run endpoint deprecated - use POST /api/blocks-fast instead for complete pipeline`);
    
    res.status(202).json({ 
      status: 'deprecated', 
      message: 'Use POST /api/blocks-fast for complete pipeline',
      snapshot_id: snapshotId 
    });
  } catch (error) {
    console.error(`[STRATEGY] Run error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

/** GET /api/strategy/briefing/:snapshotId - Fetch briefing data from briefings table */
router.get('/briefing/:snapshotId', async (req, res) => {
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

/** POST /api/strategy/:snapshotId/retry - Retry strategy generation with same location context */
router.post('/:snapshotId/retry', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[STRATEGY] POST /api/strategy/${snapshotId}/retry - Retrying strategy generation...`);
    
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
    // NO FALLBACK - timezone is required from original snapshot
    if (!originalSnapshot.timezone) {
      return res.status(400).json({
        ok: false,
        error: 'timezone_required',
        message: 'Original snapshot missing timezone - cannot regenerate strategy'
      });
    }
    const driverTimezone = originalSnapshot.timezone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: driverTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const today = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
    
    // 2026-01-14: Build snapshot record with ALL required fields before validation
    // Previous code was missing local_iso, dow, hour, day_part_key which caused SNAPSHOT_INCOMPLETE errors
    const snapshotRecord = {
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
      // 2026-01-14: FIX - Copy time context fields (were missing, causing validation failures)
      local_iso: originalSnapshot.local_iso,
      dow: originalSnapshot.dow,
      hour: originalSnapshot.hour,
      day_part_key: originalSnapshot.day_part_key,
      // Optional fields
      h3_r8: originalSnapshot.h3_r8,
      weather: originalSnapshot.weather,
      air: originalSnapshot.air,
      // 2026-01-14: airport_context dropped - now in briefings.airport_conditions
      device: originalSnapshot.device,
      permissions: originalSnapshot.permissions,
      holiday: originalSnapshot.holiday,
      is_holiday: originalSnapshot.is_holiday
    };

    // 2026-01-14: Validate ALL required fields BEFORE insert (prevents incomplete snapshots)
    validateSnapshotFields(snapshotRecord);

    await db.insert(snapshots).values(snapshotRecord);

    // Create strategy row for new snapshot
    // 2026-01-14: Lean strategies - trigger_reason column dropped (unused)
    await ensureStrategyRow(newSnapshotId);

    // Retry uses the same blocks-fast pipeline
    console.log(`[STRATEGY] ℹ️  Retry: Use POST /api/blocks-fast with snapshot_id=${newSnapshotId} for complete pipeline`);
    
    console.log(`[STRATEGY] Retry triggered: new snapshot ${newSnapshotId}`);
    
    res.status(202).json({ 
      ok: true,
      new_snapshot_id: newSnapshotId,
      original_snapshot_id: snapshotId,
      status: 'pending'
    });
  } catch (error) {
    console.error(`[STRATEGY] Retry error:`, error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
