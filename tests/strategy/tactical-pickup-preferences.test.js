import { jest, test, expect } from '@jest/globals';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';

let preferences;
const venues = Array.from({ length: 6 }, (_, i) => ({ name: `Fixture venue ${i}`, category: 'dining', pro_tips: ['Use the marked pickup area.'] }));
const model = jest.fn(async () => ({ ok: true, output: JSON.stringify({ recommended_venues: venues, tactical_summary: 'Synthetic current-location demand plan.' }) }));
const forbidden = jest.fn(async () => { throw new Error('Unexpected database/provider call'); });
const log = new Proxy({}, { get: () => jest.fn() });
const admission = mainRunBoundary({});
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: forbidden, insert: forbidden } }));
jest.unstable_mockModule('../../server/lib/venue/venue-enrichment.js', () => ({ searchPlaceByText: forbidden }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({
  lookupVenue: async ({ venueName }) => ({ venue_name: venueName, lat: 1.001, lng: 1, place_id: venueName, last_known_status: 'open' }),
  getVenuesByType: forbidden, normalizeVenueName: value => value,
}));
jest.unstable_mockModule('../../server/lib/venue/district-detection.js', () => ({ normalizeDistrictSlug: value => value }));
jest.unstable_mockModule('../../server/lib/ai/providers/consolidator.js', () => ({
  loadDriverPreferences: async () => preferences,
  buildDriverPreferencesSection: () => 'Saved maximum empty pickup distance: 1 mile.',
}));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ venuesLog: log, matrixLog: log, briefingLog: log, createWorkflowLogger: () => log }));
const { generateTacticalPlan } = await import('../../server/lib/strategy/tactical-planner.js');

test('changing home distance cannot flag or reorder equally near current-location venues as beyond the pickup limit', async () => {
  admission.state.configuration = {
    profile: { selected_services: ['economy'] }, vehicle: { model: 'Saved vehicle' },
    rules: { version: 9, hash: 'withheld-analyzer', config: { min_per_mile: 2.75 } },
  };
  const snapshot = completeSnapshot({ lat: 1, lng: 1 });
  const run = async (home_lat, home_lng) => {
    preferences = { profile_loaded: true, home_lat, home_lng, max_deadhead_mi: 1 };
    return generateTacticalPlan({ strategy: 'Use verified demand near the current location.', snapshot });
  };
  const nearHome = await run(1, 1);
  const distantHome = await run(20, 20);
  expect(nearHome.recommended_venues).toHaveLength(6);
  expect(distantHome.recommended_venues).toHaveLength(6);
  expect(distantHome.recommended_venues.map(v => [v.name, v.rank, v.lat, v.lng]))
    .toEqual(nearHome.recommended_venues.map(v => [v.name, v.rank, v.lat, v.lng]));
  for (const venue of [...nearHome.recommended_venues, ...distantHome.recommended_venues]) expect(venue.beyond_deadhead).not.toBe(true);
  expect(nearHome.recommended_venues[0].distance_from_home_mi).toBeLessThan(1);
  expect(distantHome.recommended_venues[0].distance_from_home_mi).toBeGreaterThan(1);
  expect(model.mock.calls[0][1].system).toContain("CURRENT location; max_deadhead_mi limits empty travel to a ride pickup");
  expect(forbidden).not.toHaveBeenCalled();
  const prompt = JSON.stringify(model.mock.calls[0][1]);
  expect(prompt).toContain('selected_services');
  expect(prompt).toContain('Saved vehicle');
  expect(prompt).not.toContain('withheld-analyzer');
  expect(prompt).not.toContain('min_per_mile');
});
