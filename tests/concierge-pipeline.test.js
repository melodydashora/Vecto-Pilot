import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { discovered_events, venue_catalog } from '../shared/schema.js';

let rows, failVenues;
const writes = jest.fn();
const db = {
  transaction: async write => write(db),
  execute: async () => ({ rows: [] }),
  select: () => ({ from: table => {
    const query = { innerJoin: () => query, where: () => query, limit: async () => {
      if (table === venue_catalog && failVenues) throw new Error('fixture database outage');
      return rows[table === venue_catalog ? 'venues' : 'events'];
    } };
    return query;
  } }),
  insert: table => ({ values: data => { writes(table, data); return { onConflictDoNothing: async () => [] }; } }),
};
const model = jest.fn(), resolvePlace = jest.fn(), saveVenue = jest.fn();
jest.unstable_mockModule('../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../server/lib/venue/venue-cache.js', () => ({ findOrCreateVenue: saveVenue }));
jest.unstable_mockModule('../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: resolvePlace }));
const { searchNearby, askConcierge } = await import('../server/lib/concierge/concierge-service.js');
const context = { lat: 0, lng: 0, timezone: 'UTC', filter: 'all' };
const event = extra => ({ title: 'Fixture concert', venue: 'Fixture Hall', address: 'Fixture Address', city: 'Fixture City', state: 'AA',
  start_date: '2026-09-29', end_date: '2026-09-29', start_time: '19:00', end_time: '22:00', category: 'concert', ...extra });
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T18:00:00Z'));
  rows = { venues: [], events: [] }; failVenues = false; jest.clearAllMocks();
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [] }) });
  resolvePlace.mockResolvedValue({ placeId: 'fixture-place', displayName: 'Google Fixture Hall', formattedAddress: 'Google Fixture Address',
    lat: 0, lng: 0.001, parsed: { city: 'Google City', state: 'AA', country: 'CA' } });
  saveVenue.mockImplementation(async data => ({ venue_id: 'fixture-venue', place_id: data.placeId, venue_name: data.venue, formatted_address: data.formattedAddress,
    lat: data.latitude, lng: data.longitude, city: data.city, state: data.state, country: data.country, timezone: 'UTC' }));
});
afterEach(() => jest.useRealTimers());

