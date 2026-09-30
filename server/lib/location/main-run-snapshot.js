import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { latLngToCell } from 'h3-js';
import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { validateGpsFix, normalizeCoordinates } from '../../../shared/coordinates.js';
import { getDayPartKey, getLocalHour, getLocalDow, getLocalDateString, getLocalIso } from '../../../shared/dayparts.js';
import { coordsKey } from './coords-key.js';
import { resolveFreshGpsLocation } from './geocode.js';
import { resolveTimezoneFromMarket } from './resolveTimezone.js';
import { snapshotEnvironment } from './snapshot-environment.js';
import { assertSnapshotReady } from './snapshot-readiness.js';
import { assertCurrentMainRun, withDriverSettingsLock, bindMainRunSnapshot, recordMainRunSnapshotError, MainRunAdmissionError } from '../main-run-admission.js';
import { cancelUpstreamBriefingGenerations } from '../briefing/briefing-generation.js';
import { locationLog, OP } from '../../logger/workflow.js';

// GET carries decimal strings; POST must not coerce booleans/arrays into measurements.
const sensorNumber = value => typeof value === 'number' ? value
  : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const collecting = new Map();
async function collectMainRunSources(admission, fix) {
  // Share only currently running provider work for identical full-precision
  // coordinates in the same admitted run or upstream capture. Each caller
  // validates its sensor receipt and rechecks ownership before publication.
  const key = JSON.stringify([admission.user_id, admission.session_id, admission.run_id,
    admission.settings_revision, admission.rules_version, admission.rules_hash, fix.lat, fix.lng]);
  let pending = collecting.get(key);
  if (!pending) {
    pending = Promise.all([
      resolveFreshGpsLocation(fix.lat, fix.lng),
      snapshotEnvironment.both(fix.lat, fix.lng, { scope: admission.run_id }),
    ]).then(async ([location, environment]) => ({ location, environment,
      market: await resolveTimezoneFromMarket(location.city, location.state, location.country) }));
    collecting.set(key, pending);
  }
  try { return structuredClone(await pending); }
  finally { if (collecting.get(key) === pending) collecting.delete(key); }
}

// Legacy run-bound capture retains its strict admission boundary. Preparatory
// portal capture below uses the same providers and snapshot validation.
export async function captureMainRunSnapshot(auth, runId, input) {
  const admission = await assertCurrentMainRun(auth, runId);
  if (admission.snapshot_id) {
    const [saved] = await db.select().from(snapshots).where(and(
      eq(snapshots.snapshot_id, admission.snapshot_id), eq(snapshots.user_id, auth.userId),
    )).limit(1);
    if (!saved) throw new MainRunAdmissionError(409, 'run_snapshot_missing', 'The admitted snapshot is unavailable. Review setup before another Continue.');
    await assertCurrentMainRun(auth, runId);
    return assertSnapshotReady(saved, saved.snapshot_id);
  }
  try {
  const createdAt = new Date();
  const fix = validateGpsFix({
    latitude: input.lat, longitude: input.lng,
    accuracy: sensorNumber(input.accuracy), timestamp: sensorNumber(input.gps_timestamp),
  }, createdAt.getTime());
  if (!fix.ok) throw new MainRunAdmissionError(400, 'fresh_gps_required', fix.error);
  if (input.permission !== 'granted') {
    throw new MainRunAdmissionError(400, 'location_permission_required', 'A successful current GPS capture is required.');
  }
  if (fix.timestamp < new Date(admission.created_at).getTime() - 1_000) {
    throw new MainRunAdmissionError(400, 'fresh_gps_required', 'Capture a fresh location after Continue.');
  }
  const snapshot = await collectSnapshot(auth, admission, input, createdAt, fix);
  return await withDriverSettingsLock(auth, tx => bindMainRunSnapshot(tx, auth, runId, snapshot));
  } catch (error) {
    try {
      await recordMainRunSnapshotError(auth, runId, error instanceof MainRunAdmissionError ? error.code : 'snapshot_failed');
    } catch {
      locationLog.warn(1, 'Could not record the current snapshot attempt failure; session or admission may have changed.', OP.DB);
    }
    throw error;
  }
}

