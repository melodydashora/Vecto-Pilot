// Deterministic provider collection and snapshot construction; no persistence,
// session pointers, run admission or pipeline triggering. Callers own publication.
import crypto from 'node:crypto';
import { latLngToCell } from 'h3-js';
import { getDayPartKey, getLocalHour, getLocalDow, getLocalDateString, getLocalIso } from '../../../shared/dayparts.js';
import { coordsKey } from './coords-key.js';
import { resolveFreshGpsLocation } from './geocode.js';
import { resolveTimezoneFromMarket } from './resolveTimezone.js';
import { snapshotEnvironment } from './snapshot-environment.js';
import { assertSnapshotReady } from './snapshot-readiness.js';
import { MainRunAdmissionError } from '../main-run-admission.js';

const collecting = new Map();
export async function collectSnapshotSources(admission, fix) {
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

export async function collectSnapshot(auth, context, input, createdAt, fix) {
  let location, environment, market;
  try {
    ({ location, environment, market } = await collectSnapshotSources(context, fix));
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
