import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

// All provider and persistence boundaries are synthetic. No application DB loads.
const callModel = jest.fn(), findNearbyAirports = jest.fn(), fetchFAA = jest.fn(), writeSection = jest.fn();
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, matrixLog: log,
  createWorkflowLogger: () => log, OP: {} }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/location/airports.js', () => ({ findNearbyAirports, AIRPORT_RADIUS_MILES: 50 }));
jest.unstable_mockModule('../../server/lib/external/faa-asws.js', () => ({ fetchFAADelayData: fetchFAA }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  writeSectionAndNotify: writeSection, CHANNELS: { AIRPORT: 'synthetic_airport' },
  errorMarker: error => ({ _generationFailed: true, error: error.message }),
}));
const { discoverAirport } = await import('../../server/lib/briefing/pipelines/airport.js');
const args = { snapshotId: 'synthetic-airport-snapshot', snapshot: { lat: 0, lng: 0, timezone: 'Etc/UTC' } };
const airport = { iata: 'AAA', name: 'Synthetic airport', country: 'US', distance_miles: 1 };
const unknownFAA = { has_delays: null, closure_status: 'unknown', ground_stops: [], delay_minutes: null };
const conditions = { ok: true, output: JSON.stringify({ airports: [{ code: 'AAA', status: 'unreported', delays: 'unreported' }] }) };
const terminals = { ok: true, output: JSON.stringify({ airports: [{ code: 'AAA', terminals: [] }] }) };
const delayed = (value, ms) => new Promise(resolve => globalThis.setTimeout(() => resolve(value), ms));
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };

beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers();
  findNearbyAirports.mockResolvedValue([airport]); fetchFAA.mockResolvedValue(unknownFAA);
  writeSection.mockResolvedValue(undefined);
  callModel.mockResolvedValueOnce(conditions).mockResolvedValue(terminals);
});
afterEach(() => { jest.useRealTimers(); Object.assign(globalThis, realTimers); });

