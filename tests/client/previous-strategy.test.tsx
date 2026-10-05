// 2026-09-11: Synthetic transport; real CoPilotProvider and React Query cache.
// Auth/GPS and unrelated briefing/bars/progress/SSE transports are fixtures.
import React from 'react';
import { jest, describe, it, test, beforeEach, afterEach, expect } from '@jest/globals';
import { render, screen, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';

let auth = { isAuthenticated: true, user: { userId: 'driver-A' }, token: 'synthetic-A' };
let admittedRun: { runId: string; snapshotId: string } | null = { runId: 'run-A', snapshotId: 'snapshot-A' };
let rerenderCurrent: (() => void) | null = null;
let savedSetup: { sessionId: string; previousRun?: { runId: string; snapshotId: string; sessionId: string; status: string } } | undefined;
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({ run: admittedRun, setup: savedSetup }) }));
const refreshGPS = jest.fn(async () => {
  window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));
});
let location = { runId: 'run-A', lastSnapshotId: 'snapshot-A' as string | null, currentCoords: { latitude: 32, longitude: -97 },
  city: 'Fort Worth', state: 'TX', timeZone: 'America/Chicago', isLocationResolved: true, refreshGPS };
let strategyReady: ((id: string) => void) | undefined;
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => auth }));
jest.unstable_mockModule('@/contexts/location-context-clean', () => ({ useLocation: () => location }));
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({
  getAuthHeader: () => ({ Authorization: `Bearer ${auth.token}` }),
  subscribeStrategyReady: (_id: string, callback: (id: string) => void) => { strategyReady = callback; return () => {}; },
  subscribeBlocksReady: () => () => {}, subscribePhaseChange: () => () => {},
}));
jest.unstable_mockModule('@/hooks/useEnrichmentProgress', () => ({ useEnrichmentProgress: () => ({ progress: 0, strategyProgress: 0, phase: 'strategy', pipelinePhase: 'analyzing' }) }));
let briefingFailures: Record<string, string> = {};
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useBriefingQueries: ({ snapshotId }: { snapshotId: string }) => ({ isLoading: {}, generationError: briefingFailures[snapshotId] ?? null }) }));
jest.unstable_mockModule('@/hooks/useBarsQuery', () => ({ useBarsQuery: () => ({}) }));
const { CoPilotProvider, useCoPilot } = await import('@/contexts/co-pilot-context');
let current: ReturnType<typeof useCoPilot>;
let layoutReads: string[] = [];
let allowPartialCoach = false;
let showProbe = true;
function LayoutProbe({ stamp }: { stamp: string }) {
  React.useLayoutEffect(() => { layoutReads.push(document.body.textContent ?? ''); }, [stamp]);
  return null;
}
function Probe() {
  current = useCoPilot();
  return <main><span data-testid="current">{current.immediateStrategy ?? ''}</span>
    <span data-testid="previous">{JSON.stringify(current.previousStrategy ?? null)}</span>
    <span data-testid="venues">{current.blocks.map(block => block.name).join(',')}</span>
    <span data-testid="local-error">{current.strategyError}</span>
    <button onClick={() => current.setCriticalError({ type: 'auth_failed' })}>Fail auth</button>
    <button onClick={() => current.setCriticalError({ type: 'location_failed' })}>Fail GPS</button>
  </main>;
}
const clients: QueryClient[] = [];
const body = (id = 'snapshot-A', text = 'Completed A', overrides = {}) => ({
  snapshotId: id, status: 'ok', briefingStatus: 'complete', strategyFresh: true,
  strategyUpdatedAt: '2026-09-12T12:00:10Z', snapshotCreatedAt: '2026-09-12T12:00:00Z',
  strategy: { strategyForNow: text }, blocks: venueBlocks, rankingId: 'ranking-current', ...overrides,
});
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let payloads: Record<string, unknown>;
let venueBlocks: unknown[];
let strategyFetch: (id: string, init?: RequestInit) => Promise<Response>;
let snapshotFetch: (id?: string) => Promise<Response>;
function app(client: QueryClient) { return <QueryClientProvider client={client}><CoPilotProvider allowPartialCoach={allowPartialCoach}>{showProbe && <Probe />}</CoPilotProvider><LayoutProbe stamp={`${auth.token}:${auth.isAuthenticated}`} /></QueryClientProvider>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const view = render(app(client));
  rerenderCurrent = () => view.rerender(app(client));
  return { client, ...view };
}
async function saved(id: string) { await act(async () => {
  if (admittedRun) { admittedRun = { runId: `run-${id}`, snapshotId: id }; rerenderCurrent?.(); }
  else window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', { detail: { snapshotId: id, reason: 'resume' } }));
}); }
async function refetch(client: QueryClient, id = 'snapshot-A') {
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(id), type: 'active' }); await new Promise(resolve => setTimeout(resolve, 0)); });
}
beforeEach(() => {
  showProbe = true;
  briefingFailures = {};
  savedSetup = undefined;
  admittedRun = { runId: 'run-A', snapshotId: 'snapshot-A' };
  venueBlocks = [{ name: 'Current venue', placeId: 'place-current', coordinates: { lat: 32, lng: -97 } }];
  allowPartialCoach = false;
  auth = { isAuthenticated: true, user: { userId: 'driver-A' }, token: 'synthetic-A' };
  location = { ...location, lastSnapshotId: 'snapshot-A', city: 'Fort Worth', timeZone: 'America/Chicago' };
  payloads = { 'snapshot-A': body(), 'snapshot-B': body('snapshot-B', 'Retained server text', { status: 'pending', briefingStatus: 'pending', strategyFresh: false }) };
  strategyFetch = async id => response(payloads[id]);
  snapshotFetch = async () => response({ city: 'Fort Worth', timezone: 'America/Chicago', status: 'ready' });
  venueBlocks = [{ name: 'Current venue', placeId: 'place-current', coordinates: { lat: 32, lng: -97 } }];
  layoutReads = []; refreshGPS.mockClear(); localStorage.clear(); sessionStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') throw new Error('Unexpected generation request');
    if (url.startsWith('/api/blocks/strategy/')) return strategyFetch(url.split('/').at(-1)!, init);
    if (url.startsWith('/api/snapshot/')) return snapshotFetch(url.split('/').at(-1));
    if (url.startsWith('/api/blocks-fast?')) return response({ rankingId: 'ranking-current', blocks: venueBlocks });
    throw new Error(`Unexpected synthetic route ${url}`);
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); jest.restoreAllMocks(); });

