import { describe, test, expect } from '@jest/globals';
import { latLngToCell } from 'h3-js';
import { coordsKey } from '../../server/lib/location/coords-key.js';
import { getSnapshotReadiness, assertSnapshotReady, SNAPSHOT_REQUIRED_FIELDS, getSnapshotEnrichmentErrors } from '../../server/lib/location/snapshot-readiness.js';
import { completeSnapshot as readySnapshot } from '../fixtures/complete-snapshot.js';

describe('complete persisted snapshot boundary', () => {
  test('all 22 required fields are checked and midnight, Sunday, zero coordinates/temperature/AQI stay valid', () => {
    const row = readySnapshot();
    expect(SNAPSHOT_REQUIRED_FIELDS).toHaveLength(22);
    expect(row).toMatchObject({ hour: 0, dow: 0, lat: 0, lng: 0 });
    expect(getSnapshotReadiness(row, row.snapshot_id)).toMatchObject({ ready: true, missingFields: [] });
    expect(assertSnapshotReady(row, row.snapshot_id)).toBe(row);
  });
  test.each(SNAPSHOT_REQUIRED_FIELDS)('removing %s blocks readiness despite stored status ok', field => {
    const row = readySnapshot();
    delete row[field];
    const result = getSnapshotReadiness(row, row.snapshot_id);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain(field);
    expect(() => assertSnapshotReady(row, row.snapshot_id)).toThrow(/Snapshot is not complete/);
  });
  test.each(['pending', 'failed', null, undefined])('data alone does not override stored status=%s', status => {
    const row = { ...readySnapshot(), status };
    expect(getSnapshotReadiness(row).ready).toBe(false);
    expect(getSnapshotReadiness(row, row.snapshot_id, { requireStatus: false }).ready).toBe(true);
  });
  test.each(['city', 'state', 'country', 'formatted_address', 'market', 'snapshot_id', 'session_id', 'user_id'])('whitespace %s is not complete', field => {
    expect(getSnapshotReadiness({ ...readySnapshot(), [field]: '  ' }).ready).toBe(false);
  });
  test.each([
    ['lat', 90.000001], ['lng', 180.000001], ['lat', '0'], ['lat', 0.1234567],
    ['hour', 24], ['hour', 0.5], ['dow', 7], ['dow', -1], ['timezone', 'not/a-zone'],
    ['created_at', 'invalid-date'], ['local_iso', 'invalid-date'], ['day_part_key', 'unknown'],
  ])('invalid %s=%s cannot become ready', (field, value) => {
    expect(getSnapshotReadiness({ ...readySnapshot(), [field]: value }).ready).toBe(false);
  });
  test('cross-coordinate key/H3 and different snapshot identity are rejected', () => {
    const row = readySnapshot();
    expect(getSnapshotReadiness(row, 'different-snapshot').missingFields).toContain('snapshot_id');
    expect(getSnapshotReadiness({ ...row, coord_key: coordsKey(1, 1) }).missingFields).toContain('coord_key');
    expect(getSnapshotReadiness({ ...row, h3_r8: latLngToCell(1, 1, 8) }).missingFields).toContain('h3_r8');
  });
  test.each([
    { hour: 1 }, { dow: 1 }, { date: '2026-09-12' }, { day_part_key: 'morning' },
    { local_iso: new Date('2026-09-13T04:00:00.000Z') },
  ])('time fields must describe the same creation instant and resolved timezone: %j', wrong => {
    expect(getSnapshotReadiness({ ...readySnapshot(), ...wrong }).ready).toBe(false);
  });
  test.each(['UTC', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles'])('valid timezone boundary %s derives a coherent row', timezone => {
    const row = readySnapshot({ timezone, createdAt: '2026-09-13T00:10:00.000Z' });
    expect(getSnapshotReadiness(row).ready).toBe(true);
  });
  test.each([
    { weather: {} }, { weather: { tempF: 4, conditions: '' } }, { weather: { tempF: '4', conditions: 'Clear' } },
    { weather: { tempF: 4, conditions: 'Clear', _generationFailed: true } },
    { air: {} }, { air: { aqi: -1, category: 'Good' } }, { air: { aqi: 0, category: 'Good', isFallback: true } },
    { permissions: {} }, { permissions: { geolocation: 'denied' } },
  ])('empty/failed/fallback enrichment or ungranted permission blocks readiness: %j', invalid => {
    expect(getSnapshotReadiness({ ...readySnapshot(), ...invalid }).ready).toBe(false);
  });
  test('partial enrichment validation omits only sections not supplied, not empty supplied sections', () => {
    expect(getSnapshotEnrichmentErrors({ weather: { tempF: 0, conditions: 'Clear' } })).toEqual([]);
    expect(getSnapshotEnrichmentErrors({ weather: null, air: {} })).toEqual(['weather', 'air']);
  });
  test.each(['missing', 'other coordinate', 'old fetch', 'old observation', 'future observation', 'other provider'])('unverified environment (%s) cannot unlock saved status ok', problem => {
    const row = readySnapshot();
    if (problem === 'missing') delete row.weather.source;
    if (problem === 'other coordinate') row.weather.source.coord_key = coordsKey(1, 2);
    if (problem === 'old fetch') row.weather.source.fetched_at = new Date(row.created_at.getTime() - 60_001).toISOString();
    if (problem === 'old observation') row.weather.source.observed_at = new Date(row.created_at.getTime() - 31 * 60_000).toISOString();
    if (problem === 'future observation') row.weather.source.observed_at = new Date(row.created_at.getTime() + 60_000).toISOString();
    if (problem === 'other provider') row.weather.source.provider = 'browser';
    expect(getSnapshotReadiness(row).missingFields).toContain('weather');
  });
});
