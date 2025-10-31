// server/bootstrap/enqueue-initial.js
// Seeds a triad job when queue is empty (for testing/boot)

import { db } from '../db/drizzle.js';
import { triad_jobs, snapshots } from '../../shared/schema.js';
import { sql } from 'drizzle-orm';

export async function seedJobIfEmpty() {
  if (process.env.SEED_JOB_ON_BOOT !== 'true') {
    console.log('[boot] Job seeding disabled (SEED_JOB_ON_BOOT not set)');
    return;
  }

  try {
    // Check for queued jobs
    const queued = await db.execute(sql`
      SELECT COUNT(*) as count FROM ${triad_jobs} WHERE status = 'queued'
    `);
    
    const queuedCount = parseInt(queued.rows[0]?.count || 0);
    
    if (queuedCount > 0) {
      console.log(`[boot] ✓ ${queuedCount} queued jobs found, skipping seed`);
      return;
    }

    // Get latest snapshot
    const latestSnap = await db.execute(sql`
      SELECT snapshot_id FROM ${snapshots} 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    if (!latestSnap.rows || latestSnap.rows.length === 0) {
      console.log('[boot] ⚠️  No snapshots found, cannot seed job');
      return;
    }

    const snapshotId = latestSnap.rows[0].snapshot_id;

    // Insert seed job
    await db.insert(triad_jobs).values({
      snapshot_id: snapshotId,
      kind: 'triad',
      status: 'queued'
    }).onConflictDoNothing();

    console.log(`[boot] ✅ Seeded triad job for snapshot ${snapshotId}`);
  } catch (err) {
    console.error('[boot] Failed to seed job:', err.message);
  }
}
