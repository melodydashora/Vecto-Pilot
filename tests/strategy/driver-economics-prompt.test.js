import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';

const snapshot = completeSnapshot();
const briefing = completeBriefing(snapshot.snapshot_id, { generation_token: 'synthetic-generation' });
let profile, profileError, venueRows;
const writes = [];
const db = {
  select: () => {
    let table, joined = false;
    const query = {
      from: value => { table = getTableName(value); return query; }, where: () => query,
      leftJoin: () => { joined = true; return query; }, for: () => query,
      limit: async () => {
        if (joined) return [{ strategy: { status: 'pending' }, briefing }];
        if (table === 'driver_profiles' && profileError) throw profileError;
        return ({ snapshots: [snapshot], briefings: [briefing], strategies: [{ status: 'pending' }],
          driver_profiles: profile ? [profile] : [], venue_catalog: venueRows })[table] || [];
      },
    };
    return query;
  },
  update: () => ({ set: value => ({ where: () => ({ returning: async () => { writes.push(value); return [value]; } }) }) }),
  transaction: async fn => fn(db),
};
const log = new Proxy({}, { get: () => jest.fn() });
const openNow = jest.fn((_hours, timezone) => ({ isOpen: timezone === 'America/Chicago' }));
jest.unstable_mockModule('../../server/lib/venue/venue-hours.js', () => ({ isOpenNow: openNow }));
const model = jest.fn(async () => ({ ok: true, output: 'GO: Stay near the named local venue. AVOID: No road issues reported. WHY: Use current demand evidence.' }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const admission = mainRunBoundary(db);
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ triadLog: log, aiLog: log, dbLog: log, eventsLog: log, OP: {}, tagLog: jest.fn() }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
const { loadDriverPreferences, buildDriverPreferencesSection, buildEarningsContextSection, runImmediateStrategy } = await import('../../server/lib/ai/providers/consolidator.js');

beforeEach(() => { profile = undefined; profileError = undefined; venueRows = []; openNow.mockClear(); admission.state.configuration = { profile: {}, vehicle: {}, rules: { config: {} } }; model.mockClear(); writes.length = 0; });

test('Strategy uses admitted vehicle and services while withholding Analyzer rules from MAIN', async () => {
  profileError = new Error('Live profile reads are forbidden for an admitted run');
  admission.state.configuration = {
    profile: { elig_comfort: true, selected_services: ['comfort'], max_deadhead_mi: 3 },
    vehicle: { year: 2020, make: 'Fixture', model: 'Admitted' },
    rules: { version: 7, hash: 'admitted-rules', config: { minimum_per_mile: 2.75 } },
  };
  await runImmediateStrategy(snapshot.snapshot_id);
  const prompt = model.mock.calls[0][1].user;
  expect(prompt).toContain('Maximum empty pickup distance: 3 miles');
  expect(prompt).toContain('"selected_services":["comfort"]');
  expect(prompt).toContain('"model":"Admitted"');
  expect(prompt).not.toContain('admitted-rules');
  expect(prompt).not.toContain('minimum_per_mile');
  expect(prompt).not.toContain('"rules":');
});

test('missing profile dispatches a prompt without invented vehicle, fare, surge, fuel or pickup values', async () => {
  await runImmediateStrategy(snapshot.snapshot_id);
  expect(model).toHaveBeenCalledTimes(1);
  const [role, prompts] = model.mock.calls[0];
  expect(role).toBe('STRATEGY_TACTICAL');
  const prompt = `${prompts.system}\n${prompts.user}`;
  expect(prompt).toContain('Fuel economy: not specified');
  expect(prompt).toContain('Maximum empty pickup distance: not specified');
  expect(prompt).toContain('pet-friendly rides: not specified');
  expect(prompt).toContain('Do not invent fare cards');
  expect(prompt).toContain('service-neutral');
  expect(prompt).not.toMatch(/Uber|Lyft|25 mpg|\$3\.50|\$0\.04|1\.5-3x|Estimated rate:|Net per mile:|\$40-60|\$2\.40/);
  expect(writes.at(-1).status).toBe('ok');
});

test('saved capability stays neutral and separate from explicit service willingness', async () => {
  profile = { elig_economy: true, elig_luxury_suv: true, pref_pet_friendly: false, pref_teen: true,
    fuel_economy_mpg: 38, earnings_goal_daily: '200.00', shift_hours_target: '8.0', max_deadhead_mi: 0, attr_electric: false };
  const prefs = await loadDriverPreferences(snapshot.user_id);
  const prompt = buildDriverPreferencesSection(prefs);
  expect(prompt).toContain('luxury SUV: eligible');
  expect(prompt).toContain('pet-friendly rides: avoid');
  expect(prompt).toContain('unaccompanied teen rides: willing');
  expect(prompt).toContain('assistance rides: not specified');
  expect(prompt).toContain('Maximum empty pickup distance: 0 miles');
  expect(prompt).toContain('Fuel economy: 38 mpg');
  expect(prompt).not.toMatch(/Uber|Lyft|Cost\/mile/);
  const earnings = buildEarningsContextSection(prefs);
  expect(earnings).toContain('Target pace: 25.00 per hour in the driver account currency');
  expect(earnings).toContain('not expected earnings');
});

test('zero goal is explicit; zero/unknown hours never creates an earnings forecast', () => {
  expect(buildEarningsContextSection({ earnings_goal_daily: 0, shift_hours_target: 8 })).toContain('Target pace: 0.00');
  for (const hours of [0, null, undefined, ' ', 'invalid']) {
    expect(buildEarningsContextSection({ earnings_goal_daily: 200, shift_hours_target: hours })).not.toContain('Target pace:');
  }
});

test('failed profile read and invalid legacy values stay unknown instead of falling back to a driver type', async () => {
  profileError = new Error('Fixture database unavailable');
  const failed = await loadDriverPreferences(snapshot.user_id);
  expect(failed).toMatchObject({ source_state: 'read_failed', vehicle_class: null, fuel_economy_mpg: null, max_deadhead_mi: null });
  profileError = undefined;
  profile = { fuel_economy_mpg: -1, earnings_goal_daily: 'bad', shift_hours_target: 25, max_deadhead_mi: false };
  const invalid = await loadDriverPreferences(snapshot.user_id);
  expect(invalid).toMatchObject({ fuel_economy_mpg: null, earnings_goal_daily: null, shift_hours_target: null, max_deadhead_mi: null });
});

test('active multi-day events survive every formatter into the actual Strategy model prompt', async () => {
  const localDate = offset => new Date(Date.now() + offset * 86400000)
    .toLocaleDateString('en-CA', { timeZone: snapshot.timezone });
  const previousEvents = briefing.events;
  briefing.events = [{ title: 'Synthetic multi-day festival', venue_name: 'Synthetic event hall',
    event_start_date: localDate(-1), event_end_date: localDate(1), event_start_time: '12:00', event_end_time: '23:00',
    category: 'festival', expected_attendance: 'high', venue_lat: snapshot.lat, venue_lng: snapshot.lng }];
  try {
    await runImmediateStrategy(snapshot.snapshot_id);
    expect(model.mock.calls[0][1].user).toContain('Synthetic multi-day festival');
  } finally { briefing.events = previousEvents; }
});


test('same-name event venues use their own saved identity and timezone for hours', async () => {
  const previousEvents = briefing.events;
  const today = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: snapshot.timezone });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  briefing.events = ids.map((id, i) => ({ title: `Synthetic festival ${i}`, venue_id: id, venue_name: 'Same name', event_start_date: today(-1), event_end_date: today(1), event_start_time: '12:00', event_end_time: '23:00', category: 'festival' }));
  venueRows = ids.map((id, i) => ({ venue_id: id, venue_name: 'Same name', hours_full_week: { monday: 'all day' }, timezone: i ? 'America/Chicago' : 'America/Los_Angeles' }));
  try {
    await runImmediateStrategy(snapshot.snapshot_id);
    const prompt = model.mock.calls[0][1].user;
    expect(prompt.split('\n').find(line => line.includes('Synthetic festival 0'))).toContain('[CLOSED NOW]');
    expect(prompt.split('\n').find(line => line.includes('Synthetic festival 1'))).not.toContain('[CLOSED NOW]');
    expect(openNow.mock.calls.map(call => call[1])).toEqual(['America/Los_Angeles', 'America/Chicago']);
  } finally { briefing.events = previousEvents; }
});

