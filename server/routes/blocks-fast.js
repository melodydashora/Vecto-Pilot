// server/routes/blocks-fast.js
// Fast Tactical Path: Sub-7s performance optimization
// GPT-5 Venue Generation + Google Places enrichment
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates, strategies, venue_events } from '../../shared/schema.js';
import { eq, sql, and, lte, gte, or, isNotNull } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { rerankCandidates } from '../lib/fast-tactical-reranker.js';
import { persistRankingTx } from '../lib/persist-ranking.js';
import { generateVenueCoordinates } from '../lib/gpt5-venue-generator.js';
import { isStrategyReady } from '../lib/strategy-utils.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { blocksRequestSchema, snapshotIdQuerySchema } from '../validation/schemas.js';

const router = Router();

// Helper to safely calculate elapsed time and prevent NaN in responses
function safeElapsedMs(row) {
  const t0 = row?.created_at ? new Date(row.created_at).getTime() : Date.now();
  const ms = Date.now() - t0;
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

// Environment configuration
const PLANNER_BUDGET_MS = parseInt(process.env.PLANNER_BUDGET_MS || '7000'); // 7 second wall clock
const PLANNER_TIMEOUT_MS = parseInt(process.env.PLANNER_TIMEOUT_MS || '5000'); // 5 second planner timeout

// GET endpoint - return existing blocks for a snapshot
// STRATEGY-FIRST GATING: Returns 202 until strategy is ready
router.get('/', async (req, res) => {
  const snapshotId = req.query.snapshotId || req.query.snapshot_id;
  
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshot_required' });
  }

  try {
    // GATE 1: Strategy must be ready before blocks
    const { ready, strategy, status } = await isStrategyReady(snapshotId);
    
    if (!ready) {
      return res.status(202).json({ 
        ok: false, 
        reason: 'strategy_pending',
        status: status || 'pending',
        message: 'Waiting for consolidated strategy to complete'
      });
    }
    
    // Fetch strategy row (model-agnostic columns)
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    const briefing = strategyRow ? {
      minstrategy: strategyRow.minstrategy || null,
      consolidated_strategy: strategyRow.consolidated_strategy || null
    } : null;
    
    // GATE 2: Find ranking for this snapshot
    const [ranking] = await db.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
    
    if (!ranking) {
      return res.status(404).json({ error: 'NOT_FOUND', blocks: [] });
    }

    // Get candidates for this ranking
    const candidates = await db.select().from(ranking_candidates)
      .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
      .orderBy(ranking_candidates.rank);
    
    // 15-minute perimeter enforcement (show all if drive time not calculated yet)
    const within15Min = (driveMin) => {
      // If drive time not calculated yet, include the venue (will show "calculating...")
      if (!Number.isFinite(driveMin)) return true;
      return driveMin <= 15;
    };
    
    const allBlocks = candidates.map(c => ({
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
      isOpen: c.business_hours?.isOpen,
      eventBadge: c.venue_events?.badge,
      eventSummary: c.venue_events?.summary,
    }));
    
    // Filter to 15-minute perimeter
    const blocks = allBlocks.filter(b => within15Min(b.driveTimeMinutes));
    const rejected = allBlocks.filter(b => !within15Min(b.driveTimeMinutes)).length;
    
    const audit = [
      { step: 'gating', strategy_ready: true },
      { step: 'perimeter', accepted: blocks.length, rejected, max_minutes: 15 }
    ];

    return res.json({ blocks, ranking_id: ranking.ranking_id, briefing, audit });
  } catch (error) {
    console.error('[blocks-fast GET] Error:', error);
    return res.status(500).json({ error: 'internal_error', blocks: [] });
  }
});