describe('completed strategy history and current scope', () => {
  it('keeps the previous map across held setup and page unmount, while refusing old snapshot events', async () => {
    const { client, rerender } = mount();
    await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    const history = { sourceSnapshotId: 'snapshot-A', props: { driverLat: 32, driverLng: -97, venues: [], bars: [], events: [] } };
    act(() => current.rememberMap(history));
    admittedRun = null;
    rerender(app(client));
    expect(current.immediateStrategy).toBeNull();
    expect(current.historicalMap).toEqual(history);
    await saved('old-unadmitted-snapshot');
    expect(current.lastSnapshotId).toBeNull();
    expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    showProbe = false; rerender(app(client));
    showProbe = true; rerender(app(client));
    expect(current.historicalMap).toEqual(history);
    auth = { ...auth, user: { userId: 'driver-B' }, token: 'synthetic-B' };
    rerender(app(client));
    expect(current.historicalMap).toBeNull();
  });
  it('keeps completed A as history during clear, pending B, then replaces with current B', async () => {
    mount(); await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Completed A'));
    await waitFor(() => expect(current.previousStrategy?.sourceSnapshotId).toBe('snapshot-A'));
    const first = current.previousStrategy;
    expect(first).toEqual(expect.objectContaining({ ownerId: 'driver-A', text: 'Completed A', city: 'Fort Worth', timezone: 'America/Chicago' }));
    expect(first?.receivedAt).toEqual(expect.any(String));
    await act(async () => { window.dispatchEvent(new CustomEvent('vecto-strategy-cleared')); });
    expect(screen.getByTestId('current')).toHaveTextContent('Completed A'); expect(current.previousStrategy).toEqual(first);
    await saved('snapshot-B');
    await waitFor(() => expect(current.strategyData?.status).toBe('pending'));
    expect(screen.getByTestId('current')).toBeEmptyDOMElement(); expect(screen.getByTestId('venues')).toBeEmptyDOMElement();
    expect(current.strategyData?.strategy).toBeUndefined(); expect(current.previousStrategy).toEqual(first);
    payloads['snapshot-B'] = body('snapshot-B', 'Completed B');
    await act(async () => { strategyReady?.('snapshot-B'); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Completed B'));
    expect(current.previousStrategy?.sourceSnapshotId).toBe('snapshot-B');
    expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it.each([
    { status: 'pending', briefingStatus: 'pending' },
    { status: 'ok', briefingStatus: 'pending' },
    { status: 'ok', briefingStatus: 'complete', strategyFresh: false },
    { status: 'ok', briefingStatus: 'complete', snapshotId: 'wrong-snapshot' },
    { status: 'ok', briefingStatus: undefined },
    { strategy: { strategyForNow: '   \n   ' } },
    { strategyUpdatedAt: null },
    { snapshotCreatedAt: 'not-a-time' },
  ])('never promotes unready initial text: %j', async overrides => {
    payloads['snapshot-A'] = body('snapshot-A', 'Must not become current', overrides);
    const { client } = mount(); await refetch(client);
    expect(screen.getByTestId('current')).toBeEmptyDOMElement(); expect(current.previousStrategy ?? null).toBeNull();
    if (!('strategy' in overrides)) expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/blocks-fast?'))).toBe(false);
  });
  it('hides current text and venues when the same snapshot becomes stale; keeps original receipt time', async () => {
    const { client } = mount(); await waitFor(() => expect(screen.getByTestId('venues')).toHaveTextContent('Current venue'));
    const first = current.previousStrategy;
    await refetch(client); expect(current.previousStrategy).toEqual(first);
    payloads['snapshot-A'] = body('snapshot-A', 'Old server text', { status: 'pending', briefingStatus: 'pending', strategyFresh: false });
    await refetch(client);
    await waitFor(() => expect(screen.getByTestId('current')).toBeEmptyDOMElement());
    expect(screen.getByTestId('venues')).toBeEmptyDOMElement(); expect(current.previousStrategy).toEqual(first);
  });
  it('archives strict completed strategy with zero venues and keeps original metadata across GPS and repeated polling', async () => {
    venueBlocks = [];
    payloads['snapshot-A'] = body();
    const { client, rerender } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    const original = current.previousStrategy;
    expect(current.blocks).toEqual([]);
    location = { ...location, city: 'Los Angeles', timeZone: 'America/Los_Angeles' };
    rerender(app(client)); await refetch(client);
    expect(current.previousStrategy).toEqual(original);
    expect(current.previousStrategy?.city).toBe('Fort Worth'); expect(current.previousStrategy?.timezone).toBe('America/Chicago');
    await saved('snapshot-B'); await waitFor(() => expect(current.strategyData?.status).toBe('pending'));
    expect(current.previousStrategy).toEqual(original);
  });
  it('fills late metadata only from its original owned snapshot without renewing the receipt time', async () => {
    const snapshot = deferred<Response>(); snapshotFetch = () => snapshot.promise;
    const { client, rerender } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    const receivedAt = current.previousStrategy?.receivedAt;
    expect(current.previousStrategy?.city).toBeNull(); expect(current.previousStrategy?.timezone).toBeNull();
    location = { ...location, city: 'Los Angeles', timeZone: 'America/Los_Angeles' }; rerender(app(client));
    await act(async () => { snapshot.resolve(response({ city: 'Fort Worth', timezone: 'America/Chicago', status: 'ready' })); });
    await waitFor(() => expect(current.previousStrategy?.city).toBe('Fort Worth'));
    expect(current.previousStrategy?.timezone).toBe('America/Chicago'); expect(current.previousStrategy?.receivedAt).toBe(receivedAt);
  });
  it('preserves current pending_blocks text, but archives only strict ok', async () => {
    payloads['snapshot-A'] = body('snapshot-A', 'Ready while venues load', { status: 'pending_blocks' });
    const { client } = mount(); await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Ready while venues load'));
    expect(current.previousStrategy ?? null).toBeNull();
    payloads['snapshot-A'] = body('snapshot-A', 'Ready while venues load'); await refetch(client);
    await waitFor(() => expect(current.previousStrategy?.sourceSnapshotId).toBe('snapshot-A'));
  });
  it.each(['owner', 'token', 'logout'])('removes history immediately on %s change', async change => {
    const { client, rerender } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    location = { ...location, lastSnapshotId: null };
    admittedRun = null;
    if (change === 'owner') auth = { ...auth, user: { userId: 'driver-B' }, token: 'synthetic-B' };
    else if (change === 'token') auth = { ...auth, token: 'synthetic-A-new-session' };
    else auth = { ...auth, isAuthenticated: false };
    rerender(app(client));
    expect(screen.getByTestId('current')).toBeEmptyDOMElement(); expect(current.previousStrategy).toBeNull();
    expect(screen.getByTestId('venues')).toBeEmptyDOMElement();
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain('synthetic-');
  });
  it.each(['headers', 'body'])('ignores late A %s after snapshot B becomes current, even when transport ignores abort', async stage => {
    const late = deferred<Response>(); const json = deferred<unknown>();
    strategyFetch = async id => id === 'snapshot-A' ? (stage === 'headers' ? late.promise : { ok: true, status: 200, json: () => json.promise } as Response) : response(body('snapshot-B', 'Completed B'));
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledWith(API_ROUTES.BLOCKS.STRATEGY('snapshot-A'), expect.anything()));
    await saved('snapshot-B'); await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Completed B'));
    await act(async () => { late.resolve(response(body())); json.resolve(body()); });
    expect(screen.getByTestId('current')).toHaveTextContent('Completed B'); expect(current.previousStrategy?.sourceSnapshotId).toBe('snapshot-B');
  });
  it.each([['headers', 'owner'], ['body', 'owner'], ['headers', 'token'], ['body', 'token']])('ignores late prior-session %s after %s change, even with ignored abort', async (stage, transition) => {
    const late = deferred<Response>(); const json = deferred<unknown>();
    strategyFetch = async (_id, init) => (init?.headers as Record<string, string>).Authorization === 'Bearer synthetic-A'
      ? (stage === 'headers' ? late.promise : { ok: true, status: 200, json: () => json.promise } as Response)
      : response(body('snapshot-B', 'Account B strategy'));
    const { client, rerender } = mount();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(API_ROUTES.BLOCKS.STRATEGY('snapshot-A'), expect.anything()));
    auth = { ...auth, user: { userId: transition === 'owner' ? 'driver-B' : 'driver-A' }, token: 'synthetic-B' };
    location = { ...location, lastSnapshotId: 'snapshot-B' };
    admittedRun = { runId: 'run-B', snapshotId: 'snapshot-B' };
    rerender(app(client));
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Account B strategy'));
    await act(async () => { late.resolve(response(body())); json.resolve(body()); });
    expect(current.previousStrategy?.ownerId).toBe(transition === 'owner' ? 'driver-B' : 'driver-A'); expect(current.previousStrategy?.text).toBe('Account B strategy');
  });
  it('does not restore history after provider unmount or accept a late unmounted request', async () => {
    const { client, unmount } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    unmount();
    payloads['snapshot-A'] = body('snapshot-A', 'Stale cached A', { status: 'pending', briefingStatus: 'pending', strategyFresh: false });
    const late = deferred<Response>(); strategyFetch = async () => late.promise;
    const view = render(app(client));
    expect(screen.getByTestId('current')).toBeEmptyDOMElement(); expect(current.previousStrategy).toBeNull();
    view.unmount(); await act(async () => { late.resolve(response(body())); });
    expect(screen.queryByRole('main')).toBeNull();
  });
  it('keeps the dashboard, completed advice and venues visible during a local Strategy failure', async () => {
    const { client } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    await waitFor(() => expect(current.blocks).toHaveLength(1));
    payloads['snapshot-A'] = { snapshotId: 'snapshot-A', status: 'error', error: 'briefing_failed', message: 'Weather provider failed' };
    await refetch(client);
    await waitFor(() => expect(current.criticalError?.type).toBe('briefing_failed'));
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('local-error')).toHaveTextContent('Weather provider failed');
    expect(current.previousStrategy?.text).toBe('Completed A');
    expect(current.previousBlocksData?.blocks[0]?.name).toBe('Current venue');
    expect(refreshGPS).not.toHaveBeenCalled();
    expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('hides prior-account error details before passive auth cleanup runs', async () => {
    payloads['snapshot-A'] = { snapshotId: 'snapshot-A', status: 'error', error: 'briefing_failed', message: 'Account A private failure detail' };
    const { client, rerender } = mount();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Account A private failure detail'));
    auth = { ...auth, user: { userId: 'driver-B' }, token: 'synthetic-B' };
    admittedRun = null;
    location = { ...location, lastSnapshotId: null }; rerender(app(client));
    expect(layoutReads.at(-1)).not.toContain('Account A private failure detail');
    expect(screen.getByTestId('local-error')).toBeEmptyDOMElement();
  });
  it('does not show historical text in an auth failure', async () => {
    mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    fireEvent.click(screen.getByRole('button', { name: 'Fail auth' }));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Completed A'); expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out & Start Fresh' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Coach' })).toBeNull();
  });
  it('keeps the Coach route available during a data failure while still blocking authentication failure', async () => {
    allowPartialCoach = true;
    payloads['snapshot-A'] = { snapshotId: 'snapshot-A', status: 'error', error: 'briefing_failed', message: 'Weather provider failed' };
    mount(); await waitFor(() => expect(current.criticalError?.type).toBe('briefing_failed'));
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('current')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Fail auth' }));
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Authentication Required');
  });
});


test('upstream capture and foreground return keep the completed Strategy and never restart generation', async () => {
  const { client, rerender } = mount();
  await waitFor(() => expect(current.immediateStrategy).toBe('Completed A'));
  await waitFor(() => expect(current.blocks).toHaveLength(1));
  const completed = current.previousStrategy;
  location = { ...location, lastSnapshotId: 'new-upstream-snapshot' };
  rerender(app(client));
  await act(async () => {
    window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', { detail: { snapshotId: 'new-upstream-snapshot', reason: 'manual_refresh' } }));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(current.lastSnapshotId).toBe('snapshot-A');
  expect(current.immediateStrategy).toBe('Completed A');
  expect(current.previousStrategy).toEqual(completed);
  expect(current.blocks[0].name).toBe('Current venue');
  expect(refreshGPS).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(jest.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith('/api/blocks-fast?'))).toBe(false);
});

test('only one matching explicit Strategy start dispatches generation; upstream and mismatched events cannot', async () => {
  mount(); await waitFor(() => expect(current.immediateStrategy).toBe('Completed A'));
  const read = jest.mocked(fetch).getMockImplementation()!;
  jest.mocked(fetch).mockImplementation(async (input, init) => init?.method === 'POST' ? response({ status: 'ok' }) : read(input, init));
  await act(async () => {
    window.dispatchEvent(new CustomEvent('vecto-strategy-started', { detail: { snapshotId: 'snapshot-A', runId: 'wrong-run' } }));
    window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', { detail: { snapshotId: 'snapshot-A', runId: 'run-A' } }));
  });
  expect(jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await act(async () => {
    for (let index = 0; index < 2; index++) window.dispatchEvent(new CustomEvent('vecto-strategy-started', { detail: { snapshotId: 'snapshot-A', runId: 'run-A' } }));
  });
  const calls = jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ snapshotId: 'snapshot-A', runId: 'run-A' });
});


test.each([202, 503])('explicit Strategy HTTP%s preserves prior guidance and completed recovery clears local failure', async status => {
  const { client } = mount();
  await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
  await waitFor(() => expect(current.blocks).toHaveLength(1));
  const read = jest.mocked(fetch).getMockImplementation()!;
  jest.mocked(fetch).mockImplementation(async (input, init) => init?.method === 'POST'
    ? response({ message: status === 202 ? 'Already running' : 'Refresh failed' }, status) : read(input, init));
  await saved('snapshot-B');
  await act(async () => { window.dispatchEvent(new CustomEvent('vecto-strategy-started', { detail: { snapshotId: 'snapshot-B', runId: 'run-snapshot-B' } })); });
  expect(current.previousStrategy?.text).toBe('Completed A');
  expect(current.previousBlocksData?.blocks[0].name).toBe('Current venue');
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(current.strategyError).toBe(status === 202 ? null : 'Refresh failed');
  expect(refreshGPS).not.toHaveBeenCalled();
  payloads['snapshot-B'] = body('snapshot-B', 'Completed B');
  await refetch(client, 'snapshot-B');
  await waitFor(() => expect(current.immediateStrategy).toBe('Completed B'));
  expect(current.strategyError).toBeNull();
  expect(current.previousBlocksData).toBeNull();
  expect(jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});


test('foreground polling retains confirmed saved venue choices instead of reviving the raw ranking', async () => {
  const { client } = mount();
  await waitFor(() => expect(current.blocks[0]?.name).toBe('Current venue'));
  const strategyQuery = client.getQueryCache().findAll({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY('snapshot-A') })[0];
  const confirmed = [{ name: 'Confirmed replacement', placeId: 'replacement', coordinates: { lat: 33, lng: -98 } }];
  await act(async () => { client.setQueryData(strategyQuery.queryKey, (data: any) => ({ ...data, blocks: confirmed, venueFeedbackRevision: 1 })); });
  await waitFor(() => expect(current.blocks[0]?.name).toBe('Confirmed replacement'));
  await refetch(client);
  expect(current.blocks).toEqual(confirmed);
  await saved('snapshot-B');
  expect(current.previousBlocksData?.blocks).toEqual(confirmed);
});


const savedHistorySnapshot = (id = 'snapshot-A') => ({ snapshot_id: id, status: 'ok', city: 'Fort Worth', timezone: 'America/Chicago',
  lat: 32, lng: -97, created_at: '2026-09-12T12:00:00Z' });
const historyReceipt = () => ({ sessionId: 'session-A', previousRun: {
  runId: 'run-A', snapshotId: 'snapshot-A', sessionId: 'session-A', status: 'complete',
} });

test.each(['pending', 'error'])('full remount during %s replacement restores completed advice, saved venues and old map without GPS or generation', async status => {
  snapshotFetch = async id => response(savedHistorySnapshot(id));
  const first = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
  first.unmount();
  admittedRun = { runId: 'run-B', snapshotId: 'snapshot-B' };
  savedSetup = historyReceipt();
  location = { ...location, lastSnapshotId: 'source-B', currentCoords: { latitude: 40, longitude: -74 }, city: 'New location', timeZone: 'America/New_York' };
  payloads['snapshot-B'] = status === 'error' ? { snapshotId: 'snapshot-B', status: 'error', error: 'strategy_failed', message: 'Replacement failed' }
    : body('snapshot-B', 'Not ready', { status: 'pending', briefingStatus: 'complete', strategyFresh: false });
  mount();
  await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
  expect(current.immediateStrategy).toBeNull();
  expect(current.previousStrategy).toMatchObject({ sourceSnapshotId: 'snapshot-A', ownerId: 'driver-A', city: 'Fort Worth', timezone: 'America/Chicago',
    sourceUpdatedAt: '2026-09-12T12:00:10Z', snapshotCreatedAt: '2026-09-12T12:00:00Z' });
  expect(current.previousBlocksData?.blocks[0]?.name).toBe('Current venue');
  expect(current.historicalMap).toMatchObject({ sourceSnapshotId: 'snapshot-A', props: {
    driverLat: 32, driverLng: -97, snapshotId: 'snapshot-A', timezone: 'America/Chicago',
    venues: [{ id: 'place-current', name: 'Current venue', lat: 32, lng: -97 }], bars: [], events: [], incidents: [],
  } });
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(refreshGPS).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/blocks-fast?'))).toBe(false);
});

test.each(['owner', 'token', 'unmount', 'replacement'])('late history read after %s boundary cannot restore prior-session data or replace current completion', async boundary => {
  admittedRun = { runId: 'run-B', snapshotId: 'snapshot-B' };
  savedSetup = historyReceipt();
  const delayed = deferred<Response>();
  strategyFetch = async id => id === 'snapshot-A' ? delayed.promise : response(payloads[id]);
  snapshotFetch = async id => response(savedHistorySnapshot(id));
  const view = mount();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(API_ROUTES.BLOCKS.STRATEGY('snapshot-A'), expect.anything()));
  if (boundary === 'replacement') {
    payloads['snapshot-B'] = body('snapshot-B', 'Current completed B');
    await refetch(view.client, 'snapshot-B');
    await waitFor(() => expect(current.previousStrategy?.text).toBe('Current completed B'));
  } else if (boundary === 'unmount') view.unmount();
  else {
    auth = { ...auth, user: { userId: boundary === 'owner' ? 'driver-B' : 'driver-A' }, token: 'synthetic-new-session' };
    admittedRun = null; savedSetup = undefined;
    view.rerender(app(view.client));
  }
  await act(async () => { delayed.resolve(response(body())); });
  if (boundary === 'replacement') expect(current.previousStrategy?.text).toBe('Current completed B');
  else if (boundary !== 'unmount') {
    expect(current.previousStrategy).toBeNull(); expect(current.previousBlocksData).toBeNull(); expect(current.historicalMap).toBeNull();
  } else expect(screen.queryByRole('main')).toBeNull();
});

test.each(['foreign-session', 'wrong-snapshot', 'missing-source-time', 'pending-briefing'])('history receipt with %s cannot be promoted to completed guidance', async invalid => {
  admittedRun = { runId: 'run-B', snapshotId: 'snapshot-B' };
  savedSetup = historyReceipt();
  if (invalid === 'foreign-session') savedSetup.previousRun!.sessionId = 'earlier-session';
  payloads['snapshot-A'] = body('snapshot-A', 'Must stay hidden', invalid === 'missing-source-time' ? { strategyUpdatedAt: null }
    : invalid === 'pending-briefing' ? { briefingStatus: 'pending' } : {});
  snapshotFetch = async id => response(savedHistorySnapshot(invalid === 'wrong-snapshot' && id === 'snapshot-A' ? 'wrong-snapshot' : id));
  mount();
  await waitFor(() => expect(current.strategyData?.status).toBe('pending'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(current.previousStrategy).toBeNull(); expect(current.previousBlocksData).toBeNull(); expect(current.historicalMap).toBeNull();
  expect(refreshGPS).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  if (invalid === 'foreign-session') expect(jest.mocked(fetch).mock.calls.some(([url]) => url === API_ROUTES.BLOCKS.STRATEGY('snapshot-A'))).toBe(false);
});

test.each([1, 2])('canonical saved venue revision %s supersedes an equal or older client receipt', async scopeRevision => {
  const { client } = mount();
  await waitFor(() => expect(current.blocks[0]?.name).toBe('Current venue'));
  const strategyQuery = client.getQueryCache().findAll({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY('snapshot-A') })[0];
  const cached = [{ name: 'Earlier confirmed receipt', placeId: 'earlier', coordinates: { lat: 33, lng: -98 } }];
  await act(async () => { client.setQueryData(strategyQuery.queryKey, (data: any) => ({ ...data, blocks: cached, venueFeedbackRevision: 1 })); });
  const canonical = [{ name: 'Canonical saved choice', placeId: 'canonical', coordinates: { lat: 34, lng: -99 } }];
  payloads['snapshot-A'] = body('snapshot-A', 'Completed A', { blocks: canonical, scope_revision: scopeRevision });
  await refetch(client);
  expect(current.blocks).toEqual(canonical);
  expect(client.getQueryData<any>(strategyQuery.queryKey).venueFeedbackRevision).toBe(scopeRevision);
});


test('first-context Briefing failure reaches the existing red screen before any Strategy admission', async () => {
  admittedRun = null;
  briefingFailures['snapshot-A'] = 'Airport: required research failed';
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Briefing Could Not Be Completed');
  expect(screen.getByRole('alert')).toHaveTextContent('Airport: required research failed');
  expect(screen.getByRole('alert')).toHaveTextContent('Please come back later.');
  expect(screen.queryByRole('button', { name: /try again|refresh/i })).toBeNull();
  expect(screen.getByRole('link', { name: 'Open Coach' })).toHaveAttribute('href', '/co-pilot/coach');
  expect(screen.getByRole('button', { name: 'Sign Out & Start Fresh' })).toBeInTheDocument();
  expect(screen.queryByRole('main')).toBeNull();
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(refreshGPS).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('a failed upstream replacement keeps completed guidance and clears when another source is selected', async () => {
  const { client, rerender } = mount();
  await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
  location = { ...location, lastSnapshotId: 'source-B' };
  briefingFailures['source-B'] = 'Airport: replacement research failed';
  rerender(app(client));
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByTestId('local-error')).toHaveTextContent('replacement research failed');
  expect(current.previousStrategy?.text).toBe('Completed A');
  expect(screen.queryByTestId('critical-error')).toBeNull();
  location = { ...location, lastSnapshotId: 'source-C' };
  rerender(app(client));
  expect(screen.getByTestId('local-error')).toBeEmptyDOMElement();
  expect(current.previousStrategy?.text).toBe('Completed A');
  expect(refreshGPS).not.toHaveBeenCalled();
});