test.each([undefined, '11111111-1111-4111-8111-111111111111'])('unknown venue identity or timezone cannot become closed: %s', async venueId => {
  const previousEvents = briefing.events;
  const today = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: snapshot.timezone });
  briefing.events = [{ title: 'Unknown synthetic festival', venue_id: venueId, venue_name: 'Same name', event_start_date: today(-1), event_end_date: today(1), event_start_time: '12:00', event_end_time: '23:00', category: 'festival' }];
  venueRows = [{ venue_id: '11111111-1111-4111-8111-111111111111', venue_name: 'Same name', hours_full_week: { monday: 'all day' }, timezone: null }];
  try {
    await runImmediateStrategy(snapshot.snapshot_id);
    expect(model.mock.calls[0][1].user).not.toContain('[CLOSED NOW]');
    expect(openNow).not.toHaveBeenCalled();
  } finally { briefing.events = previousEvents; }
});

test('Strategy prompt retains full supplied coordinate precision including zero', async () => {
  const previous = { ...snapshot };
  Object.assign(snapshot, completeSnapshot({ lat: 0, lng: -96.123456789123 }));
  admission.state.configuration.profile = { home_lat: 0, home_lng: -95.123456789123 };
  try {
    await runImmediateStrategy(snapshot.snapshot_id);
    const prompt = model.mock.calls[0][1].user;
    expect(prompt).toContain('Coords: 0,-96.123456789123');
    expect(prompt).toContain('Home base: 0, -95.123456789123');
  } finally { Object.assign(snapshot, previous); }
});

test('actual Strategy dispatch excludes invalid, missing and future saved news dates', async () => {
  const previousNews = briefing.news;
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-30T02:00:00Z'));
  briefing.news = { items: [
    { title: 'Saved fresh road closure', published_date: '2026-09-29', impact: 'high' },
    { title: 'Saved future report', published_date: '2026-10-01', impact: 'high' },
    { title: 'Saved impossible report', published_date: '2026-09-31', impact: 'high' },
    { title: 'Saved undated report', impact: 'high' },
    { title: 'Saved old report', published_date: '2026-09-20', impact: 'high' },
  ] };
  try {
    await runImmediateStrategy(snapshot.snapshot_id);
    const prompt = model.mock.calls[0][1].user;
    expect(prompt).toContain('Saved fresh road closure');
    expect(prompt).not.toMatch(/Saved (future|impossible|undated|old) report/);
  } finally { briefing.news = previousNews; jest.useRealTimers(); }
});
