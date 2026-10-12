import { beforeAll, beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';

// Real route predicates and writes, in disposable PostgreSQL only. A newer
// Coach observation cannot change Briefing selection or event market authority.
let pg, orm, app;
const owner = '00000000-0000-4000-8000-000000000111';
const eventId = '00000000-0000-4000-8000-000000000112';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
const never = jest.fn(() => { throw new Error('Unexpected provider or pipeline work'); });
const getBriefingBySnapshotId = jest.fn();
const eventInSnapshotMarket = jest.fn();
const passthrough = (_req, _res, next) => next();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, _res, next) { req.auth = { userId: owner }; next(); } }));
jest.unstable_mockModule('../../server/middleware/require-operator.js', () => ({ isOperator: () => false }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: passthrough }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: passthrough }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-aggregator.js', () => ({ getBriefingBySnapshotId, generateAndStoreBriefing: never }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/weather.js', () => ({ fetchWeatherConditions: never }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/traffic.js', () => ({ fetchTrafficConditions: never }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/events.js', () => ({ filterInvalidEvents: never }));
jest.unstable_mockModule('../../server/lib/events/market-event-reader.js', () => ({ readMarketEvents: never, eventInSnapshotMarket, toBriefingEvent: never, eventOverlapsDisplayDays: never }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ chainLog: never, tagLog: never, matrixLog: console, triadLog: console, locationLog: console, OP: {} }));
const { default: router } = await import('../../server/api/briefing/briefing.js');

beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.snapshots, schema.discovered_events]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`).join(', ')})`);
  }
  orm = drizzle(pg, { schema });
  app = express().use(express.json()).use('/api/briefing', router);
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM snapshots; DELETE FROM discovered_events;');
  jest.clearAllMocks();
  getBriefingBySnapshotId.mockImplementation(id => completeBriefing(id));
  eventInSnapshotMarket.mockImplementation(async (_id, snapshot) => snapshot.city === 'MAIN fixture city');
  await orm.insert(schema.discovered_events).values({ id: eventId, title: 'Synthetic market event', is_active: true });
});
afterAll(async () => { await pg?.close(); });

async function insertSnapshots(includeWorkflow = true) {
  const now = Date.now();
  const workflow = completeSnapshot({ snapshot_id: randomUUID(), user_id: owner, createdAt: new Date(now - 1000), city: 'MAIN fixture city' });
  const coach = completeSnapshot({ snapshot_id: randomUUID(), user_id: owner, createdAt: new Date(now), city: 'Coach fixture city', permissions: { geolocation: 'granted', context_kind: 'coach' } });
  if (includeWorkflow) await orm.insert(schema.snapshots).values(workflow);
  await orm.insert(schema.snapshots).values(coach);
  return { workflow, coach };
}

test('current Briefing still reads the older workflow row after Coach captures elsewhere', async () => {
  const { workflow } = await insertSnapshots();
  const response = await request(app).get('/api/briefing/current').expect(200);
  expect(response.body.snapshot_id).toBe(workflow.snapshot_id);
  expect(response.body.location.city).toBe(workflow.city);
  expect(getBriefingBySnapshotId).toHaveBeenCalledTimes(1);
  expect(getBriefingBySnapshotId).toHaveBeenCalledWith(workflow.snapshot_id);
  expect(never).not.toHaveBeenCalled();
});
test('Coach-only history cannot stand in for a missing workflow Briefing', async () => {
  await insertSnapshots(false);
  await request(app).get('/api/briefing/current').expect(404);
  expect(getBriefingBySnapshotId).not.toHaveBeenCalled(); expect(never).not.toHaveBeenCalled();
});
test.each(['deactivate', 'reactivate'])('%s uses workflow market even when Coach has a newer city', async action => {
  const { workflow } = await insertSnapshots();
  await request(app).patch(`/api/briefing/event/${eventId}/${action}`).send({ reason: 'event_ended' }).expect(200);
  expect(eventInSnapshotMarket).toHaveBeenCalledTimes(1);
  expect(eventInSnapshotMarket).toHaveBeenCalledWith(eventId, { city: workflow.city, state: workflow.state, country: workflow.country });
  expect((await orm.select().from(schema.discovered_events))[0].is_active).toBe(action === 'reactivate');
  expect(never).not.toHaveBeenCalled();
});
test.each(['deactivate', 'reactivate'])('%s fails closed when Coach is the only snapshot', async action => {
  await insertSnapshots(false);
  await request(app).patch(`/api/briefing/event/${eventId}/${action}`).send({ reason: 'event_ended' }).expect(403);
  expect(eventInSnapshotMarket).not.toHaveBeenCalled();
  expect((await orm.select().from(schema.discovered_events))[0].is_active).toBe(true);
  expect(never).not.toHaveBeenCalled();
});
