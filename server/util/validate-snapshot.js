// 2026-07-06: validateIncomingSnapshot deleted (consolidation Phase 1) — it was
// imported by snapshot.js but never called anywhere.

export function validateSnapshotV1(s) {
  const errors = [];
  if (!s?.snapshot_id) errors.push("snapshot_id");
  if (!s?.coord || typeof s.coord.lat !== "number" || typeof s.coord.lng !== "number") errors.push("coord.lat_lng");
  if (!s?.resolved?.timezone) errors.push("resolved.timezone");
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
  const required = [
    'lat', 'lng', 'city', 'state', 'country',
    'formatted_address', 'timezone', 'local_iso',
    'dow', 'hour', 'day_part_key'
  ];
  const missing = required.filter(f => record[f] === null || record[f] === undefined);
  if (missing.length > 0) {
    const error = new Error(`SNAPSHOT_VALIDATION_FAILED: Missing required fields: ${missing.join(', ')}`);
    error.missingFields = missing;
    error.code = 'SNAPSHOT_INCOMPLETE';
    throw error;
  }
  return true;
}
