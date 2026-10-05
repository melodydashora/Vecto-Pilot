import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFAADelayData } from '../../server/lib/external/faa-asws.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const sourceTime = '2026-10-05T09:30:00Z';
const airport = (changes = {}) => ({ airportId: 'AAA', airportLongName: 'Synthetic airport',
  groundStop: null, groundDelay: null, arrivalDelay: null, departureDelay: null,
  airportClosure: null, freeForm: null, airportConfig: null, deicing: null, ...changes });
const event = (changes = {}) => ({ airportId: 'AAA', updatedAt: sourceTime, ...changes });
function mockFAA(body = [], status = 200) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(body), { status });
  };
  return requests;
}

test('calls only the current national JSON endpoint, anonymously and with a deadline', async () => {
  const requests = mockFAA([airport({ groundStop: event({ impactingCondition: 'Weather' }) })]);
  const result = await fetchFAADelayData('aaa', { strict: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://nasstatus.faa.gov/api/airport-events');
  assert.deepEqual(requests[0].options.headers, { Accept: 'application/json' });
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.equal(result.airport_code, 'AAA');
  assert.equal(result.source_updated_at, sourceTime);
  assert.equal(result.last_updated, sourceTime);
  assert.ok(Number.isFinite(Date.parse(result.fetched_at)));
  assert.equal(result.weather, null);
  assert.equal(result.supported, null);
});

test('concurrent nearby-airport and national readers share one fetch, without sharing mutable results', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; await waiting; return new Response(JSON.stringify([
    airport({ groundStop: event({ impactingCondition: 'Weather' }) }),
    airport({ airportId: 'BBB', departureDelay: event({ airportId: 'BBB', averageDelay: 25, reason: 'Volume' }) }),
  ])); };
  const results = Promise.all([
    fetchFAADelayData('AAA', { strict: true }), fetchFAADelayData('BBB', { strict: true }),
    fetchFAADelayData(null, { strict: true }), fetchFAADelayData('AAA', { strict: true }),
  ]);
  assert.equal(calls, 1); release();
  const [first, second, national, sameAirport] = await results;
  assert.equal(calls, 1); assert.equal(national.length, 2);
  assert.equal(second.delay_minutes, 25);
  first.ground_stops[0].reason = 'Changed by caller';
  assert.equal(sameAirport.ground_stops[0].reason, 'Weather');
  assert.equal(national[0].ground_stops[0].reason, 'Weather');
  await fetchFAADelayData('AAA', { strict: true });
  assert.equal(calls, 2, 'completed reads are not retained as a timeless cache');
});

test('absent airports and a successful empty feed remain unknown, never zero/open/normal', async () => {
  mockFAA([]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.delay_minutes, null); assert.equal(result.has_delays, null);
  assert.equal(result.closure_status, 'unknown'); assert.equal(result.supported, null);
  assert.equal(result.source_updated_at, null); assert.equal(result.last_updated, null);
  assert.match(result.delay_reason, /No FAA airport events.*normal operations are not verified/);
  assert.deepEqual(await fetchFAADelayData(null, { strict: true }), []);
});

test('configuration-only rows do not establish delay or closure status', async () => {
  mockFAA([airport({ airportConfig: { arrivalRate: 40 } })]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.has_delays, null); assert.equal(result.delay_minutes, null);
  assert.equal(result.closure_status, 'unknown'); assert.equal(result.source_updated_at, null);
});

test('simultaneous ground stop, ground delay, arrival and departure reports all survive', async () => {
  mockFAA([airport({
    groundStop: event({ impactingCondition: 'Weather', endTime: '2026-10-05T12:00:00Z' }),
    groundDelay: event({ impactingCondition: 'Runway', avgDelay: 72 }),
    arrivalDelay: event({ reason: 'Volume', averageDelay: 45, trend: 'increasing' }),
    departureDelay: event({ reason: 'Equipment', averageDelay: 90, updateTime: '2026-10-05T10:00:00Z' }),
  })]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.ground_stops.length, 1); assert.equal(result.ground_delay_programs.length, 3);
  assert.equal(result.delay_minutes, 90); assert.equal(result.has_delays, true);
  assert.equal(result.closure_status, 'ground-stop');
  assert.equal(result.source_updated_at, '2026-10-05T10:00:00Z');
  assert.deepEqual(result.ground_delay_programs.map(item => item.average_delay), [72, 45, 90]);
  assert.ok(result.ground_delay_programs.every(item => item.min_delay === null && item.max_delay === null));
});

