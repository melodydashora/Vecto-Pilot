import { beforeAll, beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';

// Disposable actual SQL; only route authentication is synthetic. Neither a
// real workspace connection nor a provider is loaded or called by these tests.
let pg, orm, sourceId, cloneId, generation, app;
const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => {
  req.auth = { userId, sessionId }; next();
} }));
const { default: router } = await import('../../server/api/traffic/index.js');
const read = id => request(app).get('/traffic/incidents').query({ snapshot_id: id });
beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.users, schema.snapshots, schema.main_run_admissions, schema.discovered_traffic]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`).join(', ')})`);
  }
  orm = drizzle(pg, { schema });
  app = express().use('/traffic', router);
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE main_run_admissions, discovered_traffic, snapshots, users');
  sourceId = randomUUID(); cloneId = randomUUID(); generation = randomUUID();
  const source = completeSnapshot({ snapshot_id: sourceId, user_id: userId, session_id: sessionId,
    permissions: { geolocation: 'granted', context_kind: 'upstream' } });
  await orm.insert(schema.snapshots).values(source);
  await orm.insert(schema.snapshots).values({ ...source, snapshot_id: cloneId, permissions: {
    ...source.permissions, context_kind: 'strategy_context', context_source_snapshot_id: sourceId,
    context_source_generation_token: generation,
  } });
  await orm.insert(schema.main_run_admissions).values({ run_id: randomUUID(), user_id: userId,
    session_id: sessionId, snapshot_id: cloneId, request_id: randomUUID(), settings_revision: 1,
    rules_version: 1, rules_hash: 'synthetic-rules', configuration: { context_source: {
      snapshot_id: sourceId, briefing_generation_token: generation,
    } } });
  await orm.insert(schema.discovered_traffic).values({ id: randomUUID(), snapshot_id: sourceId,
    incident_id: 'synthetic-zero-coordinate', category: 'Lane Closed', severity: 'medium', description: 'Synthetic lane closure',
    lat: 0, lng: 0, delay_minutes: 0, is_highway: false, fetched_at: new Date('2026-09-29T18:00:00Z'),
  });
});
afterAll(async () => { await pg?.close(); });

test('an admitted clone reads the original observed incidents and retains their time and zero coordinates', async () => {
  const result = await read(cloneId).expect(200);
  expect(result.body).toMatchObject({ success: true, snapshot_id: cloneId, source_snapshot_id: sourceId,
    count: 1, fetched_at: '2026-09-29T18:00:00.000Z', incidents: [{ category: 'Lane Closed', incidentLat: 0, incidentLon: 0, delayMinutes: 0 }] });
  const rows = (await pg.query('SELECT snapshot_id FROM discovered_traffic')).rows;
  expect(rows).toEqual([{ snapshot_id: sourceId }]);
});

test('a newer current GPS pointer cannot replace the incident source of a historical owned clone', async () => {
  await orm.insert(schema.users).values({ user_id: userId, session_id: randomUUID(), current_snapshot_id: randomUUID() });
  const result = await read(cloneId).expect(200);
  expect(result.body).toMatchObject({ source_snapshot_id: sourceId, count: 1 });
});

test('an owned uncloned snapshot reads its original rows without an admission or new source lookup', async () => {
  const result = await read(sourceId).expect(200);
  expect(result.body).toMatchObject({ snapshot_id: sourceId, source_snapshot_id: sourceId, count: 1 });
});

test('a requested foreign snapshot cannot return incident data', async () => {
  await pg.query('UPDATE snapshots SET user_id=$1 WHERE snapshot_id=$2', [randomUUID(), cloneId]);
  const result = await read(cloneId).expect(404);
  expect(result.body.success).toBe(false);
  expect(result.body.incidents).toBeUndefined();
});

test.each(['owner', 'session', 'coordinates'])('a clone cannot follow original source with a different %s', async field => {
  if (field === 'owner') await pg.query('UPDATE snapshots SET user_id=$1 WHERE snapshot_id=$2', [randomUUID(), sourceId]);
  if (field === 'session') await pg.query('UPDATE snapshots SET session_id=$1 WHERE snapshot_id=$2', [randomUUID(), sourceId]);
  if (field === 'coordinates') await pg.query('UPDATE snapshots SET lat=3 WHERE snapshot_id=$1', [sourceId]);
  const result = await read(cloneId).expect(409);
  expect(result.body).toEqual({ success: false, error: 'traffic_source_unverified' });
});

test('an unverified source pointer cannot impersonate an admission receipt', async () => {
  await pg.exec('DELETE FROM main_run_admissions');
  const result = await read(cloneId).expect(409);
  expect(result.body.error).toBe('traffic_source_unverified');
});
