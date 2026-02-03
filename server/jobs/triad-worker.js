// server/jobs/triad-worker.js
// LISTEN-only background worker: reacts to Postgres NOTIFY events and generates SmartBlocks.
// Strategy generation now happens synchronously in blocks-fast.js - this worker only handles SmartBlocks.
// Removes hot polling, infinite loops, and adds graceful shutdown.

import { db } from '../db/drizzle.js';
import { strategies, snapshots, briefings } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

// Single-process guard
if (global.__TRIAD_WORKER_STARTED__) {
  console.warn('[triad-worker] ⚠️ Duplicate start suppressed (already running)');
} else {
  global.__TRIAD_WORKER_STARTED__ = true;
}

let pgClient = null;
let shuttingDown = false;

/**
 * Start LISTEN-only SmartBlocks listener.
 * Subscribes to channel `strategy_ready`. When a notification with snapshotId arrives:
 * - Verify strategy_for_now exists (from GPT-5.2)
 * - Verify briefing exists
 * - Generate enhanced smart blocks
 *
 * NOTE: This worker does NOT do consolidation - that's handled synchronously by blocks-fast.js
 */
export async function startConsolidationListener() {
  const { getListenClient } = await import('../db/db-client.js');
  const { generateEnhancedSmartBlocks } = await import('../lib/venue/enhanced-smart-blocks.js');

  try {
    pgClient = await getListenClient();

    // Graceful shutdown
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[consolidation-listener] 🛑 Received ${signal}, closing listener...`);
      try {
        if (pgClient) {
          pgClient.removeAllListeners('notification');
          try { await pgClient.query('UNLISTEN strategy_ready'); } catch {}
          try { await pgClient.end(); } catch {}
        }
      } catch (e) {
        console.error('[consolidation-listener] ❌ Error during shutdown:', e?.message || e);
      } finally {
        console.log('[consolidation-listener] ✅ Listener closed cleanly');
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Notification handler
    pgClient.on('notification', async (msg) => {
      if (msg.channel !== 'strategy_ready' || !msg.payload) return;

      // Parse JSON payload from trigger
      let snapshotId;
      try {
        const payload = JSON.parse(msg.payload);
        snapshotId = payload.snapshot_id;
      } catch (e) {
        // Fallback to raw string if not JSON
        snapshotId = msg.payload;
      }

      console.log(`[consolidation-listener] 📢 Notification: strategy_ready -> ${snapshotId}`);

      try {
        // Fetch strategy row
        const [row] = await db.select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId))
          .limit(1);

        if (!row) {
          console.warn(`[consolidation-listener] ⚠️ No strategy row for ${snapshotId}`);
          return;
        }

        // Fetch briefing from separate table
        const [briefingRow] = await db.select()
          .from(briefings)
          .where(eq(briefings.snapshot_id, snapshotId))
          .limit(1);

        // Check if data is ready - need strategy_for_now (not minstrategy)
        const hasStrategyForNow = row.strategy_for_now != null && row.strategy_for_now.length > 0;
        const hasBriefing = briefingRow != null;

        console.log(`[consolidation-listener] Status for ${snapshotId}:`, {
          hasStrategyForNow,
          hasBriefing,
          status: row.status
        });

        // Early exit if data isn't ready
        if (!hasStrategyForNow || !hasBriefing) {
          console.log(`[consolidation-listener] ⏭️ Skipping ${snapshotId} - missing strategy_for_now or briefing`);
          return;
        }

        // Fetch snapshot for context
        const [snap] = await db.select()
          .from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId))
          .limit(1);

        if (!snap) {
          console.warn(`[consolidation-listener] ⚠️ No snapshot for ${snapshotId}`);
          return;
        }

        // Generate enhanced smart blocks using IMMEDIATE strategy for "where to go NOW"
        try {
          console.log(`[consolidation-listener] 🎯 Generating enhanced smart blocks for ${snapshotId}...`);
          console.log(`[consolidation-listener] Using strategy_for_now: "${row.strategy_for_now?.slice(0, 80)}..."`);
          await generateEnhancedSmartBlocks({
            snapshotId,
            immediateStrategy: row.strategy_for_now,
            briefing: briefingRow || { events: [], traffic_conditions: {}, news: {} },
            snapshot: snap,
            user_id: row.user_id || snap?.user_id
          });
          console.log(`[consolidation-listener] ✅ Enhanced smart blocks generated for ${snapshotId}`);

          // CRITICAL: Notify SSE listeners that blocks are ready
          try {
            const payload = JSON.stringify({
              snapshot_id: snapshotId,
              ranking_id: null,
              timestamp: new Date().toISOString()
            });
            await pgClient.query(`NOTIFY blocks_ready, '${payload}'`);
            console.log(`[consolidation-listener] 📢 NOTIFY blocks_ready sent for ${snapshotId}`);
          } catch (notifyErr) {
            console.error(`[consolidation-listener] ⚠️ Failed to send NOTIFY:`, notifyErr.message);
          }
        } catch (blocksErr) {
          console.error(`[consolidation-listener] ⚠️ Blocks generation failed (non-blocking):`, blocksErr.message);
        }
      } catch (err) {
        console.error(`[consolidation-listener] ❌ Error handling notification for ${snapshotId}:`, err?.message || err);
      }
    });

    // Start listening
    await pgClient.query('LISTEN strategy_ready');
    console.log('[consolidation-listener] 🎧 Listening on channel: strategy_ready');
  } catch (err) {
    console.error('[consolidation-listener] ❌ Failed to start listener:', err?.message || err);
    throw err;
  }
}

/**
 * Deprecated: processTriadJobs() hot polling function.
 * Kept as a no-op to avoid accidental starts from legacy imports.
 */
export async function processTriadJobs() {
  console.warn('[triad-worker] ⛔ Hot polling is disabled. Use startConsolidationListener() instead.');
}

