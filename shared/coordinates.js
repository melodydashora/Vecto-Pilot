// One coordinate boundary for browser GPS, API input, persistence and cache keys.
// Preserve the sensor's supplied precision; six-decimal keys are a separate lookup format.
export const GPS_MAX_AGE_MS = 30_000;
export const GPS_MAX_ACCURACY_METERS = 100;

function coordinateNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // URLSearchParams serializes tiny numeric GPS readings with an exponent.
  // Accept a complete finite decimal representation, never a numeric prefix.
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCoordinates(latitude, longitude) {
  const lat = coordinateNumber(latitude);
  const lng = coordinateNumber(longitude);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: Object.is(lat, -0) ? 0 : lat, lng: Object.is(lng, -0) ? 0 : lng };
}

/** Validate a browser position before it can start the location waterfall. */
export function validateGpsFix(fix, nowMs = Date.now()) {
  const coords = normalizeCoordinates(fix?.latitude, fix?.longitude);
  if (!coords) return { ok: false, error: 'Location coordinates are invalid. Retry precise location.' };
  if (typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy) || fix.accuracy <= 0 || fix.accuracy > GPS_MAX_ACCURACY_METERS) {
    return { ok: false, error: 'A more precise location is needed. Enable precise location and retry when safely parked.' };
  }
  if (typeof fix.timestamp !== 'number' || !Number.isFinite(fix.timestamp) || !Number.isFinite(nowMs) || fix.timestamp > nowMs + 5_000 || nowMs - fix.timestamp > GPS_MAX_AGE_MS) {
    return { ok: false, error: 'This location fix is out of date. Retry for a fresh location.' };
  }
  return { ok: true, ...coords, accuracy: fix.accuracy, timestamp: fix.timestamp };
}
