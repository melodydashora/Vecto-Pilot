import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';

// Production Express handler and generated SQL, isolated from the supplied DB.
let pg, orm, app, a, b;
const db = new Proxy({}, { get: (_target, key) => orm[key].bind(orm) });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, res, next) {
  req.auth = { userId: req.headers['x-test-owner'] }; next();
} }));
const timer = jest.spyOn(global, 'setInterval').mockReturnValue({ unref() {} });
const { default: router } = await import('../../server/api/feedback/actions.js');
timer.mockRestore();
beforeAll(async () => {
  if (process.env.VECTO_RUN_DATABASE_TESTS === '1') {
    const selected = new URL(process.env.DATABASE_URL || '');
    if (selected.hostname !== '127.0.0.1' || selected.port !== '55432' || selected.pathname !== '/vecto_preview' ||
        process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') {
      throw new Error('Refusing action acceptance outside disposable 127.0.0.1:55432/vecto_preview.');
    }
    const { Pool } = await import('pg');
    const { drizzle: postgresDrizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const actual = (await pool.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0];
    expect(actual).toEqual({ name: 'vecto_preview', port: 55432 });
    pg = { exec: query => pool.query(query), query: (query, params) => pool.query(query, params), close: () => pool.end() };
    orm = postgresDrizzle(pool);
  } else {
    pg = new PGlite(); orm = drizzle(pg);
  }
  for (const table of [schema.snapshots, schema.rankings, schema.ranking_candidates, schema.actions, schema.venue_catalog, schema.venue_metrics]) {
    const config = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}`).join(',')})`);
  }
  await pg.exec(`ALTER TABLE actions ADD FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id);
    ALTER TABLE actions ADD FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id);`);
  app = express(); app.use(express.json()); app.use('/actions', router);
}, 30000);
async function seed() {
  const owner = randomUUID(), snapshot = randomUUID(), ranking = randomUUID(), venue = randomUUID(), block = randomUUID();
  await pg.query('INSERT INTO snapshots(snapshot_id,user_id) VALUES($1,$2)', [snapshot, owner]);
  await pg.query('INSERT INTO rankings(ranking_id,snapshot_id,user_id) VALUES($1,$2,$3)', [ranking, snapshot, owner]);
  await pg.query('INSERT INTO venue_catalog(venue_id,place_id) VALUES($1,$2)', [venue, block]);
  await pg.query('INSERT INTO venue_metrics(venue_id,times_chosen) VALUES($1,0)', [venue]);
  await pg.query('INSERT INTO ranking_candidates(id,ranking_id,venue_id,block_id,place_id) VALUES($1,$2,$3,$4,$4)', [randomUUID(), ranking, venue, block]);
  return { owner, snapshot, ranking, venue, block };
}
beforeEach(async () => {
  await pg.exec('TRUNCATE actions,ranking_candidates,rankings,snapshots,venue_metrics,venue_catalog CASCADE');
  a = await seed(); b = await seed();
});
afterAll(async () => { await pg?.close(); });
function send(scope, key, overrides = {}) {
  const req = request(app).post('/actions').set('x-test-owner', scope.owner);
  if (key) req.set('X-Idempotency-Key', key);
  return req.send({ ranking_id: scope.ranking, action: 'click', block_id: scope.block, ...overrides });
}
async function counts() {
  return {
    actions: (await pg.query('SELECT count(*)::int AS n FROM actions')).rows[0].n,
    clicks: (await pg.query('SELECT sum(times_chosen)::int AS n FROM venue_metrics')).rows[0].n,
  };
}
test('simultaneous retries persist one action and increment metrics once', async () => {
  const key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 6 }, () => send(a, key)));
  expect(responses.map(r => r.status)).toEqual(Array(6).fill(200));
  expect(new Set(responses.map(r => r.body.action_id)).size).toBe(1);
  expect(await counts()).toEqual({ actions: 1, clicks: 1 });
});
test('the same caller key is scoped to its authenticated owner', async () => {
  const key = randomUUID(), first = await send(a, key), second = await send(b, key);
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect(second.body.action_id).not.toBe(first.body.action_id);
  expect(await counts()).toEqual({ actions: 2, clicks: 2 });
});
test('reusing a key for a different action conflicts without another write', async () => {
  const key = randomUUID(); await send(a, key);
  const retry = await send(a, key, { action: 'view' });
  expect(retry.status).toBe(409); expect(await counts()).toEqual({ actions: 1, clicks: 1 });
});
test('a foreign ranking cannot be used for action attribution', async () => {
  const result = await send(a, randomUUID(), { ranking_id: b.ranking, block_id: b.block });
  expect(result.status).toBe(404); expect(await counts()).toEqual({ actions: 0, clicks: 0 });
});
test('a valid ranking cannot increment a venue that was not in its candidates', async () => {
  const result = await send(a, randomUUID(), { block_id: b.block });
  expect(result.status).toBe(404); expect(await counts()).toEqual({ actions: 0, clicks: 0 });
});
test('zero dwell/rank measurements survive storage, and action_type uses the documented alias', async () => {
  const response = await send(a, randomUUID(), { action: null, action_type: 'dwell', dwell_ms: 0, from_rank: 0 });
  expect(response.status).toBe(200);
  const saved = (await pg.query('SELECT action,dwell_ms,from_rank FROM actions')).rows[0];
  expect(saved).toEqual({ action: 'dwell', dwell_ms: 0, from_rank: 0 });
});
test('missing or conflicting action names are rejected before persistence', async () => {
  for (const overrides of [{ action: null }, { action_type: 'view' }]) {
    expect((await send(a, randomUUID(), overrides)).status).toBe(400);
  }
  expect(await counts()).toEqual({ actions: 0, clicks: 0 });
});
test('a metrics write failure rolls back the action so retry can complete exactly once', async () => {
  await pg.exec('ALTER TABLE venue_metrics ADD CONSTRAINT reject_click CHECK (times_chosen = 0)');
  const key = randomUUID();
  try {
    expect((await send(a, key)).status).toBe(500);
    expect(await counts()).toEqual({ actions: 0, clicks: 0 });
  } finally { await pg.exec('ALTER TABLE venue_metrics DROP CONSTRAINT reject_click'); }
  expect((await send(a, key)).status).toBe(200);
  expect(await counts()).toEqual({ actions: 1, clicks: 1 });
});
