import { latLngToCell } from 'h3-js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { getDayPartKey, getLocalHour, getLocalDow, getLocalDateString, getLocalIso, normalizeDayPartKey } from '../../../shared/dayparts.js';
import { invalidSnapshotFields, validSnapshotDate } from '../../util/validate-snapshot.js';
import { coordsKey } from './coords-key.js';

// Every persisted column except status, which is the gate's output. Schema unchanged.
export const SNAPSHOT_REQUIRED_FIELDS = Object.freeze([
  'snapshot_id', 'created_at', 'session_id', 'user_id', 'lat', 'lng', 'coord_key', 'h3_r8',
  'city', 'state', 'country', 'formatted_address', 'timezone', 'market', 'local_iso', 'date',
  'dow', 'hour', 'day_part_key', 'weather', 'air', 'permissions',
]);
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const goodSection = value => object(value) && value.available !== false && !value._generationFailed && !value.isFallback && !value._pending;
export const SNAPSHOT_OBSERVATION_MAX_AGE_MS = Object.freeze({ weather: 30 * 60_000, air: 2 * 60 * 60_000 });

export function getSnapshotEnrichmentErrors({ weather, air }) {
  const errors = [];
  if (weather !== undefined && (!goodSection(weather) || !Number.isFinite(weather.tempF) || !text(weather.conditions))) errors.push('weather');
  if (air !== undefined && (!goodSection(air) || !Number.isFinite(air.aqi) || air.aqi < 0 || !text(air.category))) errors.push('air');
  return errors;
}

export function hasSnapshotEnvironmentSource(row, field) {
  const source = row?.[field]?.source;
  const provider = field === 'weather' ? 'google-weather' : 'google-air-quality';
  const fetched = source && Date.parse(source.fetched_at);
  const observed = source && Date.parse(source.observed_at);
  const created = row && new Date(row.created_at).getTime();
  return source?.provider === provider && source.coord_key === row.coord_key &&
    text(source.fetched_at) && text(source.observed_at) &&
    Number.isFinite(fetched) && Number.isFinite(observed) && Number.isFinite(created) &&
    fetched >= created - 60_000 && observed <= fetched + 5_000 &&
    fetched - observed <= SNAPSHOT_OBSERVATION_MAX_AGE_MS[field];
}

export function getSnapshotReadiness(row, snapshotId, { requireStatus = true } = {}) {
  const invalid = new Set(invalidSnapshotFields(row));
  for (const field of SNAPSHOT_REQUIRED_FIELDS) {
    if (row?.[field] === null || row?.[field] === undefined || row?.[field] === '') invalid.add(field);
  }
  for (const field of ['snapshot_id', 'session_id', 'user_id', 'market']) {
    if (!text(row?.[field])) invalid.add(field);
  }
  if (snapshotId && row?.snapshot_id !== snapshotId) invalid.add('snapshot_id');
  if (!validSnapshotDate(row?.created_at)) invalid.add('created_at');
  const coords = normalizeCoordinates(row?.lat, row?.lng);
  if (coords) {
    if (coords.lat !== row.lat || coords.lng !== row.lng) invalid.add('lat/lng_precision');
    if (coordsKey(coords.lat, coords.lng) !== row.coord_key) invalid.add('coord_key');
    if (latLngToCell(coords.lat, coords.lng, 8) !== row.h3_r8) invalid.add('h3_r8');
  }
  if (!invalid.has('created_at') && !invalid.has('timezone')) {
    const created = new Date(row.created_at);
    if (getLocalHour(created, row.timezone) !== row.hour) invalid.add('hour');
    if (getLocalDow(created, row.timezone) !== row.dow) invalid.add('dow');
    if (getLocalDateString(created, row.timezone) !== row.date) invalid.add('date');
    // local_iso is a naive wall-clock column, not the UTC instant in created_at.
    const wallClock = row.local_iso instanceof Date && validSnapshotDate(row.local_iso)
      ? row.local_iso.toISOString().slice(0, 19)
      : typeof row.local_iso === 'string' ? row.local_iso.replace(' ', 'T').slice(0, 19) : null;
    if (getLocalIso(created, row.timezone) !== wallClock) invalid.add('local_iso');
  }
  if (!invalid.has('hour') && normalizeDayPartKey(row?.day_part_key) !== getDayPartKey(row.hour)) invalid.add('day_part_key');
  for (const field of getSnapshotEnrichmentErrors({ weather: row?.weather ?? null, air: row?.air ?? null })) invalid.add(field);
  // Old rows without a server source receipt remain historical. A new snapshot
  // gets fresh provider data; client-supplied labels cannot prove provenance.
  for (const field of ['weather', 'air']) if (!hasSnapshotEnvironmentSource(row, field)) invalid.add(field);
  if (!object(row?.permissions) || row.permissions.geolocation !== 'granted') invalid.add('permissions');
  if (requireStatus && row?.status !== 'ok') invalid.add('status');
  const missingFields = [...invalid];
  return { ready: missingFields.length === 0, missingFields, status: row?.status || 'pending' };
}

export function assertSnapshotReady(row, snapshotId) {
  const state = getSnapshotReadiness(row, snapshotId);
  if (!state.ready) {
    const error = new Error(`Snapshot is not complete: ${state.missingFields.join(', ')}`);
    error.code = 'snapshot_incomplete';
    error.missingFields = state.missingFields;
    throw error;
  }
  return row;
}
