import { describe, test, expect } from '@jest/globals';
import { normalizeCoordinates, validateGpsFix, GPS_MAX_AGE_MS, GPS_MAX_ACCURACY_METERS } from '../../shared/coordinates.js';
import { coordsKey, parseCoordKey } from '../../server/lib/location/coords-key.js';

describe('canonical coordinate boundary', () => {
  test.each([
    [0, 0, '0.000000_0.000000'], [-0, 0, '0.000000_0.000000'],
    [90, 180, '90.000000_180.000000'], [-90, -180, '-90.000000_-180.000000'],
    [' 12.3456789 ', '-45.1234567', '12.345679_-45.123457'],
    ['.000001', '-.000001', '0.000001_-0.000001'],
  ])('preserves %s,%s while producing the six-decimal lookup key', (lat, lng, key) => {
    const normalized = normalizeCoordinates(lat, lng);
    expect(coordsKey(lat, lng)).toBe(key);
    expect(coordsKey(parseCoordKey(key).lat, parseCoordKey(key).lng)).toBe(key);
    expect(normalized).toEqual({ lat: Number(lat) || 0, lng: Number(lng) || 0 });
    expect(normalizeCoordinates(normalized.lat, normalized.lng)).toEqual(normalized);
  });
  test.each([undefined, null, '', ' ', true, false, [], [1], {}, NaN, Infinity, -Infinity, '1junk', '0x10', '1e999', '1e-7junk'])('rejects a coercible or invalid coordinate: %s', value => {
    expect(normalizeCoordinates(value, 0)).toBeNull();
    expect(normalizeCoordinates(0, value)).toBeNull();
  });
  test.each([[90.0000001, 0], [-90.0000001, 0], [0, 180.0000001], [0, -180.0000001]])('rejects out-of-range input before rounding: %j', (lat, lng) => {
    expect(normalizeCoordinates(lat, lng)).toBeNull();
  });
  test('adjacent six-decimal fixes do not share their cache key', () => {
    expect(coordsKey(0.000001, 0)).not.toBe(coordsKey(0.000002, 0));
  });
  test('lookup-key equality never discards extra measured digits', () => {
    const first = normalizeCoordinates(1.12345671, 2.12345671);
    const second = normalizeCoordinates(1.12345679, 2.12345679);
    expect(coordsKey(first.lat, first.lng)).toBe(coordsKey(second.lat, second.lng));
    expect(first).not.toEqual(second);
  });
  test('URL-serialized tiny readings retain their precision while overflow and bounds still fail', () => {
    expect(normalizeCoordinates(String(0.000000123456789), String(-0.000000987654321)))
      .toEqual({ lat: 0.000000123456789, lng: -0.000000987654321 });
    expect(normalizeCoordinates('1e2', 0)).toBeNull();
    expect(normalizeCoordinates(0, '2e2')).toBeNull();
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