router.post('/', validateBody(blocksRequestSchema), async (req, res) => {
  const wallClockStart = Date.now();
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  
  // Audit trail for deployment verification
  const audit = [];
  const logAudit = (step, data) => {
    const entry = { step, ...data, ts: Date.now() - wallClockStart };
    audit.push(entry);
    console.log(`[audit:${correlationId}] ${step}:`, JSON.stringify(data));
  };
  
  let responded = false;
  const sendOnce = (code, body) => {
    if (!responded) {
      responded = true;
      res.status(code).json({ ...body, audit });
    }
  };

  try {
    const { userId = 'demo' } = req.body;
    const snapshotId = req.body?.snapshot_id || req.body?.snapshotId || req.header('x-snapshot-id') || req.query?.snapshot_id;

    if (!snapshotId) {
      return sendOnce(400, { error: 'snapshot_required', message: 'snapshot_id is required' });
    }

    // CRITICAL: Create triad_job AND run synchronous waterfall (autoscale compatible)
    const { triad_jobs, briefings } = await import('../../shared/schema.js');
    try {
      const [job] = await db.insert(triad_jobs).values({
        snapshot_id: snapshotId,
        kind: 'triad',
        status: 'queued'
      }).onConflictDoNothing().returning();
      
      if (job) {
        // New job created - run full pipeline synchronously (no worker needed)
        console.log(`[blocks-fast POST] 🚀 Running synchronous waterfall for ${snapshotId}`);
        const { runMinStrategy } = await import('../lib/providers/minstrategy.js');
        const { runBriefing } = await import('../lib/providers/briefing.js');
        const { runHolidayCheck } = await import('../lib/providers/holiday-checker.js');
        const { consolidateStrategy } = await import('../lib/strategy-generator-parallel.js');
        const { generateEnhancedSmartBlocks } = await import('../lib/enhanced-smart-blocks.js');
        const { ensureStrategyRow } = await import('../lib/strategy-utils.js');
        
        // Ensure strategy row exists
        await ensureStrategyRow(snapshotId);
        
        // STEP 1: Run providers in parallel (10-15s)
        console.log(`[blocks-fast POST] 📡 Step 1/4: Providers...`);
        await Promise.all([
          runHolidayCheck(snapshotId),
          runMinStrategy(snapshotId),
          runBriefing(snapshotId)
        ]);
        
        // STEP 2: Fetch provider outputs
        console.log(`[blocks-fast POST] 📚 Step 2/4: Fetching outputs...`);
        const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
        const [strategy] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        const [briefing] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
        
        if (snapshot && strategy?.minstrategy && briefing) {
          // STEP 3: Run consolidation (15-20s)
          console.log(`[blocks-fast POST] 🔄 Step 3/4: Consolidation...`);
          await consolidateStrategy({
            snapshotId,
            claudeStrategy: strategy.minstrategy,
            briefing: briefing,
            user: null,
            snapshot: snapshot,
            holiday: strategy.holiday
          });
          
          // STEP 4: Generate smart blocks (10-15s)
          console.log(`[blocks-fast POST] 🎯 Step 4/4: Generating blocks...`);
          const [consolidated] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
          
          if (consolidated?.consolidated_strategy) {
            await generateEnhancedSmartBlocks({
              snapshotId,
              consolidated: consolidated.consolidated_strategy,
              briefing: briefing,
              snapshot: snapshot,
              user_id: null
            });
            console.log(`[blocks-fast POST] ✅ Synchronous waterfall complete`);
            
            // Return success immediately after waterfall completes
            return sendOnce(200, {
              status: 'ok',
              snapshot_id: snapshotId,
              blocks: [],
              message: 'Smart blocks generated successfully'
            });
          } else {
            console.error(`[blocks-fast POST] ❌ Consolidation failed - no consolidated_strategy`);
            return sendOnce(500, {
              error: 'consolidation_failed',
              message: 'Strategy consolidation did not produce output'
            });
          }
        } else {
          console.error(`[blocks-fast POST] ❌ Providers failed - missing required data`);
          return sendOnce(500, {
            error: 'providers_failed',
            message: 'One or more AI providers did not complete successfully'
          });
        }
      } else {
        // Job already exists - check if blocks are ready
        console.log(`[blocks-fast POST] Job already queued for ${snapshotId}, checking for existing blocks...`);
        
        const [existing] = await db.select().from(ranking_candidates)
          .where(eq(ranking_candidates.snapshot_id, snapshotId))
          .limit(1);
        
        if (existing) {
          return sendOnce(200, {
            status: 'ok',
            snapshot_id: snapshotId,
            blocks: [],
            message: 'Smart Blocks ready - use GET /api/blocks-fast to retrieve'
          });
        } else {
          return sendOnce(202, {
            status: 'pending',
            snapshot_id: snapshotId,
            blocks: [],
            message: 'Smart Blocks generating - they will appear automatically when ready'
          });
        }
      }
    } catch (jobErr) {
      console.error(`[blocks-fast POST] Waterfall error:`, jobErr.message);
      return sendOnce(500, {
        error: 'waterfall_failed',
        message: jobErr.message,
        details: process.env.NODE_ENV === 'development' ? jobErr.stack : undefined
      });
    }
  } catch (error) {
    console.error('[blocks-fast POST] Unexpected error:', error);
    return sendOnce(500, { error: 'internal_error' });
  }
});

export default router;
