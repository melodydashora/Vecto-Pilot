import { jest, test, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
const spawn = jest.fn(() => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = jest.fn(); return child;
});
const closeSync = jest.fn();
jest.unstable_mockModule('node:child_process', () => ({ spawn }));
jest.unstable_mockModule('node:fs', () => ({ openSync: () => 19, closeSync }));
process.env.MAX_WORKER_RESTARTS = '3'; process.env.RESTART_BACKOFF_MS = '50';
const { spawnChild, startStrategyWorker, getChildren, killAllChildren } = await import('../../server/bootstrap/workers.js');
afterEach(() => jest.useRealTimers());
test('error plus exit schedules one restart; late old-child callbacks preserve the replacement', () => {
  jest.useFakeTimers();
  const first = spawnChild('fixture', 'not-executed', []);
  expect(spawnChild('fixture', 'not-executed', [])).toBe(first);
  first.emit('error', new Error('spawn failure')); first.emit('exit', 1);
  jest.advanceTimersByTime(50);
  const second = getChildren().get('fixture'); expect(second).not.toBe(first); expect(spawn).toHaveBeenCalledTimes(2);
  first.emit('exit', 1); expect(getChildren().get('fixture')).toBe(second);
  second.emit('exit', 1); jest.advanceTimersByTime(50);
  const third = getChildren().get('fixture'); third.emit('exit', 1); jest.advanceTimersByTime(1000);
  expect(spawn).toHaveBeenCalledTimes(3); expect(getChildren().has('fixture')).toBe(false);
});
test('stdout and file strategy starts share ownership; parent descriptor is closed', () => {
  const child = startStrategyWorker({ useLogFile: true });
  expect(startStrategyWorker({ useLogFile: false })).toBe(child);
  expect(closeSync).toHaveBeenCalledWith(19); expect(spawn.mock.calls.at(-1)[2].stdio).toEqual(['ignore', 19, 19]);
  child.emit('exit', 0);
});
test('shutdown cancels queued restarts and fences pending child callbacks', () => {
  jest.useFakeTimers();
  const child = spawnChild('shutdown-fixture', 'not-executed', []); child.emit('exit', 1);
  const live = spawnChild('live-fixture', 'not-executed', []);
  const count = spawn.mock.calls.length; killAllChildren();
  expect(live.kill).toHaveBeenCalledWith('SIGTERM'); live.emit('error', new Error('shutdown'));
  jest.advanceTimersByTime(1000);
  expect(spawn).toHaveBeenCalledTimes(count); expect(startStrategyWorker()).toBeNull();
});
