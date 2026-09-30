import { setImmediate } from 'node:timers';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import process from 'node:process';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';

const subscribe = jest.fn();
const ensureSmartBlocksExist = jest.fn();
const assertCurrentStrategySource = jest.fn();
const assertMainRunForSnapshot = jest.fn();
const forbiddenNotify = jest.fn(async () => { throw new Error('Worker must not publish a second completion notification'); });
const snapshotId = '11111111-1111-4111-8111-111111111111';
const snapshot = completeSnapshot({ snapshot_id: snapshotId });
const db = { select: () => ({ from: table => ({ where: () => ({ limit: async () => getTableName(table) === 'strategies'
  ? [{ strategy_for_now: 'Current guidance' }] : getTableName(table) === 'briefings' ? [{}] : [snapshot] }) }) }), execute: forbiddenNotify };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/db/db-client.js', () => ({ subscribeToChannel: subscribe }));
jest.unstable_mockModule('../../server/api/strategy/blocks-fast.js', () => ({ ensureSmartBlocksExist }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({ assertMainRunForSnapshot }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-source-store.js', () => ({ assertCurrentStrategySource }));
let previousSignals;
beforeEach(() => {
  jest.resetModules(); jest.clearAllMocks();
  previousSignals = new Map(['SIGINT', 'SIGTERM'].map(name => [name, new Set(process.listeners(name))]));
  assertMainRunForSnapshot.mockResolvedValue({});
  assertCurrentStrategySource.mockResolvedValue({ strategy: { strategy_for_now: 'Current guidance' }, briefing: {} });
  ensureSmartBlocksExist.mockResolvedValue({ ranking: { ranking_id: 'saved-ranking' }, generated: true });
});
afterEach(() => {
  for (const [name, existing] of previousSignals) for (const handler of process.listeners(name)) {
    if (!existing.has(handler)) process.removeListener(name, handler);
  }
});
test('simultaneous and repeated start calls install exactly one listener and signal pair', async () => {
  let release;
  subscribe.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const { startConsolidationListener } = await import('../../server/jobs/triad-worker.js');
  const first = startConsolidationListener(), second = startConsolidationListener();
  await new Promise(resolve => setImmediate(resolve));
  release(jest.fn()); await Promise.all([first, second]);
  await startConsolidationListener();
  expect(subscribe).toHaveBeenCalledTimes(1);
  for (const [name, existing] of previousSignals) expect(process.listeners(name).filter(handler => !existing.has(handler))).toHaveLength(1);
});
test('failed subscription leaves no signal handlers and a later start can retry', async () => {
  subscribe.mockRejectedValueOnce(new Error('Synthetic disconnected listener')).mockResolvedValueOnce(jest.fn());
  const { startConsolidationListener } = await import('../../server/jobs/triad-worker.js');
  await expect(startConsolidationListener()).rejects.toThrow('Synthetic disconnected listener');
  for (const [name, existing] of previousSignals) expect(process.listeners(name).filter(handler => !existing.has(handler))).toHaveLength(0);
  await startConsolidationListener();
  expect(subscribe).toHaveBeenCalledTimes(2);
});
test('duplicate concurrent notifications share one generation attempt and never emit a second completion', async () => {
  subscribe.mockResolvedValue(jest.fn());
  const { startConsolidationListener } = await import('../../server/jobs/triad-worker.js');
  await startConsolidationListener();
  const receive = subscribe.mock.calls[0][1];
  let release;
  ensureSmartBlocksExist.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const first = receive(JSON.stringify({ snapshot_id: snapshotId }));
  await new Promise(resolve => setImmediate(resolve));
  const second = receive(JSON.stringify({ snapshot_id: snapshotId }));
  release({ ranking: { ranking_id: 'saved-ranking' } }); await Promise.all([first, second]);
  expect(ensureSmartBlocksExist).toHaveBeenCalledTimes(1);
  expect(forbiddenNotify).not.toHaveBeenCalled();
  expect(assertCurrentStrategySource).toHaveBeenCalledTimes(1);
});
test('a changed Strategy source cannot start venue generation from a notification', async () => {
  subscribe.mockResolvedValue(jest.fn());
  const { startConsolidationListener } = await import('../../server/jobs/triad-worker.js');
  await startConsolidationListener();
  assertCurrentStrategySource.mockRejectedValue(new Error('Source changed'));
  await subscribe.mock.calls[0][1](JSON.stringify({ snapshot_id: snapshotId }));
  expect(ensureSmartBlocksExist).not.toHaveBeenCalled();
  expect(forbiddenNotify).not.toHaveBeenCalled();
});
