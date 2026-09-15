import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';

const snapshot = completeSnapshot();
const briefing = completeBriefing(snapshot.snapshot_id, { generation_token: 'synthetic-generation' });
let profile, profileError;
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
          driver_profiles: profile ? [profile] : [] })[table] || [];
      },
    };
    return query;
  },
  update: () => ({ set: value => ({ where: () => ({ returning: async () => { writes.push(value); return [value]; } }) }) }),
  transaction: async fn => fn(db),
};
const log = new Proxy({}, { get: () => jest.fn() });
const model = jest.fn(async () => ({ ok: true, output: 'GO: Stay near the named local venue. AVOID: No road issues reported. WHY: Use current demand evidence.' }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ triadLog: log, aiLog: log, dbLog: log, eventsLog: log, OP: {} }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
const { loadDriverPreferences, buildDriverPreferencesSection, buildEarningsContextSection, runImmediateStrategy } = await import('../../server/lib/ai/providers/consolidator.js');

beforeEach(() => { profile = undefined; profileError = undefined; model.mockClear(); writes.length = 0; });

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
