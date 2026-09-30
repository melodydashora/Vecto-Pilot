import { eq } from 'drizzle-orm';
import { snapshots } from '../../../shared/schema.js';
import { coordsKey } from './coords-key.js';
import { getSnapshotReadiness, getSnapshotEnrichmentErrors } from './snapshot-readiness.js';
import { snapshotEnvironment } from './snapshot-environment.js';
import { assertMainRunForSnapshot, withCurrentMainRun } from '../main-run-admission.js';

// A completed snapshot is immutable source material for Briefing and Strategy.
// Provider work happens before the short lock; concurrent requests reuse the
// first completed record instead of changing the data beneath downstream work.
export async function enrichSnapshot(snapshot, userId) {
  if (!snapshot || snapshot.user_id !== userId) throw new Error('Snapshot ownership is required for enrichment');
  const admission = await assertMainRunForSnapshot(snapshot.snapshot_id, { allowUpstream: true });
  if (getSnapshotReadiness(snapshot, snapshot.snapshot_id).ready) return snapshot;
  if (snapshot.status === 'ok') throw new Error('Snapshot source is unverified. Refresh location for a new snapshot.');
  const coordKey = coordsKey(snapshot.lat, snapshot.lng);
  if (!coordKey || snapshot.coord_key !== coordKey) throw new Error('Snapshot coordinate identity is incomplete');
  const data = await snapshotEnvironment.both(snapshot.lat, snapshot.lng, { scope: admission.run_id });
  if (getSnapshotEnrichmentErrors(data).length || data.weather.source?.coord_key !== coordKey || data.air.source?.coord_key !== coordKey) {
    throw new Error('Snapshot provider data does not match the saved coordinates');
  }
  return withCurrentMainRun(snapshot.snapshot_id, async tx => {
    const [current] = await tx.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot.snapshot_id)).for('update').limit(1);
    if (!current || current.user_id !== userId || current.coord_key !== coordKey || current.lat !== snapshot.lat || current.lng !== snapshot.lng) {
      throw new Error('Snapshot changed while its environment was being fetched');
    }
    if (getSnapshotReadiness(current, current.snapshot_id).ready) return current;
    if (current.status === 'ok') throw new Error('Snapshot source changed. Refresh location for a new snapshot.');
    const next = { ...current, ...data };
    next.status = getSnapshotReadiness(next, next.snapshot_id, { requireStatus: false }).ready ? 'ok' : 'pending';
    const [saved] = await tx.update(snapshots).set({ ...data, status: next.status }).where(eq(snapshots.snapshot_id, current.snapshot_id)).returning();
    if (!saved) throw new Error('Snapshot enrichment was not saved');
    return saved;
  }, { allowUpstream: true });
}
