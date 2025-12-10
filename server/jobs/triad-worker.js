// server/jobs/triad-worker.js
// LISTEN-only background worker: reacts to Postgres NOTIFY events and triggers consolidation.
// Removes hot polling, infinite loops, and adds graceful shutdown.

import { db } from '../db/drizzle.js';
import { strategies, snapshots, briefings } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { refreshEventsInBriefing } from '../lib/briefing/briefing-service.js';

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
  const { getListenClient } = await import('../db/db-client.js');
  const { consolidateStrategy } = await import('../lib/strategy/strategy-generator-parallel.js');
  const { generateEnhancedSmartBlocks } = await import('../lib/venue/enhanced-smart-blocks.js');
  const { hasRenderableBriefing } = await import('../lib/strategy/strategy-utils.js');

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

        // Check if data is ready
        const hasStrategy = row.minstrategy != null && row.minstrategy.length > 0;
        const hasBriefing = briefingRow != null;
        const alreadyConsolidated = row.consolidated_strategy != null;
        const needsConsolidation = hasStrategy && hasBriefing && !alreadyConsolidated;

        console.log(`[consolidation-listener] Status for ${snapshotId}:`, {
          hasStrategy,
          hasBriefing,
          alreadyConsolidated,
          needsConsolidation
        });

        // Early exit if basic data isn't ready
        if (!hasStrategy || !hasBriefing) {
          console.log(`[consolidation-listener] ⏭️ Skipping ${snapshotId} - missing strategy or briefing`);
          return;
        }

        // Run consolidation if needed
        if (needsConsolidation) {
          console.log(`[consolidation-listener] 🔄 Running consolidation for ${snapshotId}...`);

          // Build briefing object from briefing table row
          let briefingData = briefingRow ? {
            events: briefingRow.events || [],
            news: briefingRow.news || { items: [] },
            traffic_conditions: briefingRow.traffic_conditions || null,
            weather_current: briefingRow.weather_current || null,
            school_closures: briefingRow.school_closures || []
          } : {};

          // Check if events are empty/missing - fetch fresh events if so
          const eventsEmpty = !briefingData.events ||
            (Array.isArray(briefingData.events) && briefingData.events.length === 0) ||
            (briefingData.events?.items && briefingData.events.items.length === 0);

          if (eventsEmpty && briefingRow) {
            console.log(`[consolidation-listener] 📅 Events empty - fetching fresh events for ${snapshotId}...`);
            try {
              // Fetch snapshot for refreshEventsInBriefing
              const [snapshotForEvents] = await db.select()
                .from(snapshots)
                .where(eq(snapshots.snapshot_id, snapshotId))
                .limit(1);

              if (snapshotForEvents) {
                const refreshedBriefing = await refreshEventsInBriefing(
                  { ...briefingRow, snapshot_id: snapshotId },
                  snapshotForEvents
                );
                briefingData.events = refreshedBriefing.events || [];
                console.log(`[consolidation-listener] ✅ Fresh events fetched: ${Array.isArray(briefingData.events) ? briefingData.events.length : 0} events`);
              }
            } catch (eventsErr) {
              console.warn(`[consolidation-listener] ⚠️ Could not refresh events: ${eventsErr.message}`);
            }
          }

          const result = await consolidateStrategy({
            snapshotId,
            claudeStrategy: row.minstrategy,
            briefing: briefingData,
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
        } else {
          console.log(`[consolidation-listener] ⏭️ Consolidation already done for ${snapshotId}, proceeding to Smart Blocks`);
        }

        // Fetch current strategy state (whether just consolidated or already done)
        const [updatedRow] = await db.select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snapshotId))
          .limit(1);

        // Smart Blocks need the IMMEDIATE strategy (strategy_for_now), not daily consolidated
        if (!updatedRow?.strategy_for_now) {
          console.warn(`[consolidation-listener] ⚠️ No strategy_for_now present for ${snapshotId}`);
          return;
        }

        const [snap] = await db.select()
          .from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId))
          .limit(1);

        // Fetch updated briefing from table
        const [updatedBriefing] = await db.select()
          .from(briefings)
          .where(eq(briefings.snapshot_id, snapshotId))
          .limit(1);

        // Generate enhanced smart blocks using IMMEDIATE strategy for "where to go NOW"
        try {
          console.log(`[consolidation-listener] 🎯 Generating enhanced smart blocks for ${snapshotId}...`);
          console.log(`[consolidation-listener] Using strategy_for_now: "${updatedRow.strategy_for_now?.slice(0, 80)}..."`);
          await generateEnhancedSmartBlocks({
            snapshotId,
            immediateStrategy: updatedRow.strategy_for_now, // NOW uses immediate strategy
            briefing: updatedBriefing || { events: [], holidays: [], traffic: [], news: [] },
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
          
          // CRITICAL: Notify SSE listeners that blocks are ready
          try {
            // Send JSON payload consistent with database trigger format
            const payload = JSON.stringify({ 
              snapshot_id: snapshotId,
              ranking_id: null, // Optional - set by trigger when rankings are created
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