async function collectSnapshot(auth, context, input, createdAt, fix) {
  let location, environment, market;
  try {
    ({ location, environment, market } = await collectMainRunSources(context, fix));
  } catch (error) {
    const failure = new MainRunAdmissionError(502, 'snapshot_collection_failed', 'Current location details could not be collected. Use Refresh to try again.');
    failure.cause = error;
    throw failure;
  }
  const hour = getLocalHour(createdAt, location.timeZone);
  const snapshot = {
    snapshot_id: crypto.randomUUID(), user_id: auth.userId, session_id: context.session_id,
    created_at: createdAt, date: getLocalDateString(createdAt, location.timeZone),
    lat: fix.lat, lng: fix.lng, coord_key: coordsKey(fix.lat, fix.lng), h3_r8: latLngToCell(fix.lat, fix.lng, 8),
    city: location.city, state: location.state, country: location.country,
    formatted_address: location.formattedAddress, timezone: location.timeZone, market: market?.market_name ?? null,
    // Drizzle transports wall digits into the existing timestamp WITHOUT time
    // zone column through its Date encoder. This Date is not a UTC instant.
    // created_at carries the real instant; API local_iso has no zone suffix.
    local_iso: new Date(getLocalIso(createdAt, location.timeZone) + 'Z'),
    dow: getLocalDow(createdAt, location.timeZone), hour, day_part_key: getDayPartKey(hour),
    weather: environment.weather, air: environment.air,
    permissions: { geolocation: input.permission, observed_at: new Date(fix.timestamp).toISOString(), accuracy_m: fix.accuracy },
    status: 'ok',
  };
  try { assertSnapshotReady(snapshot, snapshot.snapshot_id); }
  catch (error) { throw new MainRunAdmissionError(422, 'snapshot_incomplete', error.message); }
  return snapshot;
}

// GPS and Briefing can prepare independently of preferences. Claim the current
// context before providers; a slower old capture cannot replace a newer one.
// This pointer does not revoke the separately admitted current Strategy.
export async function captureUpstreamSnapshot(auth, captureId, input) {
  if (typeof captureId !== 'string' || !UUID.test(captureId)) {
    throw new MainRunAdmissionError(400, 'invalid_capture_request', 'Location capture requires one request identity.');
  }
  const createdAt = new Date();
  const fix = validateGpsFix({ latitude: input.lat, longitude: input.lng,
    accuracy: sensorNumber(input.accuracy), timestamp: sensorNumber(input.gps_timestamp),
  }, createdAt.getTime());
  const coords = normalizeCoordinates(input.lat, input.lng);
  if (!coords) throw new MainRunAdmissionError(400, 'fresh_gps_required', fix.error);
  const readSaved = async tx => (await tx.select().from(snapshots)
    .where(eq(snapshots.snapshot_id, captureId)).limit(1))[0];
  const assertReceipt = saved => {
    if (saved.user_id !== auth.userId || saved.session_id !== auth.sessionId ||
        saved.permissions?.context_kind !== 'upstream') {
      throw new MainRunAdmissionError(409, 'capture_intent_conflict', 'This location request identity is already in use.');
    }
    if (saved.lat !== coords.lat || saved.lng !== coords.lng) {
      throw new MainRunAdmissionError(409, 'capture_intent_conflict', 'This location request identity refers to another observation.');
    }
    return assertSnapshotReady(saved, captureId);
  };
  const claimed = await withDriverSettingsLock(auth, async (tx, session) => {
    const existing = await readSaved(tx);
    if (existing) {
      assertReceipt(existing);
      if (session.current_snapshot_id !== captureId) {
        throw new MainRunAdmissionError(409, 'context_superseded', 'A newer location has already been prepared.');
      }
      return { saved: existing };
    }
    // Idempotent delivery of an existing observation does not manufacture a new
    // sensor receipt. Freshness is checked only when collecting a new source.
    if (!fix.ok) throw new MainRunAdmissionError(400, 'fresh_gps_required', fix.error);
    if (input.permission !== 'granted') {
      throw new MainRunAdmissionError(400, 'location_permission_required', 'A successful current GPS capture is required.');
    }
    await tx.update(users).set({ current_snapshot_id: captureId, updated_at: new Date() })
      .where(and(eq(users.user_id, auth.userId), eq(users.session_id, auth.sessionId)));
    return { previousSnapshotId: session.current_snapshot_id };
  });
  if (claimed.saved) return claimed.saved;
  if (claimed.previousSnapshotId !== captureId) cancelUpstreamBriefingGenerations(claimed.previousSnapshotId);
  const context = { user_id: auth.userId, session_id: auth.sessionId, run_id: captureId };
  const snapshot = await collectSnapshot(auth, context, input, createdAt, fix);
  snapshot.snapshot_id = captureId;
  snapshot.permissions.context_kind = 'upstream';
  return withDriverSettingsLock(auth, async (tx, session) => {
    if (session.current_snapshot_id !== captureId) {
      throw new MainRunAdmissionError(409, 'context_superseded', 'A newer location has already been prepared.');
    }
    const existing = await readSaved(tx);
    if (existing) return assertReceipt(existing);
    return (await tx.insert(snapshots).values(snapshot).returning())[0];
  });
}

