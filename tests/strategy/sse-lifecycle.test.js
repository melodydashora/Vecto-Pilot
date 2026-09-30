import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import express from 'express';
const subscribe = jest.fn();
const verify = jest.fn();
const read = jest.fn();
const isCurrent = jest.fn();
const phaseEmitter = new EventEmitter();
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/db-client.js', () => ({ subscribeToChannel: subscribe }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ verifySnapshotOwnership: verify }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuthAllowQueryToken: (_req, _res, next) => next(), isRequestAuthCurrent: isCurrent }));
jest.unstable_mockModule('../../server/events/phase-emitter.js', () => ({ phaseEmitter }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ sseLog: log, chainLog: jest.fn(), OP: {} }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: () => {
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: read }; return chain;
} } }));
const { default: router } = await import('../../server/api/strategy/strategy-events.js');
let active, unsubscribes, open;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  jest.clearAllMocks(); isCurrent.mockResolvedValue(true); active = new Map(); unsubscribes = []; open = [];
  verify.mockResolvedValue({ ok: true, snapshot: { snapshot_id: 'owned' } });
  read.mockResolvedValue([{ snapshot_id: 'owned', has_strategy_for_now: true, status: 'ok' }]);
  subscribe.mockImplementation(async (channel, callback) => {
    active.set(channel, callback);
    const unsubscribe = jest.fn(async () => active.delete(channel));
    unsubscribes.push(unsubscribe); return unsubscribe;
  });
});
afterEach(async () => {
  for (const { req, res } of open) { req.emit('close'); res.emit('close'); }
  await new Promise(resolve => setImmediate(resolve));
  phaseEmitter.removeAllListeners();
});
function invoke(path, snapshot = 'owned') {
  const req = new EventEmitter(); Object.assign(req, { query: { snapshot_id: snapshot }, auth: { userId: 'owner' } });
  const res = new EventEmitter(); Object.assign(res, {
    statusCode: 200, chunks: [], writableEnded: false, destroyed: false,
    writeHead(code) { this.statusCode = code; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.writableEnded = true; },
  });
  open.push({ req, res });
  const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
  return { req, res, done: Promise.resolve(handler(req, res)) };
}
test.each(['/events/strategy', '/events/briefing', '/events/blocks'])('%s subscribes before reading recovery state so the registration gap cannot lose completion', async path => {
  let completed = false;
  read.mockImplementation(async () => [{ snapshot_id: 'owned', has_strategy_for_now: completed, has_weather: completed, ranking_id: completed ? 'saved' : null }]);
  subscribe.mockImplementation(async (channel, callback) => {
    // Completion occurs just before the listener is registered, without delivery.
    completed = true; active.set(channel, callback); return async () => active.delete(channel);
  });
  const stream = invoke(path); await stream.done;
  const wire = stream.res.chunks.join('');
  expect(wire).toContain('event: state');
  if (path.endsWith('strategy')) expect(wire).toContain('"has_strategy_for_now":true');
  if (path.endsWith('briefing')) expect(wire).toContain('"has_weather":true');
  if (path.endsWith('blocks')) expect(wire).toContain('"ranking_id":"saved"');
});
test('a partial Briefing subscription failure releases every acquired listener', async () => {
  const release = jest.fn(async () => {});
  subscribe.mockResolvedValueOnce(release).mockRejectedValueOnce(new Error('connection failed'));
  const stream = invoke('/events/briefing'); await stream.done;
  expect(release).toHaveBeenCalledTimes(1); expect(stream.res.writableEnded).toBe(true);
});
test('closing while subscription is pending immediately releases it and stops registering more channels', async () => {
  const pending = deferred(), release = jest.fn(async () => {});
  subscribe.mockReturnValueOnce(pending.promise);
  const stream = invoke('/events/briefing'); await new Promise(resolve => setImmediate(resolve));
  stream.res.emit('close'); stream.req.emit('close'); pending.resolve(release);
  await stream.done;
  expect(release).toHaveBeenCalledTimes(1); expect(subscribe).toHaveBeenCalledTimes(1);
});
test('phase stream emits only its owned snapshot and removes its listener on response close', async () => {
  const stream = invoke('/events/phase'); await stream.done;
  stream.res.chunks.length = 0;
  phaseEmitter.emit('change', { snapshot_id: 'foreign', phase: 'venues' });
  phaseEmitter.emit('change', { snapshot_id: 'owned', phase: 'routing' });
  await new Promise(resolve => setImmediate(resolve));
  expect(stream.res.chunks.join('')).not.toContain('foreign');
  expect(stream.res.chunks.join('')).toContain('routing');
  stream.res.emit('close'); await new Promise(resolve => setImmediate(resolve));
  expect(phaseEmitter.listenerCount('change')).toBe(0);
});
test('foreign snapshot is rejected before opening a stream or a database subscription', async () => {
  verify.mockResolvedValue({ ok: false, status: 404, body: { error: 'snapshot_not_found' } });
  const stream = invoke('/events/briefing', 'foreign'); await stream.done;
  expect(stream.res.statusCode).toBe(404); expect(subscribe).not.toHaveBeenCalled();
});

