import { describe, test, expect } from '@jest/globals';
import { normalizeCoordinates, validateGpsFix, GPS_MAX_AGE_MS, GPS_MAX_ACCURACY_METERS } from '../../shared/coordinates.js';
import { coordsKey, parseCoordKey } from '../../server/lib/location/coords-key.js';

describe('canonical coordinate boundary', () => {
  test.each([
    [0, 0, '0.000000_0.000000'], [-0, 0, '0.000000_0.000000'],
    [90, 180, '90.000000_180.000000'], [-90, -180, '-90.000000_-180.000000'],
    [' 12.3456789 ', '-45.1234567', '12.345679_-45.123457'],
    ['.000001', '-.000001', '0.000001_-0.000001'],
  ])('normalizes %s,%s and round-trips an exact six-decimal key', (lat, lng, key) => {
    const normalized = normalizeCoordinates(lat, lng);
    expect(coordsKey(lat, lng)).toBe(key);
    expect(parseCoordKey(key)).toEqual(normalized);
    expect(normalizeCoordinates(normalized.lat, normalized.lng)).toEqual(normalized);
  });
  test.each([undefined, null, '', ' ', true, false, [], [1], {}, NaN, Infinity, -Infinity, '1junk', '0x10', '1e2'])('rejects a coercible or invalid coordinate: %s', value => {
    expect(normalizeCoordinates(value, 0)).toBeNull();
    expect(normalizeCoordinates(0, value)).toBeNull();
  });
  test.each([[90.0000001, 0], [-90.0000001, 0], [0, 180.0000001], [0, -180.0000001]])('rejects out-of-range input before rounding: %j', (lat, lng) => {
    expect(normalizeCoordinates(lat, lng)).toBeNull();
  });
  test('adjacent six-decimal fixes do not share their cache key', () => {
    expect(coordsKey(0.000001, 0)).not.toBe(coordsKey(0.000002, 0));
  });
});

describe('measured GPS quality, separate from coordinate formatting', () => {
  const now = Date.parse('2026-09-13T04:00:00.000Z');
  const fix = () => ({ latitude: 0, longitude: 0, accuracy: 8, timestamp: now });
  test('fresh measured zero coordinates are valid', () => {
    expect(validateGpsFix(fix(), now)).toMatchObject({ ok: true, lat: 0, lng: 0, accuracy: 8, timestamp: now });
  });
  test.each([undefined, null, 0, -1, NaN, Infinity, '8', GPS_MAX_ACCURACY_METERS + 0.01])('rejects missing/coarse/invalid measured accuracy: %s', accuracy => {
    expect(validateGpsFix({ ...fix(), accuracy }, now).ok).toBe(false);
  });
  test('age and measured accuracy accept their inclusive limit, then refuse stale data', () => {
    expect(validateGpsFix({ ...fix(), accuracy: GPS_MAX_ACCURACY_METERS, timestamp: now - GPS_MAX_AGE_MS }, now).ok).toBe(true);
    expect(validateGpsFix({ ...fix(), timestamp: now - GPS_MAX_AGE_MS - 1 }, now).ok).toBe(false);
  });
  test.each([undefined, null, NaN, Infinity, now + 5001, '2026-09-13T04:00:00Z'])('rejects absent/malformed/future sensor time: %s', timestamp => {
    expect(validateGpsFix({ ...fix(), timestamp }, now).ok).toBe(false);
  });
});