test('zero-axis catalog venues survive distance filtering without an unnecessary model call', async () => {
  rows.venues = [1, 2, 3].map(n => ({ venue_id: 'fixture-' + n, venue_name: 'Fixture ' + n, lat: 0, lng: n / 1000, is_bar: true }));
  const result = await searchNearby(context);
  expect(result.venues).toHaveLength(3); expect(model).not.toHaveBeenCalled();
});
test('a failed venue query is an error, not sparse data that triggers a model', async () => {
  failVenues = true;
  await expect(searchNearby(context)).rejects.toThrow('database outage');
  expect(model).not.toHaveBeenCalled();
});
test('model coordinates never become map coordinates or bypass Google venue resolution', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [{ name: 'Fixture Hall', address: 'Fixture Address', city: 'wrong', state: 'wrong', lat: 44, lng: 55 }], events: [] }) });
  const result = await searchNearby(context);
  expect(result.venues[0]).toMatchObject({ title: 'Google Fixture Hall', lat: 0, lng: 0.001, city: 'Google City', state: 'AA', source: 'google_places' });
  expect(saveVenue).toHaveBeenCalledWith(expect.objectContaining({ latitude: 0, longitude: 0.001, country: 'CA' }), 'concierge_discovery');
});
test.each([
  { start_date: undefined }, { start_time: undefined }, { end_time: undefined },
  { title: 'Unknown concert' }, { start_date: '2026-09-30', end_date: '2026-09-30' },
])('incomplete or invalid event %j cannot be stamped with the current validator version', async invalid => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event(invalid)] }) });
  const result = await searchNearby(context);
  expect(writes).not.toHaveBeenCalled(); expect(result.events).toEqual([]);
});
test('valid schedules use Google identity, canonical validation and venue linkage before shared storage', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event({ lat: 44, lng: 55 })] }) });
  const result = await searchNearby(context);
  expect(writes).toHaveBeenCalledWith(discovered_events, expect.objectContaining({ title: 'Fixture concert', venue_id: 'fixture-venue',
    city: 'Google City', event_start_date: '2026-09-29', event_end_date: '2026-09-29', event_start_time: '19:00', event_end_time: '22:00', expected_attendance: null }));
  expect(result.events[0]).toMatchObject({ lat: 0, lng: 0.001, venue: 'Google Fixture Hall' });
});
test('unresolved or distant Google venue cannot enter shared events or map results', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event()] }) });
  resolvePlace.mockResolvedValue({ placeId: 'distant', lat: 45, lng: 45, parsed: { city: 'Far City', state: 'AA', country: 'CA' } });
  const result = await searchNearby(context);
  expect(result.events).toEqual([]); expect(writes).not.toHaveBeenCalled();
});
test('concurrent duplicate discovery candidates resolve and persist one canonical event', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event(), event()] }) });
  const result = await searchNearby(context);
  expect(resolvePlace).toHaveBeenCalledTimes(1); expect(saveVenue).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledTimes(1); expect(result.events).toHaveLength(1);
});
test('a missing venue timezone cannot borrow the viewer timezone for shared event validation', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event()] }) });
  saveVenue.mockResolvedValue({ venue_id: 'fixture-venue', place_id: 'fixture-place', lat: 0, lng: 0.001, timezone: null });
  const result = await searchNearby(context);
  expect(result.events).toEqual([]); expect(writes).not.toHaveBeenCalled();
  expect(result.discovery).toMatchObject({ complete: false, rejected_candidates: [{ type: 'event', reason: 'venue_timezone_unverified' }] });
});
test('legacy invalid schedules are filtered on read while actual multi-day spans survive', async () => {
  rows.venues = [1, 2, 3].map(n => ({ venue_id: 'fixture-' + n, venue_name: 'Fixture ' + n, lat: 0, lng: n / 1000, is_bar: true }));
  const valid = { title: 'Fixture multi-day', venue_name: 'Fixture venue', address: 'Fixture Address', lat: 0, lng: 0.001,
    event_start_date: '2026-09-28', event_end_date: '2026-09-30', event_start_time: '09:00', event_end_time: '22:00', category: 'festival', venue_timezone: 'UTC' };
  rows.events = [valid, { ...valid, title: 'Legacy missing time', event_start_time: null }];
  const result = await searchNearby(context);
  expect(result.events).toHaveLength(1); expect(result.events[0].title).toBe('Fixture multi-day');
  expect(model).not.toHaveBeenCalled();
});
test.each([{ ok: false, error: 'fixture model outage' }, { ok: true, output: 'not JSON' }])('failed discovery %j cannot masquerade as a successful empty search', async result => {
  model.mockResolvedValue(result);
  await expect(searchNearby(context)).rejects.toThrow();
});
test('empty model chat output is an explicit failure', async () => {
  model.mockResolvedValue({ ok: true, output: '  ' });
  expect((await askConcierge({ ...context, question: 'Hello' })).ok).toBe(false);
});
test('discovery and chat preserve full GPS precision in provider prompt strings', async () => {
  const precise = { ...context, lat: 0.0000001234567, lng: 0.0000009876543 };
  await searchNearby(precise);
  expect(model.mock.calls[0][1].user).toContain(String(precise.lat));
  expect(model.mock.calls[0][1].user).toContain(String(precise.lng));
  await askConcierge({ ...precise, question: 'Hello' });
  expect(model.mock.calls[1][1].system).toContain(String(precise.lat));
  expect(model.mock.calls[1][1].system).toContain(String(precise.lng));
});
test('sparse DB venues rediscovered by Google appear once by canonical venue identity', async () => {
  rows.venues = [{ venue_id: 'fixture-venue', venue_name: 'Google Fixture Hall', lat: 0, lng: 0.001, is_bar: true }];
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [{ name: 'Fixture Hall', address: 'Fixture Address' }], events: [] }) });
  const result = await searchNearby(context);
  expect(result.venues).toHaveLength(1); expect(result.venues[0].source).toBe('db');
});
test('sparse DB events rediscovered by Gemini appear once by canonical event hash', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event()] }) });
  await searchNearby(context);
  rows.events = [{ ...writes.mock.calls[0][1], lat: 0, lng: 0.001, venue_timezone: 'UTC' }];
  const result = await searchNearby(context);
  expect(result.events).toHaveLength(1); expect(result.events[0].source).toBe('db');
});
test('cancellation reaches the model and prevents provider resolution or writes after discovery returns', async () => {
  const controller = new AbortController();
  model.mockImplementation(async () => {
    controller.abort();
    return { ok: true, output: JSON.stringify({ venues: [], events: [event()] }) };
  });
  await expect(searchNearby({ ...context, signal: controller.signal })).rejects.toThrow();
  expect(model.mock.calls[0][1].signal).toBe(controller.signal);
  expect(resolvePlace).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
});
test('a cancelled chat cannot publish an answer returned by a transport that ignored abort', async () => {
  const controller = new AbortController();
  model.mockImplementation(async () => {
    controller.abort();
    return { ok: true, output: 'obsolete answer' };
  });
  await expect(askConcierge({ ...context, question: 'Hello', signal: controller.signal })).rejects.toThrow();
  expect(model.mock.calls[0][1].signal).toBe(controller.signal);
});
test('a discovered event across a date boundary waits for its verified venue timezone', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event()] }) });
  saveVenue.mockImplementation(async data => ({ venue_id: 'fixture-venue', place_id: data.placeId, lat: data.latitude, lng: data.longitude, timezone: 'Etc/GMT+12' }));
  const result = await searchNearby({ ...context, timezone: 'Pacific/Kiritimati' });
  expect(result.events).toHaveLength(1);
  expect(writes).toHaveBeenCalledTimes(1);
});


test('same-title same-day performances share resolution without sharing their insert promise', async () => {
 model.mockResolvedValue({ ok: true, output: JSON.stringify({ venues: [], events: [event(), event({ start_time: '14:00', end_time: '17:00' })] }) });
 await searchNearby(context);
 expect(resolvePlace).toHaveBeenCalledTimes(1); expect(writes).toHaveBeenCalledTimes(2);
 expect(writes.mock.calls.map(call => call[1].event_start_time).sort()).toEqual(['14:00', '19:00']);
});
