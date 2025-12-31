
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Middleware to verify authenticated user owns the snapshot
 * Attaches snapshot to req.snapshot if valid
 *
 * PREREQUISITE: Must be used AFTER requireAuth middleware
 * - Checks snapshot.user_id === req.auth.userId
 * - Rejects if no auth or user mismatch
 */
export async function requireSnapshotOwnership(req, res, next) {
  try {
    const { snapshotId } = req.params;

    if (!snapshotId) {
      console.log(`[snapshotOwnership] ❌ No snapshotId provided`);
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (snapshotCheck.length === 0) {
      console.log(`[snapshotOwnership] ❌ Snapshot ${snapshotId.slice(0, 8)} NOT FOUND`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    const snapshot = snapshotCheck[0];

    // Check ownership: authenticated user must match snapshot.user_id
    if (req.auth?.userId) {
      // If snapshot has a user_id, verify it matches
      if (snapshot.user_id && snapshot.user_id !== req.auth.userId) {
        console.log(`[snapshotOwnership] ❌ User mismatch: auth=${req.auth.userId.slice(0, 8)} vs snapshot=${snapshot.user_id?.slice(0, 8)}`);
        return res.status(404).json({ error: 'snapshot_not_found' });
      }
      // Success - no logging on happy path (reduces noise)
    } else {
      // No auth - with requireAuth this shouldn't happen, but reject if it does
      console.log(`[snapshotOwnership] ❌ No auth for snapshot ${snapshotId.slice(0, 8)}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.snapshot = snapshot;
    next();
  } catch (error) {
    console.error('[snapshotOwnership] Error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
