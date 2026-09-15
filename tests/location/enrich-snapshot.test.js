import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { snapshots } from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { getSnapshotReadiness } from '../../server/lib/location/snapshot-readiness.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb, pending;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });
const provider = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: { both: provider } }));
const { enrichSnapshot } = await import('../../server/lib/location/enrich-snapshot.js');
const read = async () => (await actualDb.select().from(snapshots).where(eq(snapshots.snapshot_id, pending.snapshot_id)))[0];
beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg);
  const table = getTableConfig(snapshots);
  await pg.exec(`CREATE TABLE snapshots (${table.columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(', ')})`);
}, 30_000);
beforeEach(async () => {
  await pg.exec('TRUNCATE snapshots');
  pending = completeSnapshot({ weather: null, air: null, status: 'pending' });
  await actualDb.insert(snapshots).values(pending);
  provider.mockReset();
  const ready = completeSnapshot();
  provider.mockResolvedValue({ weather: ready.weather, air: ready.air });
});
afterAll(async () => { await pg?.close(); });

test('actual SQL persists provider values, receipt and readiness atomically', async () => {
  const saved = await enrichSnapshot(pending, pending.user_id);
  expect(provider).toHaveBeenCalledWith(pending.lat, pending.lng);
  expect(saved).toEqual(completeSnapshot());
  expect(await read()).toEqual(saved);
  expect(getSnapshotReadiness(saved).ready).toBe(true);
});

test('completed source is immutable and a retry makes no provider call', async () => {
  const saved = await enrichSnapshot(pending, pending.user_id);
  provider.mockClear();
  expect(await enrichSnapshot(saved, saved.user_id)).toEqual(saved);
  expect(provider).not.toHaveBeenCalled();
  expect(await read()).toEqual(saved);
});

test('a late provider response cannot replace the first completed snapshot', async () => {
  let release;
  provider.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const delayed = enrichSnapshot(pending, pending.user_id);
  const first = await enrichSnapshot(pending, pending.user_id);
  release({ weather: { ...first.weather, tempF: 99 }, air: { ...first.air, aqi: 99 } });
  expect(await delayed).toEqual(first);
  expect(await read()).toEqual(first);
});

test('missing data never becomes ready, and provider failure leaves pending source intact', async () => {
  provider.mockRejectedValue(new Error('fixture environment failure'));
  await expect(enrichSnapshot(pending, pending.user_id)).rejects.toThrow('fixture environment failure');
  expect(await read()).toEqual(pending);
});

test('a different coordinate receipt cannot be saved', async () => {
  const other = completeSnapshot({ lat: 1, lng: 2 });
  provider.mockResolvedValue({ weather: other.weather, air: other.air });
  await expect(enrichSnapshot(pending, pending.user_id)).rejects.toThrow('does not match');
  expect(await read()).toEqual(pending);
});

test('source identity changed during provider work is rejected without an update', async () => {
  let release;
  provider.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const delayed = enrichSnapshot(pending, pending.user_id);
  const moved = completeSnapshot({ lat: 1, lng: 2, weather: null, air: null, status: 'pending' });
  await actualDb.update(snapshots).set(moved).where(eq(snapshots.snapshot_id, pending.snapshot_id));
  const measured = completeSnapshot();
  release({ weather: measured.weather, air: measured.air });
  await expect(delayed).rejects.toThrow('changed');
  expect(await read()).toEqual(moved);
});

test('completed legacy source without a receipt requires a new snapshot, preserving history', async () => {
  const old = completeSnapshot({ weather: { tempF: 4, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } });
  await actualDb.update(snapshots).set(old).where(eq(snapshots.snapshot_id, old.snapshot_id));
  await expect(enrichSnapshot(old, old.user_id)).rejects.toThrow('new snapshot');
  expect(provider).not.toHaveBeenCalled();
  expect(await read()).toEqual(old);
});

test('wrong owner is rejected before providers or writes', async () => {
  await expect(enrichSnapshot(pending, 'another-owner')).rejects.toThrow('ownership');
  expect(provider).not.toHaveBeenCalled();
  expect(await read()).toEqual(pending);
});
