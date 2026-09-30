import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAirportContext } from '../../server/lib/location/airport-context.js';

const nearby = { code: 'AAA', name: 'Synthetic airport', distance: 2.56 };
test('nearby proximity alone preserves unknown operational status and absent source times', () => {
  const result = buildAirportContext(nearby);
  assert.equal(result.distance_miles, 2.6);
  for (const field of ['delay_minutes', 'has_delays', 'has_closures', 'faa_supported', 'faa_source_updated_at', 'faa_fetched_at']) {
    assert.equal(result[field], null, field);
  }
  assert.equal(result.closure_status, 'unknown');
  assert.equal(buildAirportContext(null), null);
});
test('unsupported coverage does not turn unknown into zero delay or a closure', () => {
  const result = buildAirportContext(nearby, { supported: false, delay_minutes: null, has_delays: null,
    closure_status: 'unknown', delay_reason: 'FAA ASWS does not cover this airport' });
  assert.equal(result.faa_supported, false);
  assert.equal(result.delay_minutes, null);
  assert.equal(result.has_delays, null);
  assert.equal(result.has_closures, null);
  assert.match(result.delay_reason, /does not cover/);
});
test('unquantified reported delay, feed time, and fetch time remain distinct facts', () => {
  const result = buildAirportContext(nearby, { supported: true, has_delays: true, delay_minutes: null,
    closure_status: 'unknown', source_updated_at: 'Thu Sep 10 17:00:00 2026 GMT', fetched_at: '2026-09-10T17:03:00.000Z' });
  assert.equal(result.has_delays, true);
  assert.equal(result.delay_minutes, null);
  assert.equal(result.has_closures, null);
  assert.equal(result.faa_source_updated_at, 'Thu Sep 10 17:00:00 2026 GMT');
  assert.equal(result.faa_fetched_at, '2026-09-10T17:03:00.000Z');
});
test('measured zero and an explicit absence of delays remain zero and false', () => {
  const result = buildAirportContext(nearby, { supported: true, has_delays: false, delay_minutes: 0, closure_status: 'open',
    weather: { temperature: 0, conditions: 'Synthetic weather', wind: 0 } });
  assert.equal(result.has_delays, false);
  assert.equal(result.delay_minutes, 0);
  assert.equal(result.has_closures, false);
  assert.equal(result.weather.temperature, 0);
});
test('ground stop is retained without claiming an airport-wide closure', () => {
  const stops = [{ reason: 'Synthetic ground stop', end_time: '18:00 UTC' }];
  const result = buildAirportContext(nearby, { has_delays: true, closure_status: 'ground-stop', ground_stops: stops });
  assert.equal(result.has_delays, true);
  assert.equal(result.has_closures, null);
  assert.deepEqual(result.ground_stops, stops);
});
test('aircraft restrictions retain their scope and end time', () => {
  const result = buildAirportContext(nearby, { closure_status: 'restricted', delay_reason: 'Restricted aircraft category',
    closure_start: '17:00 UTC', closure_end: '19:00 UTC' });
  assert.equal(result.has_closures, true);
  assert.equal(result.closure_status, 'restricted');
  assert.equal(result.delay_reason, 'Restricted aircraft category');
  assert.equal(result.closure_end, '19:00 UTC');
});
