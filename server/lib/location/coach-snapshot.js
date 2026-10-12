// Coach owns immutable observations, independently of MAIN's current pointers.
import { and, desc, eq, sql } from 'drizzle-orm';
import { snapshots } from '../../../shared/schema.js';
import { validateGpsFix, normalizeCoordinates } from '../../../shared/coordinates.js';
import { withDriverSettingsLock, MainRunAdmissionError } from '../main-run-admission.js';
import { collectSnapshot } from './snapshot-collector.js';
import { assertSnapshotReady } from './snapshot-readiness.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, code, message) => { throw new MainRunAdmissionError(status, code, message); };
const byId = async (tx, id) => (await tx.select().from(snapshots).where(eq(snapshots.snapshot_id, id)).limit(1))[0];

function readyOwned(snapshot, auth) {
  if (!snapshot || snapshot.user_id !== auth.userId || snapshot.session_id !== auth.sessionId ||
      snapshot.permissions?.context_kind !== 'coach') {
    fail(409, 'coach_snapshot_unavailable', 'That Coach snapshot is unavailable in your current session. Refresh Coach location.');
  }
  const fix = validateGpsFix({ latitude: snapshot.lat, longitude: snapshot.lng,
    accuracy: snapshot.permissions.accuracy_m,
    timestamp: snapshot.permissions.gps_timestamp ?? Date.parse(snapshot.permissions.observed_at),
  }, new Date(snapshot.created_at).getTime());
  if (!fix.ok) fail(422, 'snapshot_incomplete', 'The saved Coach GPS receipt is invalid. Refresh Coach location.');
  try { return assertSnapshotReady(snapshot, snapshot.snapshot_id); }
  catch (error) { fail(422, 'snapshot_incomplete', error.message); }
}

/** Explicit IDs never fall back to a different observation. */
export async function readOwnedCoachSnapshot(auth, snapshotId = null) {
  if (snapshotId !== null && (typeof snapshotId !== 'string' || !UUID.test(snapshotId))) {
    fail(400, 'invalid_coach_snapshot', 'Coach snapshot identity must be a UUID.');
  }
  return withDriverSettingsLock(auth, async tx => {
    if (snapshotId !== null) return readyOwned(await byId(tx, snapshotId), auth);
    const [saved] = await tx.select().from(snapshots).where(and(
      eq(snapshots.user_id, auth.userId), eq(snapshots.session_id, auth.sessionId),
      eq(snapshots.status, 'ok'), sql`${snapshots.permissions}->>'context_kind' = 'coach'`,
    )).orderBy(
      desc(sql`(${snapshots.permissions}->>'observed_at')::timestamptz`),
      desc(snapshots.created_at), desc(snapshots.snapshot_id),
    ).limit(1);
    return saved ? readyOwned(saved, auth) : null;
  });
}

export async function captureCoachSnapshot(auth, captureId, input) {
  if (typeof captureId !== 'string' || !UUID.test(captureId)) {
    fail(400, 'invalid_capture_request', 'Coach location capture requires one request identity.');
  }
  // POST observations are measurements, never boolean/string coercions. Replays
  // may be old, but must still identify exactly the original sensor receipt.
  if (!input || !['lat', 'lng', 'accuracy', 'gps_timestamp'].every(key => typeof input[key] === 'number' && Number.isFinite(input[key]))) {
    fail(400, 'fresh_gps_required', 'Coach location requires numeric GPS coordinates, accuracy and observation time.');
  }
  const coords = normalizeCoordinates(input.lat, input.lng);
  if (!coords) fail(400, 'fresh_gps_required', 'Location coordinates are invalid. Retry precise location.');
  if (input.permission !== 'granted') fail(400, 'location_permission_required', 'A successful current GPS capture is required.');
  const createdAt = new Date();
  const fix = validateGpsFix({ latitude: coords.lat, longitude: coords.lng, accuracy: input.accuracy, timestamp: input.gps_timestamp }, createdAt.getTime());
  const matchingReceipt = saved => {
    if (!saved || saved.user_id !== auth.userId || saved.session_id !== auth.sessionId || saved.permissions?.context_kind !== 'coach' ||
        saved.lat !== coords.lat || saved.lng !== coords.lng || saved.permissions?.accuracy_m !== input.accuracy ||
        saved.permissions?.geolocation !== input.permission ||
        (saved.permissions?.gps_timestamp ?? Date.parse(saved.permissions?.observed_at)) !== input.gps_timestamp) {
      fail(409, 'capture_intent_conflict', 'This Coach capture identity refers to another observation or session.');
    }
    return readyOwned(saved, auth);
  };
  const existing = await withDriverSettingsLock(auth, async tx => {
    const saved = await byId(tx, captureId);
    if (saved) return matchingReceipt(saved);
    if (!fix.ok) fail(400, 'fresh_gps_required', fix.error);
    return null;
  });
  if (existing) return existing;

  const context = { user_id: auth.userId, session_id: auth.sessionId, run_id: `coach:${captureId}` };
  const snapshot = await collectSnapshot(auth, context, input, createdAt, fix);
  snapshot.snapshot_id = captureId;
  snapshot.permissions = { ...snapshot.permissions, context_kind: 'coach', gps_timestamp: fix.timestamp };
  return withDriverSettingsLock(auth, async tx => {
    const saved = await byId(tx, captureId);
    if (saved) return matchingReceipt(saved);
    // Every successful observation remains immutable. Latest reads use observed
    // time then collection start, so delayed older work cannot replace newer work.
    const [inserted] = await tx.insert(snapshots).values(snapshot)
      .onConflictDoNothing({ target: snapshots.snapshot_id }).returning();
    return inserted ? readyOwned(inserted, auth) : matchingReceipt(await byId(tx, captureId));
  });
}
