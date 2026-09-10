import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFAADelayData } from '../../server/lib/external/faa-asws.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const sourceTime = 'Thu Sep 10 17:00:00 2026 GMT';
const xml = (body = '') => `<AIRPORT_STATUS_INFORMATION><Update_Time>${sourceTime}</Update_Time>${body}</AIRPORT_STATUS_INFORMATION>`;
const status = (changes = {}) => ({ IATA: 'AAA', Name: 'Synthetic airport', SupportedAirport: true,
  Delay: false, Status: [{ Reason: 'No known delays for this airport' }], ...changes });

function mockFAA({ feed = xml(), airport = status(), feedStatus = 200, airportStatus = 200 } = {}) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.includes('nasstatus')
      ? new Response(feed, { status: feedStatus })
      : new Response(JSON.stringify(airport), { status: airportStatus });
  };
  return requests;
}

test('calls public ASWS without credentials and keeps source time and explicit no-delay reason', async () => {
  const requests = mockFAA();
  const result = await fetchFAADelayData('aaa', { strict: true });
  assert.equal(result.delay_minutes, 0);
  assert.equal(result.delay_reason, 'No known delays for this airport');
  assert.equal(result.source_updated_at, sourceTime);
  assert.equal(result.last_updated, sourceTime);
  assert.ok(result.fetched_at);
  assert.equal(requests.length, 2);
  const request = requests.find(r => r.url.includes('external-api'));
  assert.ok(request.url.endsWith('/AAA'));
  assert.deepEqual(request.options.headers, { Accept: 'application/json' });
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('does not convert an unquantified reported delay into zero delay or open status', async () => {
  mockFAA({ airport: status({ Delay: true, Status: [{ Reason: 'Traffic management delay' }] }) });
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.delay_minutes, null);
  assert.equal(result.has_delays, true);
  assert.equal(result.closure_status, 'unknown');
  assert.equal(result.delay_reason, 'Traffic management delay');
});

test('distinguishes unsupported airport coverage from a request failure', async () => {
  mockFAA({ airport: status({ SupportedAirport: false, Delay: undefined, Status: [] }) });
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.supported, false);
  assert.equal(result.delay_minutes, null);
  assert.equal(result.has_delays, null);
  assert.equal(result.closure_status, 'unknown');
  assert.match(result.delay_reason, /does not cover/);
});

test('retains simultaneous ground stop and ground delay rather than dropping one event', async () => {
  mockFAA({ feed: xml('<Delay_type><Ground_Stop_List><Program><ARPT>AAA</ARPT><Reason>weather</Reason><End_Time>14:00 local</End_Time></Program></Ground_Stop_List></Delay_type><Delay_type><Ground_Delay_List><Ground_Delay><ARPT>AAA</ARPT><Reason>runway</Reason><Avg>1 hour and 12 minutes</Avg><Max>2 hours and 5 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type>') });
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.ground_stops.length, 1);
  assert.equal(result.ground_delay_programs.length, 1);
  assert.equal(result.delay_minutes, 72);
  assert.equal(result.ground_delay_programs[0].max_delay, 125);
  assert.equal(result.closure_status, 'ground-stop');
});

test('retains closure restrictions as restrictions, not a universal airport shutdown', async () => {
  mockFAA({ feed: xml('<Delay_type><Airport_Closure_List><Airport><ARPT>AAA</ARPT><Reason>Closed to a restricted aircraft category</Reason><Start>start</Start><Reopen>end</Reopen></Airport></Airport_Closure_List></Delay_type>') });
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.closure_status, 'restricted');
  assert.match(result.delay_reason, /restricted aircraft category/);
  assert.equal(result.closure_end, 'end');
});

test('retains zero visibility rather than dropping a meaningful weather measurement', async () => {
  mockFAA({ airport: status({ Weather: { Visibility: [0], Temp: [0] } }) });
  const result = await fetchFAADelayData('AAA', { strict: true });
  assert.equal(result.weather.visibility, 0);
  assert.equal(result.weather.temperature, 0);
});

test('strict Briefing caller receives the actual failing feed and HTTP reason', async () => {
  mockFAA({ feedStatus: 503 });
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /disruption feed.*HTTP 503/);
  mockFAA({ airportStatus: 401 });
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /airport status.*HTTP 401/);
});

test('malformed/mismatched data never becomes a successful zero-delay result', async () => {
  mockFAA({ feed: '<not-airport-data />' });
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /missing its root/);
  mockFAA({ airport: status({ IATA: 'BBB' }) });
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /mismatched payload/);
  mockFAA({ airport: status({ Delay: 'false' }) });
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /invalid/);
});

test('timeout/network rejection propagates to strict caller', async () => {
  globalThis.fetch = async () => { throw new DOMException('Request timed out', 'TimeoutError'); };
  await assert.rejects(fetchFAADelayData('AAA', { strict: true }), /timed out/);
});

test('invalid airport codes fail before making requests', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('Unexpected call'); };
  await assert.rejects(fetchFAADelayData('../AAA', { strict: true }), /three-letter IATA/);
  assert.equal(called, false);
});
