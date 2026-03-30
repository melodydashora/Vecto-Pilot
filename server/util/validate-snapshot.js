export function validateIncomingSnapshot(body) {
  const errors = [];
  const warnings = [];

  // Accept either traditional format (lat/lng) or SnapshotV1 format (coord)
  const lat = body?.lat || body?.coord?.lat;
  const lng = body?.lng || body?.coord?.lng;
  
  // Accept either context (internal) or resolved (SnapshotV1) format
  const ctx = body?.context || body?.resolved;

  if (typeof lat !== "number" || !Number.isFinite(lat)) errors.push("lat");
  if (typeof lng !== "number" || !Number.isFinite(lng)) errors.push("lng");

  if (!ctx) {
    errors.push("context_or_resolved");
  } else {
    if (!ctx.city && !ctx.formattedAddress) errors.push("context.city_or_formattedAddress");
    if (!ctx.timezone) errors.push("context.timezone");
  }

  if (!body.meta?.device || !body.meta?.app) warnings.push("meta.device_or_app");

  return { ok: errors.length === 0, errors, warnings };
}

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