export function snapshotResponse(snapshot, runId) {
  const observedAt = typeof snapshot.permissions?.observed_at === 'string' ? Date.parse(snapshot.permissions.observed_at) : NaN;
  const accuracy = snapshot.permissions?.accuracy_m;
  return {
    ok: true, success: true, runId, snapshot_id: snapshot.snapshot_id, user_id: snapshot.user_id,
    sessionId: snapshot.session_id,
    sourceSnapshotId: snapshot.permissions?.context_kind === 'strategy_context'
      ? snapshot.permissions.context_source_snapshot_id : snapshot.snapshot_id,
    status: snapshot.status, snapshot_status: snapshot.status, ready: snapshot.status === 'ok',
    missingFields: [], missing_fields: [], city: snapshot.city, state: snapshot.state, country: snapshot.country,
    formattedAddress: snapshot.formatted_address, timeZone: snapshot.timezone,
    lat: snapshot.lat, lng: snapshot.lng, hour: snapshot.hour, dow: snapshot.dow,
    gps_timestamp: Number.isFinite(observedAt) && observedAt > 0 ? observedAt : null,
    accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
    weather: snapshot.weather, air: snapshot.air, created_at: snapshot.created_at,
    local_iso: getLocalIso(new Date(snapshot.created_at), snapshot.timezone),
  };
}

export function sendSnapshotError(res, error) {
  const classified = error instanceof MainRunAdmissionError;
  const status = classified && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const code = classified && typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : 'snapshot_failed';
  const message = classified ? error.message : 'Saved location could not be prepared. Use Refresh to try again.';
  const diagnostic = `Snapshot request failed: ${code} (HTTP ${status}).`;
  if (status >= 500) locationLog.error(1, diagnostic, null, OP.DB);
  else locationLog.warn(1, diagnostic, OP.GPS);
  return res.status(status).json({
    ok: false, error: code, message,
  });
}

export async function portalSnapshotHandler(req, res) {
  const data = req.method === 'GET' ? req.query : req.body;
  try {
    const input = {
      lat: data?.coord?.lat ?? data?.lat, lng: data?.coord?.lng ?? data?.lng,
      accuracy: data?.accuracy ?? data?.coord?.accuracy,
      gps_timestamp: data?.gps_timestamp ?? data?.coord?.timestamp,
      permission: data?.permission ?? data?.permissions?.geolocation,
    };
    if (data?.captureId && data?.runId) {
      throw new MainRunAdmissionError(400, 'invalid_capture_request', 'Choose one location capture identity.');
    }
    const snapshot = Object.hasOwn(data ?? {}, 'captureId')
      ? await captureUpstreamSnapshot(req.auth, data.captureId, input)
      : await captureMainRunSnapshot(req.auth, data?.runId, input);
    return res.status(req.method === 'GET' ? 200 : 201).json(snapshotResponse(snapshot, data.runId));
  } catch (error) { return sendSnapshotError(res, error); }
}
