import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';

const clients = [], plans = [];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class Client extends EventEmitter {
  constructor(config) {
    super(); this.config = config; this.plan = plans.shift() || {}; this.listening = new Set(); clients.push(this);
    this.connect = jest.fn(async () => { await this.plan.connect?.(); this._connected = true; });
    this.end = jest.fn(async () => { this._connected = false; });
    this.query = jest.fn(async sql => {
      await this.plan.query?.(sql, this);
      const match = /^(UNLISTEN|LISTEN) "?([a-z_]+)"?$/.exec(sql);
      if (match?.[1] === 'LISTEN') this.listening.add(match[2]);
      if (match?.[1] === 'UNLISTEN') this.listening.delete(match[2]);
      return { rows: [] };
    });
  }
}
let api;
const originalUrl = process.env.DATABASE_URL;
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers(); clients.length = 0; plans.length = 0;
  process.env.DATABASE_URL = 'postgres://fixture:synthetic@127.0.0.1:5432/listen_fixture?sslmode=disable';
  jest.unstable_mockModule('pg', () => ({ default: { Client } }));
  jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ dbLog: { info: jest.fn(), phase: jest.fn(), done: jest.fn(), error: jest.fn() }, chainLog: jest.fn(), OP: { DB: 'DB' } }));
  api = await import('../../server/db/db-client.js');
});
afterEach(async () => {
  await api.closeListenClient(); jest.clearAllTimers(); jest.useRealTimers();
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
});

