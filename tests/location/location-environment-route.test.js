import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';

let owned, admission;
const measurements = { weather: jest.fn(), air: jest.fn() };
const enrich = jest.fn(), assertRun = jest.fn(), assertSnapshot = jest.fn();
const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [owned] }) }) }) };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: owned.user_id, sessionId: owned.session_id }; next(); } }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (req, _res, next) => { req.snapshot = owned; next(); } }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({
  assertCurrentMainRun: assertRun, assertMainRunForSnapshot: assertSnapshot,
}));
jest.unstable_mockModule('../../server/lib/location/main-run-snapshot.js', () => ({
  portalSnapshotHandler: jest.fn(),
  sendSnapshotError: (res, error) => res.status(error.status || 500).json({ ok: false, error: error.code || 'snapshot_failed' }),
}));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: measurements }));
jest.unstable_mockModule('../../server/lib/location/enrich-snapshot.js', () => ({ enrichSnapshot: enrich }));
const { default: router } = await import('../../server/api/location/location.js');
const app = express().use(express.json()).use('/api/location', router);
const blocked = () => Object.assign(new Error('main_run_required'), { status: 409, code: 'main_run_required' });
beforeEach(() => {
  owned = completeSnapshot();
  admission = { run_id: 'run-fixture', snapshot_id: null };
  jest.clearAllMocks();
  assertRun.mockImplementation(async (_auth, runId) => { if (runId !== admission.run_id) throw blocked(); return admission; });
  assertSnapshot.mockResolvedValue(admission);
  enrich.mockResolvedValue(owned);
  measurements.weather.mockResolvedValue(owned.weather); measurements.air.mockResolvedValue(owned.air);
});

test('enrichment uses owned persisted coordinates and passes the explicit run to admission', async () => {
  const result = await request(app).patch('/api/location/snapshot/' + owned.snapshot_id + '/enrich').send({ runId: admission.run_id, lat: 45, lng: 90, weather: { tempF: 999 } });
  expect(result.status).toBe(200);
  expect(assertSnapshot).toHaveBeenCalledWith(owned.snapshot_id, { auth: { userId: owned.user_id, sessionId: owned.session_id }, runId: admission.run_id });
  expect(enrich).toHaveBeenCalledWith(owned, owned.user_id);
  expect(result.body.weather).toEqual(owned.weather);
});

test('revoked enrichment and provider failure cannot return browser success', async () => {
  assertSnapshot.mockRejectedValueOnce(blocked());
  expect((await request(app).patch('/api/location/snapshot/' + owned.snapshot_id + '/enrich').send({ weather: owned.weather })).status).toBe(409);
  expect(enrich).not.toHaveBeenCalled();
  enrich.mockRejectedValueOnce(new Error('fixture unavailable'));
  expect((await request(app).patch('/api/location/snapshot/' + owned.snapshot_id + '/enrich').send({ weather: owned.weather })).status).toBe(500);
});

test.each(['weather', 'airquality'])('%s requires valid coordinates and current admission before provider calls', async path => {
  const provider = measurements[path === 'weather' ? 'weather' : 'air'];
  expect((await request(app).get('/api/location/' + path)).status).toBe(400);
  expect((await request(app).get('/api/location/' + path).query({ lat: 0, lng: 0 })).status).toBe(409);
  expect(provider).not.toHaveBeenCalled();
  const result = await request(app).get('/api/location/' + path).query({ lat: 1.123456789, lng: 2.123456789, runId: admission.run_id });
  expect(result.status).toBe(200);
  expect(provider).toHaveBeenCalledWith(1.123456789, 2.123456789, { scope: admission.run_id });
});

test.each(['weather', 'airquality'])('%s shows the immutable admitted source after binding and rejects another coordinate', async path => {
  admission.snapshot_id = owned.snapshot_id;
  const provider = measurements[path === 'weather' ? 'weather' : 'air'];
  const result = await request(app).get('/api/location/' + path).query({ lat: owned.lat, lng: owned.lng, runId: admission.run_id });
  expect(result.status).toBe(200); expect(provider).not.toHaveBeenCalled();
  const mismatch = await request(app).get('/api/location/' + path).query({ lat: 0.0000001, lng: owned.lng, runId: admission.run_id });
  expect(mismatch.status).toBe(409); expect(provider).not.toHaveBeenCalled();
});

test('late environmental response is rejected if the run changed during provider work', async () => {
  measurements.weather.mockImplementationOnce(async () => { assertRun.mockRejectedValueOnce(blocked()); return owned.weather; });
  const result = await request(app).get('/api/location/weather').query({ lat: 0, lng: 0, runId: admission.run_id });
  expect(result.status).toBe(409); expect(result.body.ok).toBe(false);
});