test('a real HTTP GET keeps streaming after request consumption and releases on socket close', async () => {
  const app = express(); app.use((req, _res, next) => { req.auth = { userId: 'owner' }; next(); }); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const released = deferred();
  subscribe.mockImplementation(async (channel, callback) => { active.set(channel, callback); return () => { active.delete(channel); released.resolve(); }; });
  let request;
  try {
    await new Promise((resolve, reject) => {
      request = get(`http://127.0.0.1:${server.address().port}/events/strategy?snapshot_id=owned`, response => {
        let text = '', sent = false;
        response.on('data', chunk => {
          text += chunk;
          if (!sent && text.includes('event: state')) {
            sent = true;
            if (!active.has('strategy_ready')) { reject(new Error('stream closed after GET consumption')); return; }
            active.get('strategy_ready')({ snapshot_id: 'owned', receipt: 'after-get-consumed' });
          }
          if (text.includes('after-get-consumed')) resolve();
        });
        response.on('error', reject);
      });
      request.on('error', reject);
    });
    request.destroy();
    await released.promise;
    expect(active.has('strategy_ready')).toBe(false);
  } finally {
    request?.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('remote session revocation closes the stream before delivering another owner notification', async () => {
  const stream = invoke('/events/strategy'); await stream.done;
  stream.res.chunks.length = 0; isCurrent.mockResolvedValue(false);
  active.get('strategy_ready')({ snapshot_id: 'owned', receipt: 'after-logout' });
  await new Promise(resolve => setImmediate(resolve));
  expect(stream.res.chunks.join('')).not.toContain('after-logout');
  expect(stream.res.writableEnded).toBe(true); expect(active.has('strategy_ready')).toBe(false);
});

test('database reconnect refreshes saved state for a still-open offer stream', async () => {
  let recovery;
  subscribe.mockImplementation(async (_channel, _callback, options) => { recovery = options.onReconnect; return async () => {}; });
  const stream = invoke('/events/offers'); await stream.done;
  stream.res.chunks.length = 0;
  read.mockResolvedValue([{ id: 'offer-during-db-outage' }]);
  await Promise.all([recovery(), recovery()]);
  expect(stream.res.chunks.join('')).toContain('offer-during-db-outage');
  expect(stream.res.chunks.join('').match(/event: state/g)).toHaveLength(1);
});


test('a reconnect overlapping a failed old read still wakes the connected reader', async () => {
  let recovery, rejectRead;
  read.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRead = reject; }));
  subscribe.mockImplementation(async (_channel, _callback, options) => { recovery = options.onReconnect; return async () => {}; });
  const stream = invoke('/events/offers');
  await new Promise(resolve => setImmediate(resolve));
  const pendingRecovery = recovery();
  rejectRead(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }));
  await Promise.all([stream.done, pendingRecovery]);
  expect(stream.res.chunks.join('')).toContain('event: state');
  expect(stream.res.chunks.join('')).toContain('"recovery":true');
  expect(stream.res.writableEnded).toBe(false);
});