test('scoped closure/free-form restrictions retain their wording and concurrent ground stop', async () => {
  mockFAA([airport({
    groundStop: event({ impactingCondition: 'Weather', endTime: '2026-10-05T12:00:00Z' }),
    airportClosure: event({ text: 'Runway maintenance restriction', startTime: '2026-10-05T09:00:00Z', endTime: '2026-10-05T13:00:00Z' }),
    freeForm: event({ simpleText: 'AP CLSD TO NON SKED GA EXC 24HR PPR', text: 'TO NON SKED GA EXC 24HR PPR' }),
  })]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.closure_status, 'restricted'); assert.equal(result.has_delays, true);
  assert.equal(result.delay_minutes, null); assert.equal(result.ground_stops.length, 1);
  assert.equal(result.restrictions.length, 2); assert.match(result.delay_reason, /EXC 24HR PPR/);
  assert.match(result.delay_reason, /Weather/); assert.equal(result.closure_end, '2026-10-05T13:00:00Z');
});

test('restriction alone does not invent a delay and deicing retains unknown duration', async () => {
  mockFAA([airport({ freeForm: event({ text: 'Closed to a restricted aircraft category' }), deicing: event() })]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.has_delays, null); assert.equal(result.delay_minutes, null);
  assert.equal(result.closure_status, 'restricted'); assert.match(result.delay_reason, /deicing/);
});

for (const value of [undefined, null, '', '30', -1]) {
  test(`unquantified/invalid numeric delay ${JSON.stringify(value)} stays null, while the listed disruption survives`, async () => {
    mockFAA([airport({ groundDelay: event({ avgDelay: value, impactingCondition: 'Volume' }) })]);
    const result = await fetchFAADelayData('AAA', { strict: true });
    assert.equal(result.has_delays, true); assert.equal(result.delay_minutes, null);
    assert.equal(result.ground_delay_programs[0].average_delay, null);
    assert.equal(result.closure_status, 'unknown');
  });
}

test('explicit zero delay is preserved without inventing normal operation or coverage', async () => {
  mockFAA([airport({ arrivalDelay: event({ averageDelay: 0, reason: 'Reported delay' }) })]);
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.delay_minutes, 0); assert.equal(result.has_delays, true);
  assert.equal(result.closure_status, 'unknown'); assert.equal(result.supported, null);
});

for (const value of ['not-a-date', '2026-10-05T09:30:00', '2026-02-30T09:30:00Z', '2026-10-05T24:00:00Z']) {
  test(`invalid advisory timestamp ${value} cannot become fresh evidence`, async () => {
    mockFAA([airport({ groundStop: event({ updatedAt: value }) })]);
    await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /timestamp/);
  });
}

test('missing advisory times stay unknown; valid offset times retain their original value', async () => {
  mockFAA([airport({ groundStop: event({ updatedAt: null }) })]);
  assert.equal((await fetchFAADelayData('AAA', { strict: true })).source_updated_at, null);
  mockFAA([airport({ groundStop: event({ updatedAt: '2026-10-05T05:30:00-04:00' }) })]);
  assert.equal((await fetchFAADelayData('AAA', { strict: true })).source_updated_at, '2026-10-05T05:30:00-04:00');
});

for (const body of [{}, [null], [{ airportId: 'AAA' }], [airport({ groundStop: {} })],
  [airport({ groundStop: false })], [airport({ groundStop: event({ airportId: 'BBB' }) })], [airport(), airport()]]) {
  test(`malformed or mismatched response ${JSON.stringify(body)} cannot become no-delay success`, async () => {
    mockFAA(body);
    await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /Invalid|mismatched|Duplicate/);
  });
}

test('failed shared fetch releases its slot; a later read can succeed', async () => {
  const requests = mockFAA({}, 503);
  const results = await Promise.allSettled([fetchFAADelayData('AAA', { strict: true }), fetchFAADelayData('BBB', { strict: true })]);
  assert.equal(requests.length, 1); assert.ok(results.every(result => result.status === 'rejected' && /HTTP 503/.test(result.reason.message)));
  mockFAA([]); assert.equal((await fetchFAADelayData('AAA', { strict: true })).has_delays, null);
});

test('nullable callers retain failure semantics without silently converting a failed feed to normal', async () => {
  mockFAA({}, 503);
  assert.equal(await fetchFAADelayData('AAA'), null);
});

test('timeout and malformed JSON propagate to strict callers', async () => {
  globalThis.fetch = async () => { throw new DOMException('Request timed out', 'TimeoutError'); };
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /timed out/);
  globalThis.fetch = async () => new Response('not-json');
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /feed unavailable/);
});

test('invalid airport codes fail before making requests', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('Unexpected call'); };
  await assert.rejects(fetchFAADelayData('../AAA', { strict: true }), /three-letter IATA/);
  assert.equal(called, false);
});

test('a body completing after the request deadline cannot publish late evidence even if transport ignores abort', async () => {
  const originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  let release;
  const body = new Promise(resolve => { release = resolve; });
  AbortSignal.timeout = () => controller.signal;
  globalThis.fetch = async () => ({ ok: true, json: async () => { await body; return []; } });
  try {
    const result = fetchFAADelayData('AAA', { strict: true });
    await Promise.resolve();
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    release();
    await assert.rejects(result, /timed out/);
  } finally { AbortSignal.timeout = originalTimeout; release(); }
});
