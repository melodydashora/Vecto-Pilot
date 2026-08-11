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
/**
 * Core check, callable from routes whose snapshotId arrives in the body,
 * header, or query (where the param middleware below can't reach it).
 * 2026-08-11: extracted so ONE ownership policy exists — chat, chat-context,
 * content-blocks, and realtime previously either duplicated this inline
 * (with divergent 403 semantics) or had no check at all.
 *
 * @returns {Promise<{ok: true, snapshot: Object} | {ok: false, status: number, body: Object}>}
 */
export async function verifySnapshotOwnership(snapshotId, userId) {
  if (!snapshotId) {
    console.log(`[SNAPSHOT] No snapshotId provided`);
    return { ok: false, status: 400, body: { error: 'snapshotId is required' } };
  }
  if (!userId) {
    console.log(`[SNAPSHOT] No auth for snapshot ${snapshotId.slice(0, 8)}`);
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }

  try {
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (snapshotCheck.length === 0) {
      console.log(`[SNAPSHOT] Snapshot ${snapshotId.slice(0, 8)} NOT FOUND`);
      return { ok: false, status: 404, body: { error: 'snapshot_not_found' } };
    }

    const snapshot = snapshotCheck[0];

    // Auth-only product: snapshot MUST have a user_id AND it must match.
    // NULL-owned snapshots are orphan data from bugs — reject them.
    // Mismatch returns 404 (not 403) to avoid snapshot-id enumeration.
    if (!snapshot.user_id) {
      console.log(`[SNAPSHOT] Snapshot ${snapshotId.slice(0, 8)} has NULL user_id (orphan data)`);
      return { ok: false, status: 404, body: { error: 'snapshot_not_found' } };
    }

    if (snapshot.user_id !== userId) {
      console.log(`[SNAPSHOT] User mismatch: auth=${userId.slice(0, 8)} vs snapshot=${snapshot.user_id.slice(0, 8)}`);
      return { ok: false, status: 404, body: { error: 'snapshot_not_found' } };
    }

    return { ok: true, snapshot };
  } catch (error) {
    console.error('[SNAPSHOT] Error:', error);
    return { ok: false, status: 500, body: { error: 'internal_error' } };
  }
}

export async function requireSnapshotOwnership(req, res, next) {
  const result = await verifySnapshotOwnership(req.params.snapshotId, req.auth?.userId);
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }
  // Attach snapshot for downstream handlers
  req.snapshot = result.snapshot;
  next();
}
