// server/jobs/triad-worker.js
// Background worker that claims and processes triad jobs with SKIP LOCKED
// Complete automatic workflow: Strategy → Enhanced Smart Blocks (venue planner)
import { db } from '../db/drizzle.js';
import { triad_jobs, strategies, snapshots } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { callClaude45Raw } from '../lib/adapters/anthropic-sonnet45.js';
import { callGPT5 } from '../lib/adapters/openai-gpt5.js';
import { acquireLock, releaseLock, extendLock } from '../lib/locks.js';

const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS || 9000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 3000);

export async function processTriadJobs() {
  // Single-process guard: prevent duplicate loops
  if (global.__TRIAD_WORKER_STARTED__) {
    console.warn('[triad-worker] ⚠️  Duplicate start suppressed (already running)');
    return;
  }
  global.__TRIAD_WORKER_STARTED__ = true;
  
  // Event-driven mode: LISTEN/NOTIFY instead of hot polling
  const USE_LISTEN = process.env.USE_LISTEN_MODE !== 'false'; // Default to true
  
  if (USE_LISTEN) {
    console.log('[triad-worker] 🎧 LISTEN mode active — hot polling disabled');
    console.log('[triad-worker] 💡 Strategy consolidation runs on PostgreSQL NOTIFY events');
    
    // Optional: Safety sweep every 10 minutes to catch missed events
    const SAFETY_SWEEP_INTERVAL = 10 * 60 * 1000; // 10 minutes
    setInterval(async () => {
      console.log('[triad-worker] 🧹 Running safety sweep for orphaned strategies...');
      // Check for strategies that have all GENERIC fields but no consolidation
      try {
        const orphaned = await db.execute(sql`
          SELECT snapshot_id FROM ${strategies}
          WHERE minstrategy IS NOT NULL
            AND briefing IS NOT NULL
            AND consolidated_strategy IS NULL
          LIMIT 5
        `);
        
        if (orphaned.rows && orphaned.rows.length > 0) {
          console.log(`[triad-worker] 🧹 Found ${orphaned.rows.length} orphaned strategies, triggering consolidation...`);
          for (const row of orphaned.rows) {
            const { maybeConsolidate } = await import('./triad-worker.js');
            await maybeConsolidate(row.snapshot_id);
          }
        }
      } catch (err) {
        console.error('[triad-worker] ❌ Safety sweep error:', err.message);
      }
    }, SAFETY_SWEEP_INTERVAL);
    
    return; // Exit - no hot polling
  }
  
  // ─────────────────────────────────────────────────────────────
  // FALLBACK: Hot polling mode (legacy)
  // ─────────────────────────────────────────────────────────────
  const workerId = process.env.WORKER_ID || `pid:${process.pid}`;
  console.log(`[triad-worker] 🔄 Worker loop started, polling for jobs... (worker_id=${workerId})`);
  console.warn(`[triad-worker] ⚠️  Hot polling mode active (set USE_LISTEN_MODE=false to enable LISTEN)`);
  
  while (true) {
    try {
      // Check queue status with counts
      const pollStart = Date.now();
      const counts = await db.execute(sql`
        SELECT status, COUNT(*) as count 
        FROM ${triad_jobs} 
        GROUP BY status
      `);
      const statusMap = {};
      counts.rows?.forEach(r => { statusMap[r.status] = parseInt(r.count); });
      const queuedCount = statusMap.queued || 0;
      const pollMs = Date.now() - pollStart;
      
      console.log(`[triad-worker] 📊 Poll: queued=${queuedCount}, running=${statusMap.running || 0}, ok=${statusMap.ok || 0}, error=${statusMap.error || 0} (${pollMs}ms)`);
      
      if (queuedCount === 0) {
        // No jobs available, wait before checking again
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased to 3s
        continue;
      }
      
      // Claim one job with SKIP LOCKED (only one worker processes it)
      const job = await db.execute(sql`
        UPDATE ${triad_jobs}
        SET status = 'running'
        WHERE id = (
          SELECT id 
          FROM ${triad_jobs}
          WHERE status = 'queued'
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, snapshot_id, kind
      `);

      if (!job || !job.rows || job.rows.length === 0) {
        // Race condition - another worker claimed it
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const { id: jobId, snapshot_id, kind } = job.rows[0];

      console.log(`[triad-worker] 🔧 CLAIMED job ${jobId} for snapshot ${snapshot_id}`);

      // LOCK: Acquire per-snapshot lock to prevent concurrent processing
      const lockKey = `triad:${snapshot_id}`;
      console.log(`[triad-worker] 🔑 Attempting to acquire lock: ${lockKey}`);
      
      const gotLock = await acquireLock(lockKey, LOCK_TTL_MS);
      
      if (!gotLock) {
        // Lock busy - mark job failed and skip
        console.error(`[triad-worker] ❌ Lock busy for ${snapshot_id}, marking job FAILED`);
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'error', error_message = 'Lock busy - another worker processing this snapshot'
          WHERE id = ${jobId}
        `);
        continue;
      }

      console.log(`[triad-worker] ✅ Lock acquired: ${lockKey}, TTL=${LOCK_TTL_MS}ms`);

      // Heartbeat timer to extend lock during long-running operations
      let heartbeat = setInterval(async () => {
        try {
          await extendLock(lockKey, LOCK_TTL_MS);
          console.log(`[triad-worker] 💓 Lock heartbeat: ${lockKey}`);
        } catch (e) {
          console.error(`[triad-worker] ❌ Lock heartbeat error:`, e?.message || e);
        }
      }, HEARTBEAT_MS);

      try {
        // Check if strategy already exists (race condition guard)
        const [existing] = await db
          .select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snapshot_id))
          .limit(1);

        if (existing && existing.status === 'ok') {
          // Strategy already exists, mark job complete
          console.log(`[triad-worker] ✅ Strategy already exists for ${snapshot_id}, marking job complete`);
          await db.execute(sql`
            UPDATE ${triad_jobs}
            SET status = 'ok'
            WHERE id = ${jobId}
          `);
          await releaseLock(lockKey);
          continue;
        }

        // STEP 1: Fetch snapshot
        const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id)).limit(1);
        if (!snap) {
          throw new Error('Snapshot not found');
        }

        console.log(`[triad-worker] 🚀 Starting NEW provider-based pipeline for ${snapshot_id}`);

        // STEP 2: Run providers in PARALLEL (Claude minstrategy + Gemini briefing)
        console.log(`[triad-worker] 🧠 STEP 1/2: Running minstrategy + briefing providers in parallel...`);
        const { runSimpleStrategyPipeline } = await import('../lib/strategy-generator-parallel.js');
        
        const pipelineResult = await runSimpleStrategyPipeline({
          snapshotId: snapshot_id,
          userId: snap.user_id,
          userAddress: snap.formatted_address,
          city: snap.city,
          state: snap.state,
          lat: snap.lat,
          lng: snap.lng,
          snapshot: snap
        });

        if (!pipelineResult.ok) {
          throw new Error(`Pipeline failed: ${pipelineResult.reason}`);
        }

        console.log(`[triad-worker] ✅ STEP 1/2 Complete: Providers executed successfully`);

        // STEP 2: Fetch strategy row to check consolidation status
        const [strategyRow] = await db.select().from(strategies)
          .where(eq(strategies.snapshot_id, snapshot_id)).limit(1);
        
        if (!strategyRow) {
          throw new Error('Strategy row not found after pipeline execution');
        }
        
        console.log(`[triad-worker] 📊 Strategy status: ${strategyRow.status}`);
        
        // STEP 3: Generate Enhanced Smart Blocks only if consolidation succeeded
        if (strategyRow.status === 'ok' || strategyRow.status === 'ok_partial') {
          console.log(`[triad-worker] 🎯 STEP 2/2: Generating enhanced smart blocks with consolidated strategy...`);
          try {
            const { generateEnhancedSmartBlocks } = await import('../lib/enhanced-smart-blocks.js');
            await generateEnhancedSmartBlocks({
              snapshotId: snapshot_id,
              consolidated: strategyRow.consolidated_strategy,
              briefing: strategyRow.briefing,
              snapshot: {
                ...snap,
                formatted_address: snap.formatted_address,
                city: snap.city,
                state: snap.state,
                lat: snap.lat,
                lng: snap.lng,
                created_at: snap.created_at,
                timezone: snap.timezone,
                dow: snap.dow
              },
              user_id: snap.user_id
            });
            console.log(`[triad-worker] ✅ Enhanced smart blocks generated and saved`);
          } catch (blocksErr) {
            console.error(`[triad-worker] ⚠️ Failed to generate blocks (non-blocking):`, blocksErr.message);
            // Don't fail the entire pipeline if blocks generation fails
          }
        } else {
          console.warn(`[triad-worker] ⚠️ Skipping blocks generation - strategy status is ${strategyRow.status}`);
        }

        // Mark job complete
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'ok'
          WHERE id = ${jobId}
        `);

      } catch (err) {
        console.error(`[triad-worker] ❌ Job ${jobId} failed:`, err.message);
        
        // HARD FAIL on constraint errors - schema mismatch, don't retry
        if (String(err?.message).includes('ON CONFLICT') || 
            String(err?.message).includes('constraint') ||
            String(err?.message).includes('unique') ||
            String(err?.code) === '23505') {
          console.error(`[triad-worker] 🛑 SCHEMA MISMATCH - ON CONFLICT or constraint violation detected`);
          console.error(`[triad-worker] 🛑 Fix: Ensure unique index matches ON CONFLICT target`);
          
          // Mark job as failed with schema error
          await db.execute(sql`
            UPDATE ${triad_jobs}
            SET status = 'error'
            WHERE id = ${jobId}
          `);
          
          await db.execute(sql`
            UPDATE ${strategies}
            SET status = 'failed', error_message = 'schema_mismatch_unique_index_required'
            WHERE snapshot_id = ${snapshot_id}
          `);
          
          await releaseLock(lockKey);
          throw new Error('schema_mismatch_unique_index_required: ' + err.message);
        }
        
        // Mark job as error
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'error'
          WHERE id = ${jobId}
        `);

        // Update strategy status to failed
        await db.execute(sql`
          UPDATE ${strategies}
          SET status = 'failed', error_message = ${err.message}
          WHERE snapshot_id = ${snapshot_id}
        `);
      } finally {
        // Clean up heartbeat and release lock
        try { clearInterval(heartbeat); } catch {}
        await releaseLock(lockKey);
      }
    } catch (err) {
      console.error('[triad-worker] Worker loop error:', err);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// NOTE: Worker is started by strategy-generator.js (separate process)
// Removed auto-start to prevent duplicate worker loops

/**
 * Event-driven consolidation listener
 * Listens for strategy updates and triggers GPT-5 consolidation when all provider fields present
 */
export async function startConsolidationListener() {
  const { getListenClient } = await import('../lib/db-client.js');
  const { consolidateStrategy } = await import('../lib/strategy-generator-parallel.js');

  try {
    const pgClient = await getListenClient();
    
    // Set up notification handler
    pgClient.on('notification', async (msg) => {
      if (msg.channel === 'strategy_ready' && msg.payload) {
        const snapshotId = msg.payload;
        console.log(`[consolidation-listener] 📢 Received notification for snapshot ${snapshotId}`);
        
        try {
          // Fire-and-forget: check if consolidation needed and run if ready
          await maybeConsolidate(snapshotId);
        } catch (err) {
          console.error(`[consolidation-listener] ❌ Error processing notification:`, err.message);
        }
      }
    });

    // Start listening
    await pgClient.query('LISTEN strategy_ready');
    console.log('[consolidation-listener] 🎧 Listening for strategy updates on channel: strategy_ready');
    
  } catch (err) {
    console.error('[consolidation-listener] ❌ Failed to start listener:', err);
    throw err;
  }
}

/**
 * Check if all provider fields present and consolidation needed
 */
export async function maybeConsolidate(snapshotId) {
  try {
    const [row] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!row) {
      console.log(`[consolidation-listener] ⚠️  No strategy row found for ${snapshotId}`);
      return;
    }

    // Gate: all GENERIC provider fields must be present AND consolidated_strategy must be null
    const hasStrategy = row.minstrategy != null;
    const hasBriefing = row.briefing != null && typeof row.briefing === 'object';
    const alreadyConsolidated = row.consolidated_strategy != null;
    
    const ready = hasStrategy && hasBriefing && !alreadyConsolidated;

    // Detailed gate logging for observability
    console.log(`[consolidation-listener] Gate for ${snapshotId}:`, {
      hasStrategy,
      hasBriefing,
      briefingKeys: hasBriefing ? Object.keys(row.briefing) : [],
      alreadyConsolidated,
      ready
    });

    if (!ready) {
      return;
    }

    console.log(`[consolidation-listener] ✅ All generic fields present for ${snapshotId}, triggering consolidation...`);

    const { consolidateStrategy } = await import('../lib/strategy-generator-parallel.js');
    
    const user = {
      lat: row.lat,
      lng: row.lng,
      user_address: row.user_resolved_address || row.user_address || '',
      city: row.user_resolved_city || row.city || '',
      state: row.user_resolved_state || row.state || ''
    };

    const result = await consolidateStrategy({
      snapshotId,
      claudeStrategy: row.minstrategy,
      briefing: row.briefing, // Single JSONB object with {events, holidays, traffic, news}
      user
    });

    if (result.ok) {
      console.log(`[consolidation-listener] ✅ Consolidation complete for ${snapshotId}`);
      
      // Generate Enhanced Smart Blocks after successful consolidation
      console.log(`[consolidation-listener] 🎯 Generating enhanced smart blocks...`);
      try {
        const { generateEnhancedSmartBlocks } = await import('../lib/enhanced-smart-blocks.js');
        
        // Fetch the consolidated strategy from DB
        const [updatedRow] = await db.select().from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
        
        if (updatedRow?.consolidated_strategy) {
          // Fetch snapshot for full context
          const [snap] = await db.select().from(snapshots)
            .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
          
          await generateEnhancedSmartBlocks({
            snapshotId,
            strategy: updatedRow.consolidated_strategy,
            snapshot: {
              ...snap,
              formatted_address: updatedRow.user_address || snap?.formatted_address,
              city: updatedRow.city || snap?.city,
              state: updatedRow.state || snap?.state,
              lat: updatedRow.lat || snap?.lat,
              lng: updatedRow.lng || snap?.lng,
              created_at: snap?.created_at,
              timezone: snap?.timezone,
              dow: snap?.dow
            },
            user_id: updatedRow.user_id || snap?.user_id
          });
          console.log(`[consolidation-listener] ✅ Enhanced smart blocks generated`);
        }
      } catch (blocksErr) {
        console.error(`[consolidation-listener] ⚠️ Failed to generate blocks (non-blocking):`, blocksErr.message);
      }
    } else {
      console.error(`[consolidation-listener] ❌ Consolidation failed for ${snapshotId}:`, result.reason);
    }
  } catch (err) {
    console.error(`[consolidation-listener] ❌ Error in maybeConsolidate:`, err.message);
  }
}
