// 2026-07-06: validateIncomingSnapshot deleted (consolidation Phase 1) — it was
// imported by snapshot.js but never called anywhere.
import { normalizeCoordinates } from '../../shared/coordinates.js';
import { normalizeDayPartKey } from '../../shared/dayparts.js';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const validSnapshotDate = value => (value instanceof Date || nonempty(value)) && Number.isFinite(new Date(value).getTime());
export function validSnapshotTimezone(value) {
  if (!nonempty(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

export function invalidSnapshotFields(record) {
  const r = record || {};
  const invalid = ['city', 'state', 'country', 'formatted_address'].filter(field => !nonempty(r[field]));
  if (!normalizeCoordinates(r.lat, r.lng) || typeof r.lat !== 'number' || typeof r.lng !== 'number') invalid.push('lat/lng');
  if (!validSnapshotTimezone(r.timezone)) invalid.push('timezone');
  if (!validSnapshotDate(r.local_iso)) invalid.push('local_iso');
  if (!Number.isInteger(r.dow) || r.dow < 0 || r.dow > 6) invalid.push('dow');
  if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) invalid.push('hour');
  if (!normalizeDayPartKey(r.day_part_key)) invalid.push('day_part_key');
  return invalid;
}

export function validateSnapshotV1(s) {
  const errors = [];
  if (!s?.snapshot_id) errors.push("snapshot_id");
  if (!s?.coord || !normalizeCoordinates(s.coord.lat, s.coord.lng) || typeof s.coord.lat !== 'number' || typeof s.coord.lng !== 'number') errors.push("coord.lat_lng");
  if (!validSnapshotTimezone(s?.resolved?.timezone)) errors.push("resolved.timezone");
  if (!s?.resolved?.city && !s?.resolved?.formattedAddress) errors.push("resolved.city_or_formattedAddress");
  return { ok: errors.length === 0, errors };
}

/**
 * Validate all required snapshot fields are present before DB INSERT
 * These fields are NOT NULL in the database schema - throws if any are missing
 *
 * 2026-01-14: Consolidated from duplicate definitions in snapshot.js and location.js
 * This is the SINGLE guard that prevents incomplete snapshots from being saved
 *
 * @param {Object} record - The snapshot record to be inserted
 * @throws {Error} SNAPSHOT_INCOMPLETE if any required fields are missing
 */
export function validateSnapshotFields(record) {
  const missing = invalidSnapshotFields(record);
  if (missing.length > 0) {
    const error = new Error(`SNAPSHOT_VALIDATION_FAILED: Missing required fields: ${missing.join(', ')}`);
    error.missingFields = missing;
    error.code = 'SNAPSHOT_INCOMPLETE';
    throw error;
  }
  return true;
}
