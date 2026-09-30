import { jest, beforeEach, test, expect } from '@jest/globals';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';
const model = jest.fn(), search = jest.fn(), lookup = jest.fn(), catalog = jest.fn();
const log = new Proxy({}, { get: () => jest.fn() });
const db = { select: () => { const q = { from: () => q, where: () => q, limit: async () => [] }; return q; }, insert: () => ({ values: () => Promise.resolve() }) };
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => mainRunBoundary({}).exports);
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/venue/venue-enrichment.js', () => ({ searchPlaceByText: search }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ lookupVenue: lookup, getVenuesByType: catalog, normalizeVenueName: value => value }));
jest.unstable_mockModule('../../server/lib/ai/providers/consolidator.js', () => ({ loadDriverPreferences: async () => ({ profile_loaded: false }), buildDriverPreferencesSection: () => '' }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ venuesLog: log, matrixLog: log, briefingLog: log, createWorkflowLogger: () => log }));
const { generateTacticalPlan, resolveVenueWithCache } = await import('../../server/lib/strategy/tactical-planner.js');
const snapshot = completeSnapshot({ lat: 1, lng: 1, country: 'CA' });
const candidate = { name: 'Fixture Hall', category: 'dining', pro_tips: ['Use designated pickup zone.'] };
const row = { venue_name: 'Fixture Hall', place_id: 'place-one', lat: 1.001, lng: 1, country: 'CA', formatted_address: '1 Hall Street', last_known_status: 'open' };
const ctx = () => ({ city: 'City', state: 'AB', country: 'CA', tz: 'America/Toronto', origin: { lat: 1, lng: 1 }, cacheMetrics: { hits: 0, misses: 0 } });
beforeEach(() => { jest.clearAllMocks(); lookup.mockResolvedValue(row); search.mockResolvedValue(null); catalog.mockResolvedValue([]); model.mockResolvedValue({ ok: true, output: JSON.stringify({ recommended_venues: [candidate], tactical_summary: 'Synthetic local demand plan.' }) }); });
test.each([{ ...row, place_id: null }, { ...row, lat: 'NaN' }, { ...row, country: 'US' }, { ...row, lat: 50 }, { ...row, last_known_status: 'closed' }])('invalid/foreign/remote/closed cache identity is resolved again: %j', async cached => {
  lookup.mockResolvedValue(cached);
  expect(await resolveVenueWithCache(candidate, ctx())).toBeNull(); expect(search).toHaveBeenCalled();
});
test('district mismatch cannot silently choose another branch', async () => {
  lookup.mockResolvedValue({ ...row, district_slug: 'wrong-district' });
  expect(await resolveVenueWithCache({ ...candidate, district: 'Intended District' }, ctx())).toBeNull();
});
test('planner forwards identity metadata and cancellation signal', async () => {
  const plan = await generateTacticalPlan({ strategy: 'Use local demand', snapshot });
  expect(plan.recommended_venues[0].resolved_place).toMatchObject({ place_id: 'place-one', country: 'CA', matchMethod: 'cache_hit' });
  expect(model.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
test('duplicate aliases cannot publish the same Google place twice', async () => {
  model.mockResolvedValue({ ok: true, output: JSON.stringify({ recommended_venues: [candidate, { ...candidate, name: 'Alias Hall' }], tactical_summary: 'Synthetic local demand plan.' }) });
  const plan = await generateTacticalPlan({ strategy: 'Use local demand', snapshot });
  expect(plan.recommended_venues).toHaveLength(1);
});
test('catalog category fallback is city bounded and reads the actual venue_name field', async () => {
  lookup.mockResolvedValue(null); catalog.mockResolvedValue([row]);
  const plan = await generateTacticalPlan({ strategy: 'Use local demand', snapshot });
  expect(catalog.mock.calls[0][0].city).toBe(snapshot.city);
  expect(plan.recommended_venues[0].name).toBe(row.venue_name);
});
test('planner deadline rejects late provider success before resolution', async () => {
  jest.useFakeTimers(); const old = process.env.PLANNER_DEADLINE_MS; process.env.PLANNER_DEADLINE_MS = '10';
  model.mockImplementation(async () => { await jest.advanceTimersByTimeAsync(20); return { ok: true, output: JSON.stringify({ recommended_venues: [candidate], tactical_summary: 'Synthetic local demand plan.' }) }; });
  try { await expect(generateTacticalPlan({ strategy: 'Use local demand', snapshot })).rejects.toThrow(); expect(lookup).not.toHaveBeenCalled(); }
  finally { jest.useRealTimers(); if (old === undefined) delete process.env.PLANNER_DEADLINE_MS; else process.env.PLANNER_DEADLINE_MS = old; }
});
