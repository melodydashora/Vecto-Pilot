// Real StrategyPage and RunSetupProvider with synthetic session and transport.
// An explicit click may retry the saved setup read; it never recaptures GPS.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES } from '@/constants/apiRoutes';

// jsdom lacks the browser clone API; this suite's drafts contain JSON values.
Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });

let identity = { user: { userId: 'strategy-retry-owner' }, token: 'synthetic-strategy-retry', isAuthenticated: true };
const refreshGPS = jest.fn(async () => null);
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => ({
  refreshGPS, contextReady: true, lastSnapshotId: 'prepared-source', isLoading: false,
}) }));
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({ useCoPilot: () => ({
  coords: { latitude: 41, longitude: -87 }, lastSnapshotId: 'completed-snapshot',
  strategyData: { status: 'ok' }, immediateStrategy: 'Completed saved guidance.',
  previousStrategy: null, previousBlocksData: null, historicalMap: null, rememberMap: jest.fn(),
  isStrategyFetching: false, snapshotData: null, blocks: [], blocksData: null,
  isBlocksLoading: false, blocksError: null, barsData: null, refetchBlocks: jest.fn(),
  enrichmentProgress: 100, strategyProgress: 100, enrichmentPhase: 'complete', pipelinePhase: 'complete',
  timeRemainingText: '', timezone: 'Etc/UTC',
}) }));
jest.unstable_mockModule('@/components/strategy/StrategyMap', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/BarsDataGrid', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.unstable_mockModule('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => null }));
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useActiveEventsQuery: () => ({ data: { events: [] } }) }));
jest.unstable_mockModule('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.unstable_mockModule('@/hooks/useStrategyLoadingMessages', () => ({ useStrategyLoadingMessages: () => ({
  badge: '', text: '', icon: '', step: '', messageCount: 1, currentIndex: 0,
}) }));

const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
const { default: StrategyPage } = await import('@/pages/co-pilot/StrategyPage');
let setup: ReturnType<typeof useRunSetup>;
let canonical: any;
let readUnavailable: boolean;
let client: QueryClient;
const originalFetch = global.fetch;
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
function Probe() { setup = useRunSetup(); return <StrategyPage />; }
function app() { return <QueryClientProvider client={client}><RunSetupProvider><Probe /></RunSetupProvider></QueryClientProvider>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function mount() {
  const view = render(app());
  await waitFor(() => expect(setup.preferencesConfirmed).toBe(true));
  return view;
}
async function interruptRead() {
  readUnavailable = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(setup.error).toBe('Temporarily unavailable.'));
  expect(setup.preferencesConfirmed).toBe(true); expect(setup.canContinue).toBe(false);
}
beforeEach(() => {
  identity = { user: { userId: 'strategy-retry-owner' }, token: 'synthetic-strategy-retry', isAuthenticated: true };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  readUnavailable = false; refreshGPS.mockClear();
  canonical = { sessionId: 'strategy-retry-session', settingsRevision: 1, rulesVersion: 1, rulesHash: 'retry-rules',
    profile: { userId: identity.user.userId }, vehicle: null, rules: {}, ready: true, missingFields: [],
    currentSnapshot: { snapshot_id: 'prepared-source', sourceSnapshotId: 'prepared-source', user_id: identity.user.userId,
      sessionId: 'strategy-retry-session', ready: true, briefingReady: true },
    currentRun: { runId: 'completed-run', snapshotId: 'completed-snapshot', sourceSnapshotId: 'prepared-source',
      sessionId: 'strategy-retry-session', settingsRevision: 1, rulesVersion: 1, rulesHash: 'retry-rules', status: 'complete' } };
  jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000049');
  global.fetch = jest.fn<typeof fetch>(async input => {
    if (String(input) === API_ROUTES.MAIN_RUNS.SETUP) return readUnavailable
      ? response({ message: 'Temporarily unavailable.' }, 503) : response(canonical);
    if (String(input) === API_ROUTES.MAIN_RUNS.CONTINUE) return response({ ...canonical.currentRun,
      runId: 'replacement-run', snapshotId: 'replacement-snapshot', status: 'running' });
    throw new Error('Unexpected synthetic request: ' + String(input));
  });
});
afterEach(() => {
  cleanup(); client.clear(); jest.restoreAllMocks(); global.fetch = originalFetch;
  expect(refreshGPS).not.toHaveBeenCalled();
});

