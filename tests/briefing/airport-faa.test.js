import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { briefingSectionIssue } from '../../server/lib/briefing/briefing-readiness.js';
import { formatAirportContext } from '../../server/lib/briefing/shared/format-airport-context.js';

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
const { discoverAirport } = await import('../../server/lib/briefing/pipelines/airport.js');

const args = { snapshotId: 'synthetic-snapshot', snapshot: { lat: 0, lng: 0, timezone: 'UTC' } };
const airport = { iata: 'AAA', name: 'Synthetic airport', distance_miles: 2, country: 'US' };
const sourceTime = '2026-10-05T09:30:00Z';
const fetchedTime = '2026-10-05T09:35:00Z';
const jsonResult = body => ({ ok: true, output: JSON.stringify(body) });
const condition = (code = 'AAA', changes = {}) => ({ code, status: 'unreported', delays: 'unreported', ...changes });
const terminalResult = (codes = ['AAA']) => jsonResult({ airports: codes.map(code => ({ code, terminals: [] })) });
const unknownFAA = () => ({ airport_code: 'AAA', delay_minutes: null, has_delays: null,
  closure_status: 'unknown', supported: null, ground_stops: [],
  delay_reason: 'No FAA airport events are listed; normal operations are not verified.',
  source_updated_at: null, fetched_at: fetchedTime });
const normalFAA = () => ({ airport_code: 'AAA', delay_minutes: 0, has_delays: false,
  closure_status: 'open', supported: true, ground_stops: [],
  delay_reason: 'FAA explicitly reports no delays.', source_updated_at: sourceTime, fetched_at: fetchedTime });
function expectFailed(result) {
  expect(result.airport_conditions.isFallback).toBe(true);
  expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).not.toBeNull();
  expect(writeSection).toHaveBeenCalledTimes(1);
}
beforeEach(() => {
  jest.resetAllMocks();
  writeSection.mockResolvedValue(undefined);
  findNearbyAirports.mockResolvedValue([airport]);
  fetchFAA.mockResolvedValue(normalFAA());
  callModel.mockResolvedValue(terminalResult());
});

