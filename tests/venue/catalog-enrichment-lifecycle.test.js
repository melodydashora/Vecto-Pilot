import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const updates = [];
let persistenceGate, persistenceStarted;
const venue = { venue_id: 'venue-one', place_id: 'provider-one', venue_name: 'Fixture Hall', address: '123 Fixture Street',
  // Complete identity isolates these detached-Details tests from awaited identity repair.
  formatted_address: '123 Fixture Street', lat: 1, lng: 2, city: 'Fixture City', state: 'AA', country: 'CA', timezone: 'Etc/UTC' };
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [venue] }) }) }),
  update: () => ({ set: value => ({ where: async () => {
    updates.push(value);
    if (value.phone_number && persistenceGate) {
      persistenceStarted.resolve(); await persistenceGate.promise;
    }
  } }) }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: jest.fn(), resolveTimezoneFromCoords: jest.fn() }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: jest.fn() }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { findOrCreateVenue, enrichVenueFromPlaceId: enrich } = await import('../../server/lib/venue/venue-cache.js');
const originalFetch = global.fetch;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = phone => ({ ok: true, json: async () => ({ nationalPhoneNumber: phone }) });
const stored = () => updates.filter(update => update.phone_number);
beforeEach(() => { updates.length = 0; persistenceGate = persistenceStarted = null; global.fetch = jest.fn(async () => response('fixture')); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test('non-ChIJ cached IDs receive backfill and simultaneous event links share one pending operation', async () => {
  const request = deferred(); global.fetch = jest.fn(() => request.promise);
  const input = { venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', placeId: 'provider-one', latitude: 1, longitude: 2 };
  const results = await Promise.all([findOrCreateVenue(input, 'fixture'), findOrCreateVenue(input, 'fixture'), findOrCreateVenue(input, 'fixture')]);
  expect(results.every(result => result.venue_id === venue.venue_id)).toBe(true);
  const backfillRequests = global.fetch.mock.calls.length;
  request.resolve(response('backfilled'));
  // Join detached work before teardown; this also proves the exported contract
  // and background path share the same pending operation.
  await enrich(venue.venue_id, venue.place_id);
  expect(backfillRequests).toBe(1); expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(stored()).toHaveLength(1);
});
test('concurrent explicit enrichment shares work through persistence, then a later attempt is fresh', async () => {
  const request = deferred(); global.fetch = jest.fn(() => request.promise);
  const a = enrich('venue-one', 'provider-one'), b = enrich('venue-one', 'provider-one');
  await Promise.resolve();
  const count = global.fetch.mock.calls.length;
  request.resolve(response('first')); await Promise.all([a, b]);
  expect(count).toBe(1); expect(stored()).toHaveLength(1);
  global.fetch.mockResolvedValue(response('fresh'));
  await enrich('venue-one', 'provider-one');
  expect(global.fetch).toHaveBeenCalledTimes(2); expect(stored().at(-1).phone_number).toBe('fresh');
});
test('different venue/provider pairs do not share persistence', async () => {
  await Promise.all([enrich('venue-one', 'provider-one'), enrich('venue-two', 'provider-two')]);
  expect(global.fetch).toHaveBeenCalledTimes(2); expect(stored()).toHaveLength(2);
});
test('an event linking while Details persistence is pending joins the existing write', async () => {
  persistenceGate = deferred(); persistenceStarted = deferred();
  const first = enrich('venue-one', 'provider-one');
  await persistenceStarted.promise;
  const second = enrich('venue-one', 'provider-one'); await Promise.resolve();
  const callsBeforeCommit = global.fetch.mock.calls.length;
  persistenceGate.resolve(); await Promise.all([first, second]);
  expect(callsBeforeCommit).toBe(1); expect(stored()).toHaveLength(1);
});
test('HTTP failures release shared work so retry can recover', async () => {
  const request = deferred(); global.fetch = jest.fn(() => request.promise);
  const a = enrich('venue-one', 'provider-one'), b = enrich('venue-one', 'provider-one');
  const failures = Promise.allSettled([a, b]);
  request.resolve({ ok: false, status: 503, text: async () => 'fixture unavailable' });
  expect((await failures).map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(global.fetch).toHaveBeenCalledTimes(1); expect(stored()).toHaveLength(0);
  global.fetch.mockResolvedValue(response('recovered')); await enrich('venue-one', 'provider-one');
  expect(global.fetch).toHaveBeenCalledTimes(2); expect(stored()).toHaveLength(1);
});
test('deadline rejects an uncooperative fetch, aborts it and prevents its late response from overwriting retry', async () => {
  jest.useFakeTimers(); const old = deferred(); let signal;
  global.fetch = jest.fn((_url, options) => { signal = options.signal; return old.promise; });
  const first = enrich('venue-one', 'provider-one');
  const outcomes = []; first.then(() => outcomes.push('resolved'), error => outcomes.push(error.code));
  await jest.advanceTimersByTimeAsync(15000);
  // Settle the old transport on RED as well, avoiding leaked test promises.
  const aborted = signal?.aborted; const deadlineOutcome = [...outcomes];
  global.fetch.mockResolvedValue(response('fresh')); await enrich('venue-one', 'provider-one');
  old.resolve(response('stale')); await Promise.allSettled([first]); await Promise.resolve();
  expect(deadlineOutcome).toEqual(['upstream_timeout']); expect(aborted).toBe(true);
  expect(stored().map(update => update.phone_number)).toEqual(['fresh']);
  expect(jest.getTimerCount()).toBe(0);
});
test('provider body parsing has the same deadline and cannot publish after expiry', async () => {
  jest.useFakeTimers(); const body = deferred();
  global.fetch = jest.fn(async () => ({ ok: true, json: () => body.promise }));
  const result = enrich('venue-one', 'provider-one');
  const outcomes = []; result.then(() => outcomes.push('resolved'), error => outcomes.push(error.code));
  await jest.advanceTimersByTimeAsync(15000);
  const deadlineOutcome = [...outcomes]; body.resolve({ nationalPhoneNumber: 'too late' });
  await Promise.allSettled([result]); await Promise.resolve();
  expect(deadlineOutcome).toEqual(['upstream_timeout']); expect(stored()).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});