test('concurrent subscriptions await their shared LISTEN and both fail if it fails', async () => {
  const gate = deferred(); plans.push({ query: () => gate.promise });
  const a = api.subscribeToChannel('strategy_ready', jest.fn());
  const b = api.subscribeToChannel('strategy_ready', jest.fn());
  let secondSettled = false; b.then(() => { secondSettled = true; }, () => { secondSettled = true; });
  const outcomes = Promise.allSettled([a, b]);
  await flush(); expect(secondSettled).toBe(false);
  gate.reject(new Error('fixture LISTEN rejected'));
  expect((await outcomes).map(value => value.status)).toEqual(['rejected', 'rejected']);
});
test('failed LISTEN leaves no poisoned empty channel and the next subscription really LISTENs', async () => {
  plans.push({ query: () => { throw new Error('fixture LISTEN rejected'); } });
  await expect(api.subscribeToChannel('strategy_ready', jest.fn())).rejects.toThrow();
  // On implementations retaining the same client, the provider has recovered.
  clients[0].plan = {};
  const cb = jest.fn(); const stop = await api.subscribeToChannel('strategy_ready', cb);
  const current = clients.at(-1);
  expect(current.listening.has('strategy_ready')).toBe(true);
  current.emit('notification', { channel: 'strategy_ready', payload: 'fresh' });
  expect(cb).toHaveBeenCalledWith('fresh'); await stop();
});
test('the dispatcher can receive the first notification in the LISTEN completion window', async () => {
  plans.push({ query: (sql, client) => { if (sql.startsWith('LISTEN')) client.emit('notification', { channel: 'strategy_ready', payload: 'first' }); } });
  const cb = jest.fn(); const stop = await api.subscribeToChannel('strategy_ready', cb);
  expect(cb).toHaveBeenCalledWith('first'); await stop();
});
test('releasing a subscription after close never opens another database connection', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  await api.closeListenClient(); await stop();
  expect(clients).toHaveLength(1);
});
test('close during a pending connect rejects that attempt and never publishes its eventual result', async () => {
  const gate = deferred(); plans.push({ connect: () => gate.promise });
  const pending = api.getListenClient(); const outcome = Promise.allSettled([pending]);
  await flush(); await api.closeListenClient(); gate.resolve();
  expect((await outcome)[0].status).toBe('rejected');
  await jest.advanceTimersByTimeAsync(60_000);
  expect(clients).toHaveLength(1); expect(clients[0].end).toHaveBeenCalled();
});
test('close cancels scheduled reconnects even with surviving subscribers', async () => {
  await api.subscribeToChannel('strategy_ready', jest.fn());
  clients[0].emit('error', new Error('fixture socket lost'));
  await api.closeListenClient(); await jest.advanceTimersByTimeAsync(90_000);
  expect(clients).toHaveLength(1);
});
test('a connection with a failed restore is not returned as healthy', async () => {
  await api.subscribeToChannel('strategy_ready', jest.fn());
  await api.closeListenClient(); plans.push({ query: () => { throw new Error('fixture re-LISTEN rejected'); } });
  await expect(api.getListenClient()).rejects.toThrow();
});
test('reconnect uses the same TLS settings and exactly one dispatcher, ignoring orphaned clients', async () => {
  const cb = jest.fn(); const stop = await api.subscribeToChannel('strategy_ready', cb);
  const old = clients[0]; old.emit('error', new Error('fixture socket lost'));
  await jest.advanceTimersByTimeAsync(1000); await flush();
  expect(clients).toHaveLength(2);
  const next = clients[1]; expect(next.config.ssl).toEqual(old.config.ssl);
  expect(next.listenerCount('notification')).toBe(1);
  old.emit('notification', { channel: 'strategy_ready', payload: 'orphan' });
  next.emit('notification', { channel: 'strategy_ready', payload: 'current' });
  expect(cb.mock.calls).toEqual([['current']]); await stop();
});
test('last unsubscribe and a new subscription converge to an active LISTEN', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const newCb = jest.fn();
  await Promise.all([stop(), api.subscribeToChannel('strategy_ready', newCb)]);
  expect(clients.at(-1).listening.has('strategy_ready')).toBe(true);
  clients.at(-1).emit('notification', { channel: 'strategy_ready', payload: 'new' });
  expect(newCb).toHaveBeenCalledTimes(1);
});
test('independent registrations of the same callback have independent cleanup', async () => {
  const cb = jest.fn(); const first = await api.subscribeToChannel('strategy_ready', cb);
  const second = await api.subscribeToChannel('strategy_ready', cb); await first(); await first();
  clients.at(-1).emit('notification', { channel: 'strategy_ready', payload: 'remaining' });
  expect(cb).toHaveBeenCalledTimes(1); await second();
});
test('an unsubscribe waiting on recovery cannot UNLISTEN a newer subscriber', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const gate = deferred(); plans.push({ connect: () => gate.promise });
  clients[0].emit('error', new Error('fixture socket lost'));
  const release = stop();
  await jest.advanceTimersByTimeAsync(1000); gate.resolve(); await flush();
  const nextStop = await api.subscribeToChannel('strategy_ready', jest.fn());
  await jest.advanceTimersByTimeAsync(1000); await release;
  expect(clients.at(-1).listening.has('strategy_ready')).toBe(true);
  await nextStop();
});
test('a new connection survives the late completion of a previously closed attempt', async () => {
  const gate = deferred(); plans.push({ connect: () => gate.promise });
  const old = api.getListenClient(); const oldOutcome = Promise.allSettled([old]);
  await flush(); await api.closeListenClient();
  const latest = await api.getListenClient(); gate.resolve(); await oldOutcome; await flush();
  expect(await api.getListenClient()).toBe(latest);
  expect(clients).toHaveLength(2); expect(latest.end).not.toHaveBeenCalled();
});
test('a subscription arriving during UNLISTEN is restored before cleanup completes', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const gate = deferred(); const client = clients[0];
  client.plan.query = sql => sql.startsWith('UNLISTEN') ? gate.promise : undefined;
  const releasing = stop(); await flush();
  const adding = api.subscribeToChannel('strategy_ready', jest.fn());
  gate.resolve(); const [, nextStop] = await Promise.all([releasing, adding]);
  expect(client.listening.has('strategy_ready')).toBe(true); await nextStop();
});
test('failed automatic restore keeps retrying and eventually restores every surviving channel', async () => {
  const first = jest.fn(), second = jest.fn();
  await api.subscribeToChannel('strategy_ready', first); await api.subscribeToChannel('briefing_ready', second);
  plans.push({ query: sql => { if (sql.includes('briefing_ready')) throw new Error('fixture restore failure'); } });
  clients[0].emit('error', new Error('fixture socket lost'));
  await jest.advanceTimersByTimeAsync(1000); await flush();
  expect(clients[1].end).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2000); await flush();
  const latest = clients.at(-1);
  expect(latest.listening).toEqual(new Set(['strategy_ready', 'briefing_ready']));
  latest.emit('notification', { channel: 'briefing_ready', payload: 'restored' });
  expect(second).toHaveBeenCalledWith('restored');
});
test('close during a pending LISTEN rejects subscription and prevents later delivery', async () => {
  const gate = deferred(); plans.push({ query: () => gate.promise });
  const cb = jest.fn(); const subscribing = api.subscribeToChannel('strategy_ready', cb);
  const outcome = Promise.allSettled([subscribing]);
  await flush(); await api.closeListenClient(); gate.resolve();
  expect((await outcome)[0].status).toBe('rejected');
  clients[0].emit('notification', { channel: 'strategy_ready', payload: 'too late' });
  expect(cb).not.toHaveBeenCalled();
});
test.each(['strategy_ready; DROP TABLE x', 'a'.repeat(64), '', 'UPPER_CHANNEL'])('invalid channel %s never creates a database connection', async channel => {
  await expect(api.subscribeToChannel(channel, jest.fn())).rejects.toThrow('Invalid PostgreSQL notification channel');
  expect(clients).toHaveLength(0);
});

