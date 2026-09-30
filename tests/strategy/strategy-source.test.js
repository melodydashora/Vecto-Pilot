import { setTimeout } from 'node:timers';
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { briefings, strategies, snapshots, driver_profiles, news_deactivations } from '../../shared/schema.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { strategyMatchesBriefing } from '../../server/lib/strategy/strategy-source.js';
import { getCoachContextProgress } from '../../server/lib/ai/coach-context-progress.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const admission = mainRunBoundary(db);
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);
const model = jest.fn();
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ triadLog: log, aiLog: log, dbLog: log, eventsLog: log, venuesLog: log, matrixLog: log, briefingLog: log, OP: {}, tagLog: jest.fn() }));
const { writeStrategySource, readStrategySource, mergeVenueCacheMetrics } = await import('../../server/lib/strategy/strategy-source-store.js');
const { runImmediateStrategy } = await import('../../server/lib/ai/providers/consolidator.js');
const snapshotId = '11111111-1111-4111-8111-111111111111';
const tokenA = '22222222-2222-4222-8222-222222222222';
const tokenB = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg);
  for (const table of [snapshots, driver_profiles, news_deactivations]) {
    const config = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(', ')})`);
  }
  await pg.exec(`CREATE TABLE strategies (
    id uuid DEFAULT gen_random_uuid(), snapshot_id uuid PRIMARY KEY, user_id uuid,
    status text, phase text, phase_started_at timestamptz, error_message text,
    strategy_for_now text, venue_cache_metrics jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE briefings (
    id uuid DEFAULT gen_random_uuid(), snapshot_id uuid PRIMARY KEY,
    news jsonb, weather_current jsonb, weather_forecast jsonb, traffic_conditions jsonb,
    events jsonb, school_closures jsonb, airport_conditions jsonb, holiday jsonb,
    status text, generation_token uuid, generated_at timestamptz,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`);
}, 30000);
beforeEach(async () => {
  admission.state.allowed = true;
  await pg.exec('TRUNCATE strategies, briefings, snapshots'); model.mockReset();
  await actualDb.insert(snapshots).values(completeSnapshot({ snapshot_id: snapshotId, createdAt: new Date().toISOString() }));
  await actualDb.insert(briefings).values(completeBriefing(snapshotId, { generation_token: tokenA, generated_at: new Date(Date.now() - 1000) }));
  await actualDb.insert(strategies).values({ snapshot_id: snapshotId, status: 'pending', strategy_for_now: null, venue_cache_metrics: { hits: 2, misses: 1 } });
});
afterAll(async () => { await pg?.close(); });

test('real SQL saves an exact source receipt while preserving cache counters', async () => {
  const saved = await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'Verified A guidance' });
  expect(saved.venue_cache_metrics).toMatchObject({ hits: 2, misses: 1, strategy_source: { briefing_generation_token: tokenA, snapshot_id: snapshotId } });
  const pair = await readStrategySource(snapshotId);
  expect(strategyMatchesBriefing(pair.strategy, pair.briefing, snapshotId)).toBe(true);
  expect(getCoachContextProgress({ ...pair }).strategy.state).toBe('complete');
});

test('superseded run cannot write Strategy success, failure or dispatch a model', async () => {
  const before = (await readStrategySource(snapshotId)).strategy;
  admission.state.allowed = false;
  for (const updates of [{ status: 'ok', strategy_for_now: 'Obsolete result' }, { status: 'error' }]) {
    await expect(writeStrategySource(snapshotId, tokenA, updates)).rejects.toMatchObject({ code: 'main_run_superseded' });
  }
  await expect(runImmediateStrategy(snapshotId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(model).not.toHaveBeenCalled();
  expect((await readStrategySource(snapshotId)).strategy).toEqual(before);
});

test('two direct callers cannot dispatch the same admitted Strategy stage twice', async () => {
  let release;
  model.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const first = runImmediateStrategy(snapshotId);
  const deadline = Date.now() + 4000;
  while (!model.mock.calls.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(model).toHaveBeenCalledTimes(1);
  await expect(runImmediateStrategy(snapshotId)).rejects.toMatchObject({ code: 'main_run_busy' });
  expect(model).toHaveBeenCalledTimes(1);
  release({ ok: true, output: 'The one admitted result' });
  await expect(first).resolves.toMatchObject({ ok: true });
  expect((await readStrategySource(snapshotId)).strategy.strategy_for_now).toBe('The one admitted result');
});

test.each(['success', 'failure'])('settings save during model request fences late %s and preserves existing state', async outcome => {
  let release, reject;
  const pending = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  model.mockReturnValueOnce(pending);
  const run = runImmediateStrategy(snapshotId).then(value => ({ value }), error => ({ error }));
  const deadline = Date.now() + 4000;
  while (!model.mock.calls.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(model).toHaveBeenCalledTimes(1);
  const before = (await readStrategySource(snapshotId)).strategy;
  admission.state.allowed = false;
  if (outcome === 'success') release({ ok: true, output: 'Obsolete answer' });
  else reject(new Error('Provider failed after preferences changed'));
  expect((await run).error).toMatchObject({ code: 'main_run_superseded' });
  expect((await readStrategySource(snapshotId)).strategy).toEqual(before);
});

test('a refreshed Briefing rejects late old success and failure without touching the Strategy row', async () => {
  await actualDb.update(briefings).set({ generation_token: tokenB, generated_at: new Date(Date.now() - 500) }).where(eq(briefings.snapshot_id, snapshotId));
  const before = (await readStrategySource(snapshotId)).strategy;
  expect(await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'Obsolete A' })).toBeNull();
  expect(await writeStrategySource(snapshotId, tokenA, { status: 'error', error_message: 'Obsolete failure' })).toBeNull();
  expect((await readStrategySource(snapshotId)).strategy).toEqual(before);
  expect(await writeStrategySource(snapshotId, tokenB, { status: 'ok', strategy_for_now: 'Verified B' })).not.toBeNull();
});

test('late duplicate failure or success cannot overwrite a completed Strategy', async () => {
  const first = await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'First completed answer' });
  expect(await writeStrategySource(snapshotId, tokenA, { status: 'error', error_message: 'late failure' })).toBeNull();
  expect(await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'late duplicate' })).toBeNull();
  expect((await readStrategySource(snapshotId)).strategy).toEqual(first);
});

test('venue progress cannot make A guidance current for completed Briefing B', async () => {
  await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'Keep this historical guidance' });
  await actualDb.update(briefings).set({ generation_token: tokenB, generated_at: new Date() }).where(eq(briefings.snapshot_id, snapshotId));
  await actualDb.update(strategies).set({ updated_at: new Date(Date.now() + 1000), phase: 'complete', status: 'ok' }).where(eq(strategies.snapshot_id, snapshotId));
  const pair = await readStrategySource(snapshotId);
  expect(pair.strategy.strategy_for_now).toBe('Keep this historical guidance');
  expect(strategyMatchesBriefing(pair.strategy, pair.briefing, snapshotId)).toBe(false);
  expect(getCoachContextProgress(pair).strategy.state).toBe('partial');
});

test('cache metrics merge cannot erase or forge the generation receipt', async () => {
  await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'Verified A' });
  await actualDb.update(strategies).set({ venue_cache_metrics: mergeVenueCacheMetrics({ hits: 8, misses: 0, hit_rate: 1, strategy_source: { briefing_generation_token: 'forged' } }) }).where(eq(strategies.snapshot_id, snapshotId));
  const pair = await readStrategySource(snapshotId);
  expect(pair.strategy.venue_cache_metrics).toMatchObject({ hits: 8, misses: 0, hit_rate: 1, strategy_source: { briefing_generation_token: tokenA } });
  expect(strategyMatchesBriefing(pair.strategy, pair.briefing, snapshotId)).toBe(true);
});

test('pending or partial sources cannot produce a Strategy receipt', async () => {
  await actualDb.update(briefings).set({ status: 'pending', generated_at: null }).where(eq(briefings.snapshot_id, snapshotId));
  expect(await writeStrategySource(snapshotId, tokenA, { status: 'ok', strategy_for_now: 'Unready answer' })).toBeNull();
  expect(await writeStrategySource(snapshotId, null, { status: 'error' })).toBeNull();
  expect((await readStrategySource(snapshotId)).strategy.strategy_for_now).toBeNull();
});

test.each(['success', 'failure'])('actual Consolidator late %s cannot overwrite a newer completed generation', async outcome => {
  let release, reject;
  const blocked = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  model.mockReturnValueOnce(blocked);
  const oldCall = runImmediateStrategy(snapshotId).then(value => ({ value }), error => ({ error }));
  const deadline = Date.now() + 4000;
  while (!model.mock.calls.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(model).toHaveBeenCalledTimes(1);
  await actualDb.update(briefings).set({ generation_token: tokenB, generated_at: new Date() }).where(eq(briefings.snapshot_id, snapshotId));
  const newer = await writeStrategySource(snapshotId, tokenB, { status: 'ok', strategy_for_now: 'Newer completed B' });
  if (outcome === 'success') release({ ok: true, output: 'Obsolete A answer' });
  else reject(new Error('Obsolete A provider failure'));
  const settled = await oldCall;
  expect(settled.error).toBeDefined();
  expect((await readStrategySource(snapshotId)).strategy).toEqual(newer);
});

test.each(['   \n  ', { text: 'Uncontracted object' }, ['Uncontracted array']])('invalid model output %p cannot become a saved successful Strategy', async output => {
  model.mockResolvedValue({ ok: true, output });
  await expect(runImmediateStrategy(snapshotId)).rejects.toThrow();
  const { strategy } = await readStrategySource(snapshotId);
  expect(strategy.strategy_for_now).toBeNull();
  expect(strategy.status).toBe('error');
  expect(strategy.venue_cache_metrics).not.toHaveProperty('strategy_source');
});
