// server/middleware/require-snapshot-ownership.js
// 2026-01-09: P0-4 FIX - Strict ownership enforcement
// Previous version allowed NULL-owned snapshots through (security vulnerability)

import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Middleware to verify authenticated user owns the snapshot
 * Attaches snapshot to req.snapshot if valid
 *
 * PREREQUISITE: Must be used AFTER requireAuth middleware
 *
 * SECURITY MODEL (auth-only product):
 * - snapshot.user_id MUST be non-null AND equal to req.auth.userId
 * - NULL-owned snapshots are rejected (orphan data from bugs)
 * - User mismatch returns 404 (not 403) to avoid enumeration
 */
export async function requireSnapshotOwnership(req, res, next) {
  try {
    const { snapshotId } = req.params;

    if (!snapshotId) {
      console.log(`[snapshotOwnership] ❌ No snapshotId provided`);
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    // Verify user is authenticated (requireAuth should have run first)
    if (!req.auth?.userId) {
      console.log(`[snapshotOwnership] ❌ No auth for snapshot ${snapshotId.slice(0, 8)}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (snapshotCheck.length === 0) {
      console.log(`[snapshotOwnership] ❌ Snapshot ${snapshotId.slice(0, 8)} NOT FOUND`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    const snapshot = snapshotCheck[0];

    // 2026-01-09: P0-4 FIX - Strict ownership check
    // Auth-only product: snapshot MUST have user_id AND it must match
    // NULL-owned snapshots are orphan data from bugs - reject them
    if (!snapshot.user_id) {
      console.log(`[snapshotOwnership] ❌ Snapshot ${snapshotId.slice(0, 8)} has NULL user_id (orphan data)`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    if (snapshot.user_id !== req.auth.userId) {
      console.log(`[snapshotOwnership] ❌ User mismatch: auth=${req.auth.userId.slice(0, 8)} vs snapshot=${snapshot.user_id.slice(0, 8)}`);
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // Success - attach snapshot to request for downstream handlers
    req.snapshot = snapshot;
    next();
  } catch (error) {
    console.error('[snapshotOwnership] Error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