describe('FAA-first conditions and separate terminal research', () => {
  test('reconstructs citation-wrapped conditions and terminal JSON without altering either source', async () => {
    fetchFAA.mockResolvedValue(unknownFAA());
    const recommendations = 'Wait at { curb; read [policy](https://example.test/policy).';
    callModel.mockResolvedValueOnce({ ok: true, output: '[1]\n' + JSON.stringify({
      airports: [condition('AAA', { status: 'normal', delays: 'Keep literal \\n in this note' })]
    }) + '\n[2]' });
    callModel.mockResolvedValueOnce({ ok: true, output: '[1]\n' + JSON.stringify({
      airports: [{ code: 'AAA', terminals: [] }], recommendations
    }) + '\n[2]' });
    const result = await discoverAirport(args);
    expect(result.airport_conditions.isFallback).not.toBe(true);
    expect(result.airport_conditions.recommendations).toBe(recommendations);
    expect(result.airport_conditions.airports[0].delays).toBe('Keep literal \\n in this note');
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(writeSection).toHaveBeenCalledWith('synthetic-snapshot', {
      airport_conditions: result.airport_conditions
    }, 'test_airport');
  });

  test('keeps malformed terminal siblings failed instead of publishing partial research', async () => {
    callModel.mockResolvedValue({ ok: true, output: '{"airports":[{"code":"AAA"},{"code":}]}' });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.reason).toMatch(/unparseable or truncated/);
  });

  test('uses one terminal call after explicit FAA conditions and ignores replacement conditions in its output', async () => {
    callModel.mockResolvedValue(jsonResult({ airports: [condition('AAA', {
      status: 'closed', delays: 'Conflicting later terminal response', conditionsSource: 'gemini-search',
      terminals: [{ terminal: 'A', ridesharePickup: 'Arrivals curb', checkpoints: [] }]
    })] }));
    const result = await discoverAirport(args);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0][0]).toBe('BRIEFING_AIRPORT');
    expect(callModel.mock.calls[0][1].system).toMatch(/Do not re-fetch, re-research, correct or replace/);
    expect(callModel.mock.calls[0][1].user).toContain('FIXED AIRPORT CONDITIONS');
    expect(callModel.mock.calls[0][1].user).toContain('"status":"normal"');
    expect(callModel.mock.calls[0][1].user).toContain('"conditionsSource":"faa"');
    expect(result.airport_conditions.airports[0]).toMatchObject({
      status: 'normal', delays: 'FAA explicitly reports no delays.', conditionsSource: 'faa',
      terminals: [{ terminal: 'A', ridesharePickup: 'Arrivals curb' }],
      faa_delay_minutes: 0, faa_has_delays: false,
      faa_source_updated_at: sourceTime, faa_fetched_at: fetchedTime
    });
    expect(formatAirportContext(result.airport_conditions)).toContain('"conditionsSource":"faa"');
    expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).toBeNull();
  });

  test.each([
    ['delay without minutes', { has_delays: true }, 'delayed'],
    ['positive delay despite a conflicting no-delay flag', { has_delays: false, delay_minutes: 35 }, 'delayed'],
    ['ground stop', { ground_stops: [{ reason: 'Weather', end_time: '2026-10-05T11:00:00Z' }] }, 'ground-stop'],
    ['scoped restriction', { closure_status: 'restricted', has_delays: null }, 'restricted'],
    ['closure', { closure_status: 'closed' }, 'closed'],
    ['concurrent stop and scoped restriction', { ground_stops: [{ reason: 'Weather' }], closure_status: 'restricted' }, 'ground-stop'],
  ])('preserves FAA %s and uses only the terminal call', async (_name, facts, status) => {
    const faa = { ...unknownFAA(), ...facts, delay_reason: 'Exact observed FAA advisory.' };
    fetchFAA.mockResolvedValue(faa);
    callModel.mockResolvedValue(jsonResult({ airports: [condition('AAA', { status: 'normal', delays: 'Terminal model optimism' })] }));
    const result = await discoverAirport(args);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      status, delays: 'Exact observed FAA advisory.', conditionsSource: 'faa',
      faa_delay_minutes: faa.delay_minutes, faa_has_delays: faa.has_delays,
      faa_closure_status: faa.closure_status, faa_ground_stops: faa.ground_stops,
    });
    expect(callModel.mock.calls[0][1].user).toContain('Exact observed FAA advisory.');
    expect(result.reason).toBeNull();
  });

  test('researches missing conditions before terminals when FAA is unavailable, without inventing FAA facts', async () => {
    fetchFAA.mockRejectedValue(new Error('FAA status returned HTTP 503'));
    callModel.mockResolvedValueOnce(jsonResult({ airports: [
      condition('AAA', { status: 'delayed', delays: 'Current airport advisory reports delays.' })
    ] }));
    callModel.mockResolvedValueOnce(jsonResult({ airports: [condition('AAA', {
      status: 'normal', delays: 'Do not overwrite the resolved delay', conditionsSource: 'faa', terminals: []
    })] }));
    const result = await discoverAirport(args);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[0][1].user).toContain('Airport conditions fallback');
    expect(callModel.mock.calls[1][1].user).toContain('FIXED AIRPORT CONDITIONS');
    expect(callModel.mock.calls[1][1].user).toContain('Current airport advisory reports delays.');
    expect(fetchFAA).toHaveBeenCalledWith('AAA', { strict: true });
    expect(result.reason).toBeNull();
    expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).toBeNull();
    expect(result.airport_conditions.airports[0]).toMatchObject({
      status: 'delayed', delays: 'Current airport advisory reports delays.', conditionsSource: 'gemini-search',
      faa_delay_minutes: null, faa_has_delays: null, faa_closure_status: 'unknown',
      faa_supported: null, faa_source_updated_at: null, faa_fetched_at: null,
      faa_delay_reason: 'FAA live status unavailable; see the separate airport conditions source.'
    });
    expect(result.airport_conditions.airports[0]).not.toHaveProperty('faa_ground_stops');
    expect(formatAirportContext(result.airport_conditions)).toContain('"conditionsSource":"gemini-search"');
    expect(writeSection).toHaveBeenCalledWith('synthetic-snapshot', {
      airport_conditions: result.airport_conditions
    }, 'test_airport');
  });

  test('waits for FAA before deciding whether Gemini conditions research is necessary', async () => {
    let releaseFAA;
    fetchFAA.mockImplementation(() => new Promise(resolve => { releaseFAA = resolve; }));
    const pending = discoverAirport(args);
    await nextTurn();
    try {
      expect(callModel).not.toHaveBeenCalled();
    } finally {
      releaseFAA(normalFAA());
    }
    const result = await pending;
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.airport_conditions.airports[0].conditionsSource).toBe('faa');
  });

  test('waits for fallback conditions before starting terminal research', async () => {
    fetchFAA.mockResolvedValue(unknownFAA());
    let releaseConditions;
    callModel.mockImplementationOnce(() => new Promise(resolve => { releaseConditions = resolve; }));
    const pending = discoverAirport(args);
    await nextTurn();
    try {
      expect(callModel).toHaveBeenCalledTimes(1);
      expect(writeSection).not.toHaveBeenCalled();
    } finally {
      releaseConditions(jsonResult({ airports: [condition()] }));
    }
    await pending;
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  test('keeps the section failed when terminal research fails even if FAA succeeds', async () => {
    callModel.mockResolvedValue({ ok: false, error: 'Research provider unavailable' });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.reason).toContain('BRIEFING_AIRPORT role call failed');
    expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).not.toBeNull();
  });

  test('retains observed FAA ground-stop facts when terminal research fails without marking Briefing ready', async () => {
    fetchFAA.mockResolvedValue({ ...unknownFAA(), has_delays: true, closure_status: 'ground-stop',
      delay_reason: 'FAA reports a weather ground stop.',
      ground_stops: [{ reason: 'Weather', end_time: '2026-10-05T11:00:00Z' }] });
    callModel.mockResolvedValue({ ok: false, error: 'Terminal research unavailable' });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      status: 'ground-stop', delays: 'FAA reports a weather ground stop.', conditionsSource: 'faa',
      faa_has_delays: true, faa_closure_status: 'ground-stop',
      faa_ground_stops: [{ reason: 'Weather', end_time: '2026-10-05T11:00:00Z' }]
    });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test('retains one airport FAA conditions when another airport conditions fallback fails', async () => {
    findNearbyAirports.mockResolvedValue([airport, { ...airport, iata: 'BBB' }]);
    fetchFAA.mockImplementation(code => Promise.resolve(code === 'AAA'
      ? { ...unknownFAA(), has_delays: true, closure_status: 'ground-stop',
        delay_reason: 'FAA reports a weather ground stop.', ground_stops: [{ reason: 'Weather' }] }
      : { ...unknownFAA(), airport_code: 'BBB' }));
    callModel.mockResolvedValue({ ok: false, error: 'Conditions research unavailable' });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      code: 'AAA', status: 'ground-stop', conditionsSource: 'faa',
      faa_has_delays: true, faa_ground_stops: [{ reason: 'Weather' }]
    });
    expect(result.airport_conditions.airports[1]).toMatchObject({ code: 'BBB', status: 'unknown' });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0][1].user).not.toContain('AAA');
  });

  test('limits fallback to missing airports, then supplies all frozen conditions to terminal research', async () => {
    findNearbyAirports.mockResolvedValue([airport, { ...airport, iata: 'BBB' }]);
    fetchFAA.mockImplementation(code => code === 'AAA'
      ? Promise.reject(new Error('FAA status returned HTTP 503'))
      : Promise.resolve({ ...normalFAA(), airport_code: 'BBB' }));
    callModel.mockResolvedValueOnce(jsonResult({ airports: [condition()] }));
    callModel.mockResolvedValueOnce(terminalResult(['AAA', 'BBB']));
    const result = await discoverAirport(args);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[0][1].user).toContain('AAA (Synthetic airport');
    expect(callModel.mock.calls[0][1].user).not.toContain('BBB');
    expect(callModel.mock.calls[1][1].user).toContain('AAA (Synthetic airport');
    expect(callModel.mock.calls[1][1].user).toContain('BBB (Synthetic airport');
    expect(result.airport_conditions.airports[0].faa_supported).toBeNull();
    expect(result.airport_conditions.airports[1]).toMatchObject({
      faa_delay_minutes: 0, faa_has_delays: false, faa_closure_status: 'open', faa_supported: true,
      faa_source_updated_at: sourceTime, faa_fetched_at: fetchedTime, conditionsSource: 'faa'
    });
    expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).toBeNull();
  });

  test.each([
    ['absent FAA advisory', unknownFAA()],
    ['deicing-only report', { ...unknownFAA(), delay_reason: 'FAA deicing reported; delay duration is unknown.' }],
    ['null FAA response', null],
  ])('uses fallback for %s rather than manufacturing a normal condition', async (_name, faa) => {
    fetchFAA.mockResolvedValue(faa);
    callModel.mockResolvedValueOnce(jsonResult({ airports: [condition()] }));
    const result = await discoverAirport(args);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      status: 'unreported', delays: 'unreported', conditionsSource: 'gemini-search',
      faa_delay_minutes: null, faa_has_delays: null, faa_closure_status: 'unknown', faa_supported: null,
      faa_source_updated_at: null
    });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(briefingSectionIssue('airport_conditions', result.airport_conditions)).toBeNull();
  });

  test('does not start terminal research after a failed conditions fallback', async () => {
    fetchFAA.mockResolvedValue(unknownFAA());
    callModel.mockResolvedValue({ ok: false, error: 'Research provider unavailable' });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.reason).toContain('Airport conditions fallback failed');
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['malformed JSON', '{"airports":[{"code":"AAA"},{"code":}]}'],
    ['missing list', '{}'],
    ['empty list', '{"airports":[]}'],
    ['mismatched airport', JSON.stringify({ airports: [condition('BBB')] })],
    ['extra airport', JSON.stringify({ airports: [condition(), condition('BBB')] })],
    ['invalid status', JSON.stringify({ airports: [condition('AAA', { status: 'optimistic' })] })],
    ['blank advisory', JSON.stringify({ airports: [condition('AAA', { delays: '   ' })] })],
    ['missing advisory', JSON.stringify({ airports: [{ code: 'AAA', status: 'normal' }] })],
  ])('fails closed for %s in the conditions fallback', async (_name, output) => {
    fetchFAA.mockResolvedValue(unknownFAA());
    callModel.mockResolvedValue({ ok: true, output });
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test('rejects duplicate fallback identities instead of completing a missing airport', async () => {
    findNearbyAirports.mockResolvedValue([airport, { ...airport, iata: 'BBB' }]);
    fetchFAA.mockResolvedValue(unknownFAA());
    callModel.mockResolvedValue(jsonResult({ airports: [condition(), condition()] }));
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test('marks a partial terminal response as failed instead of completing missing cards', async () => {
    findNearbyAirports.mockResolvedValue([airport, { ...airport, iata: 'BBB' }]);
    const result = await discoverAirport(args);
    expectFailed(result);
    expect(result.reason).toMatch(/omitted requested airports: BBB/);
  });

  test('carries concurrent FAA ground-stop and scoped-restriction times through the saved section', async () => {
    fetchFAA.mockResolvedValue({ airport_code: 'AAA', delay_minutes: null, has_delays: true,
      ground_stops: [{ reason: 'Synthetic weather', end_time: '2026-10-05T18:00:00Z' }],
      closure_status: 'restricted', closure_start: '2026-10-05T17:00:00Z', closure_end: '2026-10-05T19:00:00Z',
      supported: true, source_updated_at: sourceTime, fetched_at: fetchedTime });
    callModel.mockResolvedValue({ ok: true, output: JSON.stringify({ airports: [{ code: 'AAA', status: 'normal' }] }) });
    const result = await discoverAirport(args);
    expect(result.airport_conditions.airports[0]).toMatchObject({
      faa_delay_minutes: null, faa_has_delays: true,
      faa_ground_stops: [{ reason: 'Synthetic weather', end_time: '2026-10-05T18:00:00Z' }],
      faa_closure_status: 'restricted', faa_closure_start: '2026-10-05T17:00:00Z', faa_closure_end: '2026-10-05T19:00:00Z',
      faa_source_updated_at: sourceTime, faa_fetched_at: fetchedTime, status: 'ground-stop', conditionsSource: 'faa'
    });
  });

  test('catalog absence remains unknown coverage instead of verified geographic emptiness', async () => {
    findNearbyAirports.mockResolvedValue([]);
    const result = await discoverAirport(args);
    expect(result.airport_conditions.verifiedEmpty).toBe(false);
    expect(result.airport_conditions.isFallback).toBe(true);
    expect(result.airport_conditions.coverage).toBe('unknown');
    expect(result.reason).toMatch(/catalog.*coverage/i);
    expect(fetchFAA).not.toHaveBeenCalled();
    expect(callModel).not.toHaveBeenCalled();
  });

  test('does not call US-only FAA service for an international airport', async () => {
    findNearbyAirports.mockResolvedValue([{ ...airport, country: 'CA' }]);
    callModel.mockResolvedValueOnce(jsonResult({ airports: [condition()] }));
    const result = await discoverAirport(args);
    expect(fetchFAA).not.toHaveBeenCalled();
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result.airport_conditions.airports[0].conditionsSource).toBe('gemini-search');
    expect(result.airport_conditions.airports[0]).not.toHaveProperty('faa_has_delays');
  });
});
