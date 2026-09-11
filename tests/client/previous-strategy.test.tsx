// 2026-09-11: Synthetic transport; real CoPilotProvider and React Query cache.
// Auth/GPS and unrelated briefing/bars/progress/SSE transports are fixtures.
import React from 'react';
import { jest, describe, it, beforeEach, afterEach, expect } from '@jest/globals';
import { render, screen, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';

let auth = { isAuthenticated: true, user: { userId: 'driver-A' }, token: 'synthetic-A' };
const refreshGPS = jest.fn(async () => {
  window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));
});
let location = { lastSnapshotId: 'snapshot-A' as string | null, currentCoords: { latitude: 32, longitude: -97 },
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
jest.unstable_mockModule('@/hooks/useBriefingQueries', () => ({ useBriefingQueries: () => ({ isLoading: {} }) }));
jest.unstable_mockModule('@/hooks/useBarsQuery', () => ({ useBarsQuery: () => ({}) }));
const { CoPilotProvider, useCoPilot } = await import('@/contexts/co-pilot-context');
let current: ReturnType<typeof useCoPilot>;
let layoutReads: string[] = [];
function LayoutProbe({ stamp }: { stamp: string }) {
  React.useLayoutEffect(() => { layoutReads.push(document.body.textContent ?? ''); }, [stamp]);
  return null;
}
function Probe() {
  current = useCoPilot();
  return <main><span data-testid="current">{current.immediateStrategy ?? ''}</span>
    <span data-testid="previous">{JSON.stringify(current.previousStrategy ?? null)}</span>
    <span data-testid="venues">{current.blocks.map(block => block.name).join(',')}</span>
    <button onClick={() => current.setCriticalError({ type: 'auth_failed' })}>Fail auth</button>
    <button onClick={() => current.setCriticalError({ type: 'location_failed' })}>Fail GPS</button>
  </main>;
}
const clients: QueryClient[] = [];
const body = (id = 'snapshot-A', text = 'Completed A', overrides = {}) => ({
  snapshotId: id, status: 'ok', briefingStatus: 'complete', strategyFresh: true,
  strategy: { strategyForNow: text }, ...overrides,
});
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let payloads: Record<string, unknown>;
let venueBlocks: unknown[];
let strategyFetch: (id: string, init?: RequestInit) => Promise<Response>;
let snapshotFetch: () => Promise<Response>;
function app(client: QueryClient) { return <QueryClientProvider client={client}><CoPilotProvider><Probe /></CoPilotProvider><LayoutProbe stamp={`${auth.token}:${auth.isAuthenticated}`} /></QueryClientProvider>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  return { client, ...render(app(client)) };
}
async function saved(id: string) { await act(async () => { window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', { detail: { snapshotId: id, reason: 'resume' } })); }); }
async function refetch(client: QueryClient, id = 'snapshot-A') {
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(id), type: 'active' }); await new Promise(resolve => setTimeout(resolve, 0)); });
}
beforeEach(() => {
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
    if (url.startsWith('/api/snapshot/')) return snapshotFetch();
    if (url.startsWith('/api/blocks-fast?')) return response({ rankingId: 'ranking-current', blocks: venueBlocks });
    throw new Error(`Unexpected synthetic route ${url}`);
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); jest.restoreAllMocks(); });

describe('completed strategy history and current scope', () => {
  it('keeps completed A as history during clear, pending B, then replaces with current B', async () => {
    mount(); await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('Completed A'));
    await waitFor(() => expect(current.previousStrategy?.sourceSnapshotId).toBe('snapshot-A'));
    const first = current.previousStrategy;
    expect(first).toEqual(expect.objectContaining({ ownerId: 'driver-A', text: 'Completed A', city: 'Fort Worth', timezone: 'America/Chicago' }));
    expect(first?.receivedAt).toEqual(expect.any(String));
    await act(async () => { window.dispatchEvent(new CustomEvent('vecto-strategy-cleared')); });
    expect(screen.getByTestId('current')).toBeEmptyDOMElement(); expect(current.previousStrategy).toEqual(first);
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
  it('retains history inside blocking Briefing failure and failed GPS retry, with dashboard unmounted', async () => {
    const { client } = mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    payloads['snapshot-A'] = { snapshotId: 'snapshot-A', status: 'error', error: 'briefing_failed', message: 'Weather provider failed' };
    await refetch(client);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Briefing Could Not Be Completed'));
    expect(screen.getByRole('alert')).toHaveTextContent('Previous strategy'); expect(screen.getByRole('alert')).toHaveTextContent('Completed A');
    expect(screen.queryByRole('main')).toBeNull();
    refreshGPS.mockImplementationOnce(async () => { window.dispatchEvent(new CustomEvent('vecto-strategy-cleared')); throw new Error('GPS unavailable'); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try Again' })); });
    expect(refreshGPS).toHaveBeenCalledTimes(1); expect(screen.getByRole('alert')).toHaveTextContent('Completed A');
    expect(screen.getByRole('alert')).toHaveTextContent('Location Resolution Failed'); expect(screen.queryByRole('main')).toBeNull();
  });
  it('hides prior-account error details before passive auth cleanup runs', async () => {
    payloads['snapshot-A'] = { snapshotId: 'snapshot-A', status: 'error', error: 'briefing_failed', message: 'Account A private failure detail' };
    const { client, rerender } = mount();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Account A private failure detail'));
    auth = { ...auth, user: { userId: 'driver-B' }, token: 'synthetic-B' };
    location = { ...location, lastSnapshotId: null }; rerender(app(client));
    expect(layoutReads.at(-1)).not.toContain('Account A private failure detail');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not show historical text in an auth failure', async () => {
    mount(); await waitFor(() => expect(current.previousStrategy?.text).toBe('Completed A'));
    fireEvent.click(screen.getByRole('button', { name: 'Fail auth' }));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Completed A'); expect(screen.queryByRole('main')).toBeNull();
  });
});
