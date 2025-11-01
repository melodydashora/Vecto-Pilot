// server/jobs/triad-worker.js
// LISTEN-only background worker: reacts to Postgres NOTIFY events and triggers consolidation.
// Removes hot polling, infinite loops, and adds graceful shutdown.

import { db } from '../db/drizzle.js';
import { strategies, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

// Optional: environment flags (kept for consistency, not used for polling anymore)
const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS || 9000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 3000);

// Single-process guard
if (global.__TRIAD_WORKER_STARTED__) {
  console.warn('[triad-worker] ⚠️ Duplicate start suppressed (already running)');
} else {
  global.__TRIAD_WORKER_STARTED__ = true;
}

let pgClient = null;
let shuttingDown = false;

/**
 * Start LISTEN-only consolidation listener.
 * Subscribes to channel `strategy_ready`. When a notification with snapshotId arrives:
 * - Verify all provider fields present (minstrategy + briefing)
 * - Trigger consolidation
 * - Generate enhanced smart blocks on success
 */
export async function startConsolidationListener() {
  const { getListenClient } = await import('../lib/db-client.js');
  const { consolidateStrategy } = await import('../lib/strategy-generator-parallel.js');
  const { generateEnhancedSmartBlocks } = await import('../lib/enhanced-smart-blocks.js');
  const { hasRenderableBriefing } = await import('../lib/strategy-utils.js');

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
      const snapshotId = msg.payload;
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

        // Gate: all GENERIC provider fields present AND not already consolidated
        const hasStrategy = row.minstrategy != null && row.minstrategy.length > 0;
        const hasBriefing = hasRenderableBriefing(row.briefing);
        const alreadyConsolidated = row.consolidated_strategy != null;
        const ready = hasStrategy && hasBriefing && !alreadyConsolidated;

        console.log(`[consolidation-listener] Gate for ${snapshotId}:`, {
          hasStrategy,
          hasBriefing,
          briefingData: hasBriefing ? {
            events: row.briefing?.events?.length || 0,
            holidays: row.briefing?.holidays?.length || 0,
            traffic: row.briefing?.traffic?.length || 0,
            news: row.briefing?.news?.length || 0
          } : null,
          alreadyConsolidated,
          ready
        });

        if (!ready) return;

        // Consolidate
        const result = await consolidateStrategy({
          snapshotId,
          claudeStrategy: row.minstrategy,
          briefing: row.briefing,
          user: {
            lat: row.lat,
            lng: row.lng,
            user_address: row.user_resolved_address || row.user_address || '',
            city: row.user_resolved_city || row.city || '',
            state: row.user_resolved_state || row.state || ''
          }
        });

        if (!result.ok) {
          console.error(`[consolidation-listener] ❌ Consolidation failed for ${snapshotId}:`, result.reason);
          return;
        }

        console.log(`[consolidation-listener] ✅ Consolidation complete for ${snapshotId}`);

        // Fetch updated strategy and snapshot
        const [updatedRow] = await db.select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId))
          .limit(1);

        if (!updatedRow?.consolidated_strategy) {
          console.warn(`[consolidation-listener] ⚠️ No consolidated_strategy present after consolidation for ${snapshotId}`);
          return;
        }

        const [snap] = await db.select()
          .from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId))
          .limit(1);

        // Generate enhanced smart blocks
        try {
          console.log(`[consolidation-listener] 🎯 Generating enhanced smart blocks for ${snapshotId}...`);
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
          console.log(`[consolidation-listener] ✅ Enhanced smart blocks generated for ${snapshotId}`);
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

