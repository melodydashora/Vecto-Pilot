import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createAnonymousToken } from '../server/lib/concierge/anonymous-token.js';

const weather = jest.fn(), air = jest.fn(), timezone = jest.fn(), stream = jest.fn();
const search = jest.fn(), ask = jest.fn();
jest.unstable_mockModule('express-rate-limit', () => ({ default: () => (_req, _res, next) => next() }));
jest.unstable_mockModule('../server/lib/concierge/concierge-service.js', () => ({ searchNearby: search, askConcierge: ask, buildConciergeSystemPrompt: () => 'Fixture system' }));
jest.unstable_mockModule('../server/lib/location/geocode.js', () => ({ getTimezoneForCoords: timezone }));
jest.unstable_mockModule('../server/lib/location/snapshot-environment.js', () => ({ createSnapshotEnvironment: () => ({ weather, air }) }));
jest.unstable_mockModule('../server/lib/ai/adapters/index.js', () => ({ callModelStream: stream }));
const { default: router } = await import('../server/api/concierge/concierge.js');
const app = express().use(express.json()).use('/api/concierge', router);
let token;
const servers = [];
const makeServer = () => { const server = app.listen(0); servers.push(server); return server; };
const whenAborted = signal => new Promise(resolve => {
  if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true });
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
});
beforeEach(() => {
  process.env.JWT_SECRET = 'synthetic-concierge-key'; token = createAnonymousToken(); jest.clearAllMocks();
  weather.mockResolvedValue({ available: true, tempF: 32, conditions: 'Clear', source: { provider: 'google-weather' } });
  air.mockResolvedValue({ available: true, aqi: 0, category: 'Good', source: { provider: 'google-air-quality' } });
  timezone.mockResolvedValue('UTC');
});
test('optional weather and air use the shared measured provider contract with a separate public scope', async () => {
  const result = await request(app).get(`/api/concierge/p/${token}/weather`).query({ lat: 0, lng: 0 });
  expect(result.status).toBe(200);
  expect(result.body.weather.tempF).toBe(32); expect(result.body.airQuality.aqi).toBe(0);
  expect(weather).toHaveBeenCalledWith(0, 0, { scope: 'concierge:' + token });
  expect(air).toHaveBeenCalledWith(0, 0, { scope: 'concierge:' + token });
});
test('one optional source failing cannot fabricate measurements or hide the successful source', async () => {
  weather.mockRejectedValue(new Error('fixture weather outage'));
  const result = await request(app).get(`/api/concierge/p/${token}/weather`).query({ lat: 0, lng: 0 });
  expect(result.body).toMatchObject({ available: true, weather: null, airQuality: { aqi: 0 }, errors: { weather: expect.any(String) } });
});
test('timezone requests preserve distinctions beyond six decimals and coalesce exact concurrent coordinates', async () => {
  let settle;
  timezone.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const query = { lat: 1.000000001, lng: 2.000000001 };
  const a = request(app).get(`/api/concierge/p/${token}/context`).query(query).then(value => value);
  const b = request(app).get(`/api/concierge/p/${token}/context`).query(query).then(value => value);
  while (!settle) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  expect(timezone).toHaveBeenCalledTimes(1);
  settle('UTC'); await Promise.all([a, b]);
  timezone.mockResolvedValue('UTC');
  await request(app).get(`/api/concierge/p/${token}/context`).query({ ...query, lat: 1.000000009 });
  expect(timezone).toHaveBeenCalledTimes(2);
});
test('stream forwards all text parts and the final SSE record without a trailing newline', async () => {
  const raw = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] } }] });
  stream.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } })));
  const result = await request(app).post(`/api/concierge/p/${token}/ask-stream`).send({ lat: 0, lng: 0, question: 'Hello' });
  expect(result.text).toContain('Hello world');
  expect(stream.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
test('empty upstream output emits an error, never a successful done answer', async () => {
  stream.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.close(); } })));
  const result = await request(app).post(`/api/concierge/p/${token}/ask-stream`).send({ lat: 0, lng: 0, question: 'Hello' });
  expect(result.text).toContain('"error"');
  expect(result.text).not.toContain('"done":true');
});
test('guest disconnect aborts the upstream model dispatch', async () => {
  let signal;
  stream.mockImplementation((_role, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal?.addEventListener('abort', () => reject(new Error('fixture caller left')), { once: true });
  }));
  const server = makeServer();
  const pending = request(server).post(`/api/concierge/p/${token}/ask-stream`).send({ lat: 0, lng: 0, question: 'Hello' });
  pending.end(() => {});
  while (!stream.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
  pending.abort();
  await whenAborted(signal);
  expect(signal?.aborted).toBe(true);
  await new Promise(resolve => server.close(resolve));
});
test('guest disconnect during shared timezone resolution never starts a model request', async () => {
  let finishTimezone;
  timezone.mockImplementation(() => new Promise(resolve => { finishTimezone = resolve; }));
  const server = makeServer();
  const disconnected = new Promise(resolve => server.once('request', (_req, res) => res.once('close', resolve)));
  const pending = request(server).post(`/api/concierge/p/${token}/ask-stream`).send({ lat: 12.345, lng: 67.891, question: 'Hello' });
  pending.end(() => {});
  while (!finishTimezone) await new Promise(resolve => setImmediate(resolve));
  pending.abort();
  await disconnected;
  finishTimezone('UTC');
  await new Promise(resolve => setImmediate(resolve));
  expect(stream).not.toHaveBeenCalled();
  await new Promise(resolve => server.close(resolve));
});
test.each([['explore', search], ['ask', ask]])('%s forwards disconnect cancellation to the service', async (path, service) => {
  let signal;
  service.mockImplementation(options => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal?.addEventListener('abort', () => reject(new Error('fixture caller left')), { once: true });
  }));
  const server = makeServer();
  const pending = request(server).post(`/api/concierge/p/${token}/${path}`).send({ lat: 0, lng: 0, question: 'Hello' });
  pending.end(() => {});
  while (!service.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
  pending.abort();
  await whenAborted(signal);
  expect(signal?.aborted).toBe(true);
  await new Promise(resolve => server.close(resolve));
});
