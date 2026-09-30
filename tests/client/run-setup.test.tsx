// Synthetic ownership/configuration transport only; no database, GPS or provider calls.
import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { API_ROUTES } from '@/constants/apiRoutes';

let identity = { user: { userId: 'driver-A' }, token: 'synthetic-A', isAuthenticated: true };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
let setup: ReturnType<typeof useRunSetup>;
const fixture = (revision = 1) => ({ sessionId: 'session-A', settingsRevision: revision, rulesVersion: 2, rulesHash: 'synthetic-rules-hash',
  profile: { userId: identity.user.userId, selectedServices: ['economy'] }, vehicle: null, rules: {}, ready: true, missingFields: [], currentRun: null });
let saved: ReturnType<typeof fixture>;
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const admitted = (id = 'run-A') => ({ runId: id, ...saved, snapshotId: 'admitted-snapshot-A', sourceSnapshotId: 'snapshot-A', status: 'running' });
async function start() { setup.confirmPreferences(); return setup.continueWithSavedPreferences('snapshot-A'); }
function Probe() { setup = useRunSetup(); return null; }
const app = () => <RunSetupProvider><Probe /></RunSetupProvider>;
async function mount() { const view = render(app()); await waitFor(() => expect(setup.loading).toBe(false)); return view; }
beforeEach(() => {
  identity = { user: { userId: 'driver-A' }, token: 'synthetic-A', isAuthenticated: true };
  saved = fixture();
  let uuid = 0;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` });
  global.fetch = jest.fn<typeof fetch>(async input => String(input) === API_ROUTES.MAIN_RUNS.SETUP ? response(saved) : response(admitted()));
});
afterEach(cleanup);
test('auth, setup hydration and editor navigation remain held until preference confirmation and explicit Strategy Continue', async () => {
  await mount();
  expect(setup.run).toBeNull();
  act(() => setup.editSetup());
  act(() => setup.reviewSetup());
  await waitFor(() => expect(setup.loading).toBe(false));
  expect(jest.mocked(fetch).mock.calls.every(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toBe(true);
  await act(async () => { expect(await start()).toBe(true); });
  expect(setup.run?.runId).toBe('run-A');
});
test('a pending save and failed canonical readback never release the hold', async () => {
  await mount();
  let release!: () => void;
  act(() => { release = setup.beginSave(); });
  await act(async () => { expect(await start()).toBe(false); });
  jest.mocked(fetch).mockResolvedValue(response({ message: 'Readback unavailable' }, 503));
  await act(async () => { expect(await setup.finishSave()).toBe(false); release(); });
  expect(setup.run).toBeNull(); expect(setup.view).toBe('editor');
  expect(setup.error).toBe('Readback unavailable');
  expect(setup.canContinue).toBe(false);
  const calls = jest.mocked(fetch).mock.calls.length;
  await act(async () => { expect(await start()).toBe(false); });
  expect(jest.mocked(fetch).mock.calls).toHaveLength(calls);
  jest.mocked(fetch).mockResolvedValue(response(saved));
  await act(async () => { await setup.reload(); });
  expect(setup.canContinue).toBe(true);
});

test('each confirmed save reopens the same held review; dismissal never admits', async () => {
  await mount();
  expect(setup.reviewOpen).toBe(true);
  for (let revision = 2; revision <= 3; revision++) {
    act(() => setup.editSetup());
    expect(setup.reviewOpen).toBe(false);
    let release!: () => void;
    act(() => { release = setup.beginSave(); });
    saved = fixture(revision);
    await act(async () => { expect(await setup.finishSave()).toBe(true); release(); });
    expect(setup.reviewOpen).toBe(true);
    expect(setup.setup?.settingsRevision).toBe(revision);
    expect(setup.run).toBeNull();
    act(() => setup.dismissReview());
    expect(setup.reviewOpen).toBe(false);
    expect(setup.run).toBeNull();
  }
  expect(jest.mocked(fetch).mock.calls.every(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toBe(true);
});

test('a failed or conflicted save remains held until successful save or explicit cancel and readback', async () => {
  await mount();
  let release!: () => void;
  act(() => { release = setup.beginSave(); });
  act(() => release());
  act(() => setup.reviewSetup());
  await waitFor(() => expect(setup.loading).toBe(false));
  expect(setup.canContinue).toBe(false);
  await act(async () => { expect(await start()).toBe(false); });
  act(() => setup.reviewSetup(true));
  await waitFor(() => expect(setup.canContinue).toBe(true));
  expect(setup.run).toBeNull();
});
test('double Continue admits once and lost response retry keeps the same request identity', async () => {
  await mount();
  const first = deferred<Response>();
  jest.mocked(fetch).mockReturnValueOnce(first.promise);
  let pending!: Promise<boolean>;
  act(() => { pending = start(); });
  await act(async () => { expect(await start()).toBe(false); });
  await act(async () => { first.resolve(response({ message: 'Lost response' }, 503)); await pending; });
  const firstBody = JSON.parse(String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  await act(async () => { expect(await start()).toBe(true); });
  const retryBody = JSON.parse(String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(retryBody.requestId).toBe(firstBody.requestId);
  act(() => setup.reviewSetup());
  await waitFor(() => expect(setup.loading).toBe(false));
  await act(async () => { await start(); });
  const nextBody = JSON.parse(String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(nextBody.requestId).not.toBe(firstBody.requestId);
});

test.each(['source', 'admitted clone'])('lost response retry keeps the original intent after canonical readback using %s', async context => {
  await mount();
  const bodies: Record<string, unknown>[] = [];
  const generated = jest.fn();
  window.addEventListener('vecto-strategy-started', generated);
  const firstRun = admitted('accepted-before-response-loss');
  jest.mocked(fetch).mockImplementation(async (input, init) => {
    if (input === API_ROUTES.MAIN_RUNS.SETUP) return response(saved);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (bodies.length === 1) {
      saved = { ...saved, currentRun: firstRun, currentSnapshot: { snapshot_id: firstRun.snapshotId,
        sourceSnapshotId: 'snapshot-A', user_id: identity.user.userId, sessionId: saved.sessionId } } as typeof saved;
      throw new TypeError('Response lost after admission committed');
    }
    return response(body.requestId === bodies[0].requestId ? { ...firstRun, replayed: true, current: true }
      : { ...admitted('unwanted-second-run'), current: true });
  });
  try {
    await act(async () => { expect(await start()).toBe(false); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(setup.setup?.currentRun?.runId).toBe(firstRun.runId);
    expect(setup.run).toBeNull();
    expect(generated).not.toHaveBeenCalled();
    await act(async () => { expect(await setup.continueWithSavedPreferences(
      context === 'source' ? 'snapshot-A' : firstRun.snapshotId)).toBe(true); });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(setup.run?.runId).toBe(firstRun.runId);
    expect(generated).toHaveBeenCalledTimes(1);
    // A completed intent is consumed; a later explicit Refresh is new work.
    await act(async () => { expect(await setup.continueWithSavedPreferences(firstRun.snapshotId)).toBe(true); });
    expect(bodies[2].requestId).not.toBe(bodies[0].requestId);
    expect(bodies[2].expectedRunId).toBe(firstRun.runId);
  } finally { window.removeEventListener('vecto-strategy-started', generated); }
});

test.each(['settings', 'rules version', 'rules hash', 'snapshot', 'edit'])('a lost response intent is invalidated by an explicit %s change', async change => {
  await mount();
  jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Response lost'));
  await act(async () => { expect(await start()).toBe(false); });
  const original = JSON.parse(String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  if (change === 'settings') saved = fixture(2);
  if (change === 'rules version') saved = { ...saved, rulesVersion: 3 };
  if (change === 'rules hash') saved = { ...saved, rulesHash: 'new-rules-hash' };
  if (change === 'edit') act(() => setup.editSetup());
  await act(async () => { await setup.reload(); });
  await act(async () => {
    setup.confirmPreferences();
    expect(await setup.continueWithSavedPreferences(change === 'snapshot' ? 'snapshot-B' : 'snapshot-A')).toBe(true);
  });
  const next = JSON.parse(String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(next.requestId).not.toBe(original.requestId);
  expect(next.expectedSettingsRevision).toBe(saved.settingsRevision);
  expect(next.expectedRulesVersion).toBe(saved.rulesVersion);
  expect(next.expectedRulesHash).toBe(saved.rulesHash);
  expect(next.expectedSnapshotId).toBe(change === 'snapshot' ? 'snapshot-B' : 'snapshot-A');
});

test('a superseded replay with unchanged settings requires preference review before a new intent', async () => {
  await mount();
  const newer = admitted('newer-run');
  jest.mocked(fetch).mockImplementation(async input => input === API_ROUTES.MAIN_RUNS.CONTINUE
    ? response({ ...admitted('earlier-run'), current: false }) : response({ ...saved, currentRun: newer }));
  await act(async () => { expect(await start()).toBe(false); });
  expect(setup.run).toBeNull();
  expect(setup.setup?.currentRun?.runId).toBe(newer.runId);
  expect(setup.preferencesConfirmed).toBe(false);
  expect(setup.reviewOpen).toBe(true);
  const calls = jest.mocked(fetch).mock.calls.length;
  await act(async () => { expect(await setup.continueWithSavedPreferences('snapshot-A')).toBe(false); });
  expect(jest.mocked(fetch).mock.calls).toHaveLength(calls);
  expect(setup.error).toMatch(/earlier setup/);
});
test.each(['edit', 'account'])('a late admitted response cannot release a newer %s hold', async mode => {
  const view = await mount();
  const late = deferred<Response>();
  jest.mocked(fetch).mockReturnValueOnce(late.promise);
  let pending!: Promise<boolean>;
  act(() => { pending = start(); });
  if (mode === 'edit') act(() => setup.editSetup());
  else { identity = { ...identity, user: { userId: 'driver-B' }, token: 'synthetic-B' }; saved = fixture(); view.rerender(app()); }
  await act(async () => { late.resolve(response(admitted())); expect(await pending).toBe(false); });
  expect(setup.run).toBeNull();
});
test('a replay marked no longer current remains held after a newer run or settings change', async () => {
  await mount();
  jest.mocked(fetch).mockImplementation(async input => input === API_ROUTES.MAIN_RUNS.CONTINUE
    ? response({ ...admitted('old-run'), current: false }) : response({ ...fixture(3), currentRun: { runId: 'new-run' } }));
  await act(async () => { expect(await start()).toBe(false); });
  expect(setup.run).toBeNull(); expect(setup.setup?.settingsRevision).toBe(3);
  expect(setup.error).toMatch(/earlier setup/);
});
test('a conflict updates summary but never retries Continue against changed revisions', async () => {
  await mount();
  jest.mocked(fetch).mockImplementation(async input => input === API_ROUTES.MAIN_RUNS.CONTINUE
    ? response({ message: 'Saved settings changed' }, 409) : response(fixture(2)));
  await act(async () => { expect(await start()).toBe(false); });
  expect(setup.run).toBeNull(); expect(setup.setup?.settingsRevision).toBe(2);
  expect(jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toHaveLength(1);
});

test('editing and saving releases an abandoned Continue so the new saved setup can start', async () => {
  await mount();
  const oldResponse = deferred<Response>();
  jest.mocked(fetch).mockReturnValueOnce(oldResponse.promise);
  let oldContinue!: Promise<boolean>;
  act(() => { oldContinue = start(); });
  const oldRequest = jest.mocked(fetch).mock.calls.at(-1)?.[1];
  act(() => setup.editSetup());
  let release!: () => void;
  act(() => { release = setup.beginSave(); });
  saved = fixture(2);
  await act(async () => { expect(await setup.finishSave()).toBe(true); release(); });
  expect(setup.canContinue).toBe(true);
  await act(async () => { expect(await start()).toBe(true); });
  expect(setup.run?.settingsRevision).toBe(2);
  expect(oldRequest?.signal?.aborted).toBe(true);
  await act(async () => { oldResponse.resolve(response({ ...admitted('old-run'), settingsRevision: 1 }));
    expect(await oldContinue).toBe(false); });
  expect(setup.run?.runId).toBe('run-A');
  expect(setup.run?.settingsRevision).toBe(2);
});


test('preference confirmation alone never starts Strategy or clears saved data', async () => {
  await mount();
  const calls = jest.mocked(fetch).mock.calls.length;
  await act(async () => { expect(await setup.continueWithSavedPreferences('snapshot-A')).toBe(false); });
  expect(setup.preferencesConfirmed).toBe(false);
  act(() => { expect(setup.confirmPreferences()).toBe(true); });
  expect(setup.preferencesConfirmed).toBe(true);
  expect(setup.view).toBe('ready');
  expect(setup.reviewOpen).toBe(false);
  expect(setup.run).toBeNull();
  expect(jest.mocked(fetch).mock.calls).toHaveLength(calls);
});

test('same-session remount and focus restore the current run with no admission or generation event', async () => {
  const run = admitted();
  saved = { ...saved, currentRun: run } as typeof saved;
  const generated = jest.fn();
  window.addEventListener('vecto-strategy-started', generated);
  const view = await mount();
  expect(setup.run?.snapshotId).toBe('admitted-snapshot-A');
  expect(setup.preferencesConfirmed).toBe(true);
  expect(setup.reviewOpen).toBe(false);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(setup.run?.snapshotId).toBe('admitted-snapshot-A');
  view.unmount();
  await mount();
  expect(setup.run?.snapshotId).toBe('admitted-snapshot-A');
  expect(jest.mocked(fetch).mock.calls.every(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toBe(true);
  expect(generated).not.toHaveBeenCalled();
  window.removeEventListener('vecto-strategy-started', generated);
});

test('canonical readback immediately precedes an explicit header refresh admission in the same task', async () => {
  await mount();
  act(() => { setup.confirmPreferences(); });
  await act(async () => {
    expect(await setup.reload()).not.toBeNull();
    expect(await setup.continueWithSavedPreferences('snapshot-A')).toBe(true);
  });
  const request = jest.mocked(fetch).mock.calls.find(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE);
  expect(JSON.parse(String(request?.[1]?.body)).expectedSnapshotId).toBe('snapshot-A');
});

test('an incomplete initial profile confirms ownership but cannot continue Strategy', async () => {
  saved = { ...saved, user: { userId: identity.user.userId }, profile: null, settingsRevision: null,
    ready: false, missingFields: ['profile'] } as unknown as typeof saved;
  await mount();
  expect(setup.setup?.profile).toBeNull();
  expect(setup.error).toBeNull();
  expect(setup.canContinue).toBe(false);
  act(() => { expect(setup.confirmPreferences()).toBe(false); });
  await act(async () => { expect(await setup.continueWithSavedPreferences('snapshot-A')).toBe(false); });
  expect(jest.mocked(fetch).mock.calls.every(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toBe(true);
});
