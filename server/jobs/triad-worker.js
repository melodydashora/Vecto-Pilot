// LISTEN-only SmartBlocks worker. The synchronous waterfall and notifications
// share ensureSmartBlocksExist's database claim; reconnects use db-client's
// shared dispatcher. Completion notification belongs to updatePhase's commit.
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { subscribeToChannel } from '../db/db-client.js';
import { assertMainRunForSnapshot } from '../lib/main-run-admission.js';
import { assertCurrentStrategySource } from '../lib/strategy/strategy-source-store.js';

let startPromise = null;
let unsubscribe = null;
let shuttingDown = false;
const activeSnapshots = new Set();

// Coalesce initialization itself; setting a flag at module import never stopped
// concurrent/repeated calls from registering extra callbacks and signal handlers.
export function startConsolidationListener() {
  if (shuttingDown) return Promise.resolve();
  if (startPromise) return startPromise;
  startPromise = startListener().catch(error => { startPromise = null; throw error; });
  return startPromise;
}

async function startListener() {
  const { ensureSmartBlocksExist } = await import('../api/strategy/blocks-fast.js');
  try {
    unsubscribe = await subscribeToChannel('strategy_ready', async rawPayload => {
      if (shuttingDown || !rawPayload) return;
      let snapshotId;
      try { snapshotId = JSON.parse(rawPayload).snapshot_id; }
      catch { snapshotId = rawPayload; }
      if (typeof snapshotId !== 'string' || !snapshotId || activeSnapshots.has(snapshotId)) return;
      activeSnapshots.add(snapshotId);
      try {
        await assertMainRunForSnapshot(snapshotId);
        const { strategy, briefing } = await assertCurrentStrategySource(snapshotId);
        const [snapshot] = await db.select().from(snapshots)
          .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
        if (!snapshot) throw new Error('Admitted snapshot is missing');
        const result = await ensureSmartBlocksExist(snapshotId, {
          strategyRow: strategy, briefingRow: briefing, snapshot, userId: snapshot.user_id,
        });
        if (!result.ranking) throw new Error(result.error || 'Venue generation is still pending');
      } catch (error) {
        console.error('[STRATEGY] Notification handling failed:', error?.message || error);
      } finally {
        activeSnapshots.delete(snapshotId);
      }
    });
    // Attach these only after a successful subscription, so failed startup can
    // retry without accumulating handlers. Shutdown removes the matching pair.
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      try { if (unsubscribe) await unsubscribe(); }
      catch (error) { console.error('[STRATEGY] Listener shutdown failed:', error?.message || error); }
      finally { unsubscribe = null; }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log('[STRATEGY] Listening on strategy_ready via shared dispatcher');
  } catch (error) {
    console.error('[STRATEGY] Failed to start listener:', error?.message || error);
    throw error;
  }
}

// Retained for older bootstrap imports; no polling or duplicate worker starts.
export async function processTriadJobs() {
  console.warn('[triad-worker] Hot polling is disabled. Use startConsolidationListener().');
}