test('database-only reconnect wakes surviving readers once after channels are restored', async () => {
  const recovered = jest.fn(() => { expect(clients.at(-1).listening.has('offer_analyzed')).toBe(true); });
  const stop = await api.subscribeToChannel('offer_analyzed', jest.fn(), { onReconnect: recovered });
  expect(recovered).not.toHaveBeenCalled();
  clients[0].emit('error', new Error('fixture connection lost'));
  await jest.advanceTimersByTimeAsync(1000); await flush();
  expect(recovered).toHaveBeenCalledTimes(1);
  await stop(); clients[1].emit('error', new Error('fixture no subscribers'));
  await jest.advanceTimersByTimeAsync(30_000); expect(recovered).toHaveBeenCalledTimes(1);
});

test('last unsubscribe ends the idle physical client once and stops keepalive/reconnect work', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const client = clients[0];
  await stop(); await stop();
  expect(client.end).toHaveBeenCalledTimes(1);
  const queriesAtRelease = client.query.mock.calls.length;
  client.emit('error', new Error('late idle socket error'));
  await jest.advanceTimersByTimeAsync(600_000);
  expect(client.query).toHaveBeenCalledTimes(queriesAtRelease);
  expect(jest.getTimerCount()).toBe(0); expect(clients).toHaveLength(1);
  const callback = jest.fn(); const releaseNew = await api.subscribeToChannel('strategy_ready', callback);
  expect(clients).toHaveLength(2);
  clients[1].emit('notification', { channel: 'strategy_ready', payload: 'new connection' });
  expect(callback).toHaveBeenCalledWith('new connection');
  await releaseNew(); expect(clients[1].end).toHaveBeenCalledTimes(1);
});

test('final release aborts a pending automatic reconnect without closing a later subscriber', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const gate = deferred(); plans.push({ connect: () => gate.promise });
  clients[0].emit('error', new Error('fixture socket lost'));
  await jest.advanceTimersByTimeAsync(1000); await flush();
  expect(clients).toHaveLength(2);
  await stop(); expect(clients[1].end).toHaveBeenCalledTimes(1);
  const callback = jest.fn(); const next = api.subscribeToChannel('strategy_ready', callback);
  await flush(); expect(clients).toHaveLength(3);
  gate.resolve(); const releaseNew = await next; await flush();
  expect(clients[2].end).not.toHaveBeenCalled();
  clients[2].emit('notification', { channel: 'strategy_ready', payload: 'survived stale connect' });
  expect(callback).toHaveBeenCalledWith('survived stale connect');
  expect(clients[1].end).toHaveBeenCalledTimes(1);
  await releaseNew();
});

test('a new subscription can reopen while the previous idle client is still ending', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const gate = deferred(); const old = clients[0]; old.end.mockImplementation(() => gate.promise);
  try {
    const releasing = stop(); await flush();
    expect(old.end).toHaveBeenCalledTimes(1);
    const callback = jest.fn(); const releaseNew = await api.subscribeToChannel('strategy_ready', callback);
    expect(clients).toHaveLength(2);
    gate.resolve(); await releasing;
    expect(clients[1].end).not.toHaveBeenCalled();
    clients[1].emit('notification', { channel: 'strategy_ready', payload: 'new listener' });
    expect(callback).toHaveBeenCalledWith('new listener');
    await releaseNew();
  } finally { gate.resolve(); }
});

test('an explicit getListenClient owner survives the final subscription until explicit close', async () => {
  const stop = await api.subscribeToChannel('strategy_ready', jest.fn());
  const gate = deferred(); const client = clients[0];
  client.plan.query = sql => sql.startsWith('UNLISTEN') ? gate.promise : undefined;
  const releasing = stop(); await flush();
  expect(await api.getListenClient()).toBe(client);
  gate.resolve(); await releasing;
  expect(client.end).not.toHaveBeenCalled();
  await api.closeListenClient(); expect(client.end).toHaveBeenCalledTimes(1);
});

test('failed final subscription cancels its now-unneeded retry timer', async () => {
  plans.push({ query: () => { throw new Error('fixture LISTEN rejected'); } });
  await expect(api.subscribeToChannel('strategy_ready', jest.fn())).rejects.toThrow();
  await flush(); expect(jest.getTimerCount()).toBe(0);
  expect(clients[0].end).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60_000); expect(clients).toHaveLength(1);
});