test('both phases share one five-minute deadline and late terminal output cannot publish success', async () => {
  callModel.mockReset();
  callModel.mockImplementationOnce(() => delayed(conditions, 200000));
  callModel.mockImplementationOnce(() => delayed(terminals, 150000));
  const pending = discoverAirport(args);
  await jest.advanceTimersByTimeAsync(200000);
  expect(callModel).toHaveBeenCalledTimes(2);
  const firstSignal = callModel.mock.calls[0][1].signal;
  expect(callModel.mock.calls[1][1].signal).toBe(firstSignal);
  await jest.advanceTimersByTimeAsync(99999);
  expect(firstSignal.aborted).toBe(false); expect(writeSection).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  const failed = await pending;
  expect(failed).toMatchObject({ reason: 'Airport research timed out after 300000ms',
    airport_conditions: { _generationFailed: true, isFallback: true, airports: [{
      code: 'AAA', status: 'unreported', conditionsSource: 'gemini-search', faa_closure_status: 'unknown',
    }] } });
  expect(firstSignal.aborted).toBe(true);
  expect(writeSection).toHaveBeenCalledTimes(1);
  expect(writeSection.mock.calls[0][1].airport_conditions).toMatchObject({ _generationFailed: true });
  await jest.advanceTimersByTimeAsync(50000);
  expect(writeSection).toHaveBeenCalledTimes(1); expect(callModel).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('a completed two-phase result within the shared budget clears its deadline', async () => {
  callModel.mockReset();
  callModel.mockImplementationOnce(() => delayed(conditions, 150000));
  callModel.mockImplementationOnce(() => delayed(terminals, 100000));
  const pending = discoverAirport(args);
  await jest.advanceTimersByTimeAsync(250000);
  expect((await pending).reason).toBeNull();
  expect(callModel).toHaveBeenCalledTimes(2); expect(writeSection).toHaveBeenCalledTimes(1);
  expect(writeSection.mock.calls[0][1].airport_conditions._generationFailed).toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
});

test('a deadline preserves known FAA advisories while failing the incomplete terminal section', async () => {
  fetchFAA.mockResolvedValueOnce({ has_delays: true, delay_minutes: 35, closure_status: 'restricted',
    delay_reason: 'Synthetic advisory', source_updated_at: '2026-10-12T03:00:00Z', ground_stops: [] });
  callModel.mockReset(); callModel.mockImplementation(() => new Promise(() => {}));
  const pending = discoverAirport(args);
  await jest.advanceTimersByTimeAsync(300000);
  expect(await pending).toMatchObject({ airport_conditions: { _generationFailed: true, isFallback: true,
    airports: [{ code: 'AAA', status: 'restricted', conditionsSource: 'faa',
      faa_delay_minutes: 35, faa_delay_reason: 'Synthetic advisory',
      faa_source_updated_at: '2026-10-12T03:00:00Z' }] } });
  expect(callModel).toHaveBeenCalledTimes(1);
  expect(writeSection).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a hung conditions phase expires without starting terminal research', async () => {
  callModel.mockReset(); callModel.mockImplementation(() => new Promise(() => {}));
  const pending = discoverAirport(args);
  await jest.advanceTimersByTimeAsync(180000);
  expect(callModel).toHaveBeenCalledTimes(1); expect(writeSection).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(120000);
  expect(await pending).toMatchObject({ reason: 'Airport research timed out after 300000ms',
    airport_conditions: { _generationFailed: true, isFallback: true, airports: [{ code: 'AAA' }] } });
  expect(callModel.mock.calls[0][1].signal.aborted).toBe(true);
  expect(callModel).toHaveBeenCalledTimes(1); expect(writeSection).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('caller cancellation as conditions return prevents terminal dispatch', async () => {
  const controller = new globalThis.AbortController();
  callModel.mockReset(); callModel.mockImplementationOnce(async () => {
    controller.abort(new Error('Synthetic generation superseded'));
    return conditions;
  });
  await expect(discoverAirport({ ...args, signal: controller.signal })).rejects.toThrow('Synthetic generation superseded');
  expect(callModel).toHaveBeenCalledTimes(1);
  expect(callModel.mock.calls[0][1].signal.aborted).toBe(true);
  expect(writeSection).toHaveBeenCalledTimes(1);
  expect(writeSection.mock.calls[0][1].airport_conditions._generationFailed).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('caller cancellation during terminals promptly rejects and discards their late result', async () => {
  const controller = new globalThis.AbortController();
  callModel.mockReset(); callModel.mockResolvedValueOnce(conditions);
  callModel.mockImplementationOnce(() => delayed(terminals, 200000));
  const rejected = expect(discoverAirport({ ...args, signal: controller.signal })).rejects.toThrow('Synthetic caller cancelled');
  await jest.advanceTimersByTimeAsync(50000);
  expect(callModel).toHaveBeenCalledTimes(2);
  controller.abort(new Error('Synthetic caller cancelled')); await rejected;
  expect(callModel.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  await jest.advanceTimersByTimeAsync(150000);
  expect(writeSection).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test('a cancelled generation never starts catalog, FAA or model work', async () => {
  const controller = new globalThis.AbortController(); controller.abort(new Error('Synthetic already cancelled'));
  await expect(discoverAirport({ ...args, signal: controller.signal })).rejects.toThrow('Synthetic already cancelled');
  expect(findNearbyAirports).not.toHaveBeenCalled(); expect(fetchFAA).not.toHaveBeenCalled();
  expect(callModel).not.toHaveBeenCalled(); expect(writeSection).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a late catalog read after expiry cannot start FAA or model requests', async () => {
  findNearbyAirports.mockImplementationOnce(() => delayed([airport], 310000));
  const pending = discoverAirport(args);
  await jest.advanceTimersByTimeAsync(300000);
  expect(await pending).toMatchObject({ airport_conditions: { _generationFailed: true },
    reason: 'Airport research timed out after 300000ms' });
  await jest.advanceTimersByTimeAsync(10000);
  expect(fetchFAA).not.toHaveBeenCalled(); expect(callModel).not.toHaveBeenCalled();
  expect(writeSection).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test('cancelling during the shared FAA read prevents both model phases', async () => {
  const controller = new globalThis.AbortController(); fetchFAA.mockImplementationOnce(() => delayed(unknownFAA, 10000));
  const rejected = expect(discoverAirport({ ...args, signal: controller.signal })).rejects.toThrow('Synthetic generation replaced');
  await jest.advanceTimersByTimeAsync(1000);
  expect(fetchFAA).toHaveBeenCalledTimes(1);
  controller.abort(new Error('Synthetic generation replaced')); await rejected;
  await jest.advanceTimersByTimeAsync(9000);
  expect(callModel).not.toHaveBeenCalled(); expect(writeSection).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
