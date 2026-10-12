import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { API_ROUTES } from '@/constants/apiRoutes';

Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });
let auth = { user: { userId: 'settings-owner' }, token: 'synthetic-token', isAuthenticated: true };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => auth }));
const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
let setup: ReturnType<typeof useRunSetup>;
function Probe() { setup = useRunSetup(); return null; }
let canonical: any;
const originalFetch = global.fetch;
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
const mount = async () => {
  const view = render(<RunSetupProvider><Probe /></RunSetupProvider>);
  await waitFor(() => expect(setup.loading).toBe(false));
  return view;
};
beforeEach(() => {
  auth = { user: { userId: 'settings-owner' }, token: 'synthetic-token', isAuthenticated: true };
  localStorage.clear();
  jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000081');
  canonical = { sessionId: 'session', settingsRevision: 2, rulesVersion: 3, rulesHash: 'old-hash',
    profile: { userId: auth.user.userId }, vehicle: null, rules: { retained: 'canonical' }, ready: true, missingFields: [],
    currentRun: { runId: 'old-run', snapshotId: 'old-snapshot', sessionId: 'session', settingsRevision: 2,
      rulesVersion: 3, rulesHash: 'old-hash', status: 'complete' } };
  global.fetch = jest.fn<typeof fetch>(async input => {
    if (String(input) !== API_ROUTES.MAIN_RUNS.SETUP) throw new Error('Unexpected request: ' + input);
    return response(canonical);
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); global.fetch = originalFetch; });

test('ready saved settings hydrate without a preference popup or automatic Strategy call', async () => {
  canonical.currentRun = null;
  await mount();
  expect(setup.canContinue).toBe(true);
  expect(setup.reviewOpen).toBe(false);
  expect(setup.run).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a confirmed Coach save retires the old run before readback and keeps Strategy held when readback fails', async () => {
  await mount();
  expect(setup.run?.runId).toBe('old-run');
  let resolve!: (value: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let pending!: Promise<boolean>;
  act(() => { pending = setup.finishSave(); });
  expect(setup.run).toBeNull();
  expect(setup.canContinue).toBe(false);
  expect(setup.saveUnconfirmed).toBe(true);
  expect(setup.reviewOpen).toBe(false);
  expect(JSON.parse(localStorage.getItem('vecto-saved-setup-changed')!).ownerId).toBe('settings-owner');
  await act(async () => { resolve(response({ message: 'Readback unavailable' }, 503)); expect(await pending).toBe(false); });
  expect(setup.run).toBeNull();
  expect(setup.canContinue).toBe(false);
  expect(setup.saveUnconfirmed).toBe(true);
  expect(setup.error).toBe('Readback unavailable');
});

test('readback keeps unsaved editor drafts and requires resolution before starting with the changed rules', async () => {
  await mount();
  act(() => setup.setEditorDraft('offerAnalyzer', { values: { retained: 'unsaved' }, version: 3 }));
  canonical = { ...canonical, rulesVersion: 4, rulesHash: 'new-hash', rules: { retained: 'coach-saved' } };
  await act(async () => { expect(await setup.finishSave()).toBe(true); });
  expect(setup.setup?.rulesVersion).toBe(4);
  expect(setup.getEditorDraft('offerAnalyzer')).toEqual({ values: { retained: 'unsaved' }, version: 3 });
  expect(setup.canContinue).toBe(false);
  expect(setup.saveUnconfirmed).toBe(false);
  expect(setup.reviewOpen).toBe(false);
  act(() => setup.reviewSetup());
  await waitFor(() => expect(setup.reviewOpen).toBe(true));
});

test('another tab settings receipt retires the prior run without a routine warning', async () => {
  await mount();
  canonical = { ...canonical, rulesVersion: 4, rulesHash: 'new-hash' };
  await act(async () => window.dispatchEvent(new StorageEvent('storage', {
    key: 'vecto-saved-setup-changed', newValue: JSON.stringify({ ownerId: 'settings-owner' }),
  })));
  expect(setup.setup?.rulesVersion).toBe(4);
  expect(setup.run).toBeNull();
  expect(setup.reviewOpen).toBe(false);
  expect(setup.canContinue).toBe(true);
});
