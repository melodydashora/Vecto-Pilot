import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const callModel = jest.fn();
const findNearbyAirports = jest.fn();
const fetchFAA = jest.fn();
const writeSection = jest.fn();
const log = { warn: jest.fn(), done: jest.fn(), info: jest.fn(), error: jest.fn() };

jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  briefingLog: log, matrixLog: log, OP: { AI: 'AI', FALLBACK: 'FALLBACK' }
}));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/location/airports.js', () => ({ findNearbyAirports, AIRPORT_RADIUS_MILES: 50 }));
jest.unstable_mockModule('../../server/lib/external/faa-asws.js', () => ({ fetchFAADelayData: fetchFAA }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  writeSectionAndNotify: writeSection, CHANNELS: { AIRPORT: 'test_airport' },
  errorMarker: error => ({ error: true, reason: error.message })
}));
jest.unstable_mockModule('../../server/lib/briefing/shared/safe-json-parse.js', () => ({ safeJsonParse: JSON.parse }));
const { discoverAirport } = await import('../../server/lib/briefing/pipelines/airport.js');

const args = { snapshotId: 'synthetic-snapshot', snapshot: { lat: 0, lng: 0, timezone: 'UTC' } };
const airport = { iata: 'AAA', name: 'Synthetic airport', distance_miles: 2, country: 'US' };
beforeEach(() => {
  jest.resetAllMocks();
  writeSection.mockResolvedValue(undefined);
  findNearbyAirports.mockResolvedValue([airport]);
  fetchFAA.mockResolvedValue({ airport_code: 'AAA', delay_minutes: null, closure_status: 'unknown',
    supported: false, delay_reason: 'FAA ASWS does not cover this airport', source_updated_at: 'source time', fetched_at: 'fetch time' });
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify({ airports: [{ code: 'AAA', status: 'unreported' }] }) });
});

describe('FAA failure is a Briefing failure before airport model dispatch', () => {
  test('persists a reason and throws without calling the model when FAA fails', async () => {
    fetchFAA.mockRejectedValue(new Error('FAA status returned HTTP 503'));
    await expect(discoverAirport(args)).rejects.toThrow('HTTP 503');
    expect(callModel).not.toHaveBeenCalled();
    expect(fetchFAA).toHaveBeenCalledWith('AAA', { strict: true });
    expect(writeSection).toHaveBeenCalledWith('synthetic-snapshot', {
      airport_conditions: { error: true, reason: 'FAA status returned HTTP 503' }
    }, 'test_airport');
  });

  test('retains unknown coverage and source time without inventing zero/open', async () => {
    const result = await discoverAirport(args);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      faa_delay_minutes: null, faa_closure_status: 'unknown', faa_supported: false,
      faa_delay_reason: 'FAA ASWS does not cover this airport', faa_source_updated_at: 'source time'
    });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test('marks partial airport model response as failed instead of completing missing cards', async () => {
    findNearbyAirports.mockResolvedValue([airport, { ...airport, iata: 'BBB' }]);
    const result = await discoverAirport(args);
    expect(result.airport_conditions.isFallback).toBe(true);
    expect(result.reason).toMatch(/omitted requested airports: BBB/);
  });

  test('accepts verified geographic emptiness without calling FAA or a model', async () => {
    findNearbyAirports.mockResolvedValue([]);
    const result = await discoverAirport(args);
    expect(result.airport_conditions.verifiedEmpty).toBe(true);
    expect(result.reason).toMatch(/verified/);
    expect(fetchFAA).not.toHaveBeenCalled();
    expect(callModel).not.toHaveBeenCalled();
  });

  test('does not call US-only FAA service for an international airport', async () => {
    findNearbyAirports.mockResolvedValue([{ ...airport, country: 'CA' }]);
    await discoverAirport(args);
    expect(fetchFAA).not.toHaveBeenCalled();
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});
