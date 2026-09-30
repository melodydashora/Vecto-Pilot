import { jest, afterEach, test, expect } from '@jest/globals';
import { makeCircuit } from '../../server/util/circuit.js';

afterEach(() => jest.useRealTimers());
const fail = async () => { throw new Error('fixture outage'); };

test('healthy completions reset consecutive failures while closed', async () => {
  const run = makeCircuit({ name: 'fixture', failureThreshold: 3 });
  for (let n = 0; n < 5; n++) {
    await expect(run(fail)).rejects.toThrow('fixture outage');
    await expect(run(async () => 'healthy')).resolves.toBe('healthy');
  }
});

test('only one recovery probe enters and a failed probe immediately reopens', async () => {
  jest.useFakeTimers();
  const run = makeCircuit({ name: 'fixture', failureThreshold: 2, resetAfterMs: 100 });
  await expect(run(fail)).rejects.toThrow();
  await expect(run(fail)).rejects.toThrow();
  jest.advanceTimersByTime(100);
  let rejectProbe;
  const probe = run(() => new Promise((_resolve, reject) => { rejectProbe = reject; }));
  await expect(run(async () => 'extra probe')).rejects.toMatchObject({ code: 'circuit_open' });
  rejectProbe(new Error('probe failed'));
  await expect(probe).rejects.toThrow('probe failed');
  await expect(run(async () => 'too early')).rejects.toMatchObject({ code: 'circuit_open' });
  jest.advanceTimersByTime(100);
  await expect(run(async () => 'recovered')).resolves.toBe('recovered');
  await expect(run(async () => 'normal')).resolves.toBe('normal');
});

test('late calls from before the open state cannot close or reopen a recovered circuit', async () => {
  jest.useFakeTimers();
  const run = makeCircuit({ name: 'fixture', failureThreshold: 1, resetAfterMs: 100 });
  let resolveOld, rejectOld;
  const oldSuccess = run(() => new Promise(resolve => { resolveOld = resolve; }));
  const oldFailure = run(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  await expect(run(fail)).rejects.toThrow();
  jest.advanceTimersByTime(100);
  let resolveProbe;
  const probe = run(() => new Promise(resolve => { resolveProbe = resolve; }));
  resolveOld('old success');
  await expect(oldSuccess).resolves.toBe('old success');
  await expect(run(async () => 'extra probe')).rejects.toMatchObject({ code: 'circuit_open' });
  resolveProbe('recovered');
  await expect(probe).resolves.toBe('recovered');
  rejectOld(new Error('old failure'));
  await expect(oldFailure).rejects.toThrow('old failure');
  await expect(run(async () => 'still healthy')).resolves.toBe('still healthy');
});

test('a transport ignoring cancellation cannot return late success or hang callers', async () => {
  jest.useFakeTimers();
  const run = makeCircuit({ name: 'fixture', timeoutMs: 25, failureThreshold: 1 });
  let resolveLate, signal;
  const result = run(s => { signal = s; return new Promise(resolve => { resolveLate = resolve; }); });
  const rejected = expect(result).rejects.toMatchObject({ code: 'upstream_timeout' });
  await jest.advanceTimersByTimeAsync(25);
  await rejected;
  expect(signal.aborted).toBe(true);
  resolveLate('late result');
  await expect(run(async () => 'blocked')).rejects.toMatchObject({ code: 'circuit_open' });
});
