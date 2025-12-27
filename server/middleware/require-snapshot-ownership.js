
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Middleware to verify user owns the snapshot
 * Attaches snapshot to req.snapshot if valid
 */
export async function requireSnapshotOwnership(req, res, next) {
  try {
    const { snapshotId } = req.params;
    
    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    req.snapshot = snapshotCheck[0];
    next();
  } catch (error) {
    console.error('[requireSnapshotOwnership] Error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