test('manual Strategy retry recovers an interrupted canonical read and then admits the prepared context', async () => {
  await mount(); await interruptRead();
  readUnavailable = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  expect(jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(3);
  expect(setup.run?.runId).toBe('replacement-run');
  const calls = jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({ expectedSnapshotId: 'prepared-source', expectedSettingsRevision: 1 });
});

test('a still-unavailable canonical read keeps guidance and cannot admit Strategy', async () => {
  await mount(); await interruptRead();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  expect(setup.error).toBe('Temporarily unavailable.'); expect(setup.canContinue).toBe(false);
  expect(screen.getByTestId('immediate-strategy-card')).toHaveTextContent('Completed saved guidance.');
  expect(jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(3);
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test('canonical settings changed during the interrupted read require a new preference choice', async () => {
  await mount(); await interruptRead();
  readUnavailable = false; canonical = { ...canonical, settingsRevision: 2 };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  expect(setup.setup?.settingsRevision).toBe(2); expect(setup.preferencesConfirmed).toBe(false);
  expect(setup.reviewOpen).toBe(true); expect(setup.run).toBeNull();
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test.each(['Briefing', 'context'])('manual setup retry cannot admit a canonical snapshot with unfinished %s', async missing => {
  await mount(); await interruptRead(); readUnavailable = false;
  canonical = missing === 'Briefing' ? { ...canonical, currentSnapshot: { ...canonical.currentSnapshot, briefingReady: false } }
    : { ...canonical, currentContextPending: true };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test('a manual retry consumes the newly confirmed prepared source instead of the stale displayed source', async () => {
  await mount(); await interruptRead(); readUnavailable = false;
  canonical = { ...canonical, currentSnapshot: { ...canonical.currentSnapshot,
    snapshot_id: 'newly-prepared-source', sourceSnapshotId: 'newly-prepared-source' } };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  const calls = jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body)).expectedSnapshotId).toBe('newly-prepared-source');
});

test('a late manual setup read cannot release a newer editor decision', async () => {
  await mount(); await interruptRead(); readUnavailable = false;
  const pending = deferred<Response>();
  jest.mocked(fetch).mockImplementationOnce(() => pending.promise);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  act(() => { setup.editSetup(); setup.setEditorDraft('preferences', { keep: 'new typing' }); });
  await act(async () => { pending.resolve(response(canonical)); });
  expect(setup.view).toBe('editor'); expect(setup.run).toBeNull(); expect(setup.preferencesConfirmed).toBe(false);
  expect(setup.getEditorDraft('preferences')).toEqual({ keep: 'new typing' });
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test('a late manual setup read cannot admit into a replacement account and token', async () => {
  const view = await mount(); await interruptRead(); readUnavailable = false;
  const oldCanonical = JSON.parse(JSON.stringify(canonical));
  const pending = deferred<Response>();
  jest.mocked(fetch).mockImplementationOnce(() => pending.promise);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Strategy' })); });
  identity = { user: { userId: 'replacement-owner' }, token: 'synthetic-replacement-token', isAuthenticated: true };
  canonical = { ...canonical, sessionId: 'replacement-session', profile: { userId: identity.user.userId },
    currentSnapshot: { ...canonical.currentSnapshot, user_id: identity.user.userId, sessionId: 'replacement-session' },
    currentRun: { ...canonical.currentRun, runId: 'replacement-account-run', sessionId: 'replacement-session' } };
  view.rerender(app());
  await waitFor(() => expect(setup.setup?.profile?.userId).toBe('replacement-owner'));
  await act(async () => { pending.resolve(response(oldCanonical)); });
  expect(setup.run?.runId).toBe('replacement-account-run'); expect(setup.setup?.sessionId).toBe('replacement-session');
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});
