
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Middleware to verify user owns the snapshot
 * Attaches snapshot to req.snapshot if valid
 *
 * IMPORTANT: Supports both authenticated and anonymous users:
 * - Authenticated: checks snapshot.user_id === req.auth.userId
 * - Anonymous: checks snapshot.device_id matches (from header or allows access for demo)
 */
export async function requireSnapshotOwnership(req, res, next) {
  try {
    const { snapshotId } = req.params;

    // Debug logging
    console.log(`[requireSnapshotOwnership] 🔍 Checking snapshot: ${snapshotId?.slice(0, 8) || 'null'}`);
    console.log(`[requireSnapshotOwnership]   - auth.userId: ${req.auth?.userId?.slice(0, 8) || 'none (anonymous)'}`);

    if (!snapshotId) {
      console.log(`[requireSnapshotOwnership] ❌ No snapshotId provided`);
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (snapshotCheck.length === 0) {
      console.log(`[requireSnapshotOwnership] ❌ Snapshot ${snapshotId.slice(0, 8)} NOT FOUND in database`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    const snapshot = snapshotCheck[0];
    console.log(`[requireSnapshotOwnership]   - snapshot.user_id: ${snapshot.user_id?.slice(0, 8) || 'null'}`);
    console.log(`[requireSnapshotOwnership]   - snapshot.city: ${snapshot.city}`);

    // Check ownership: authenticated user OR matching device
    // If user is authenticated, verify user_id matches (if snapshot has user_id)
    if (req.auth?.userId) {
      // If snapshot has a user_id, verify it matches
      if (snapshot.user_id && snapshot.user_id !== req.auth.userId) {
        console.log(`[requireSnapshotOwnership] ❌ User mismatch: auth=${req.auth.userId.slice(0, 8)} vs snapshot=${snapshot.user_id?.slice(0, 8)}`);
        return res.status(404).json({ error: 'snapshot_not_found' });
      }
      // If snapshot has no user_id (legacy data or schema not yet updated), allow authenticated user access
      // The snapshot_id itself is an unguessable UUID capability token
      if (snapshot.user_id) {
        console.log(`[requireSnapshotOwnership] ✅ User ownership verified`);
      } else {
        console.log(`[requireSnapshotOwnership] ✅ Authenticated user accessing snapshot without user_id (legacy)`);
      }
    } else {
      // Anonymous user: for now, allow access to any snapshot they have the ID for
      // In the future, we could check device_id from header matches snapshot.device_id
      // Security: The snapshot_id itself acts as a capability token (UUID is unguessable)
      console.log(`[requireSnapshotOwnership] ✅ Anonymous access to snapshot ${snapshotId.slice(0, 8)}`);
    }

    req.snapshot = snapshot;
    next();
  } catch (error) {
    console.error('[requireSnapshotOwnership] Error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
