// Real setup, location, Briefing query, CoPilot and Strategy UI. Every receipt,
// identity and transport is synthetic; no application, GPS or provider access.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

// jsdom lacks this browser API; this suite only stores JSON preference drafts.
Object.assign(globalThis, { structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });

const OWNER = '00000000-0000-4000-8000-000000000081';
const SESSION = '00000000-0000-4000-8000-000000000082';
const SOURCE = '00000000-0000-4000-8000-000000000083';
const ADMITTED = '00000000-0000-4000-8000-000000000084';
let identity = { user: { userId: OWNER }, token: 'synthetic-readiness-token', sessionId: SESSION, isAuthenticated: true };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
jest.unstable_mockModule('@/hooks/useBarsQuery', () => ({ useBarsQuery: () => ({}) }));
jest.unstable_mockModule('@/hooks/useEnrichmentProgress', () => ({ useEnrichmentProgress: () => ({
  progress: 0, strategyProgress: 0, phase: 'idle', pipelinePhase: 'idle', timeRemainingText: '',
}) }));
jest.unstable_mockModule('@/hooks/useTrafficIncidents', () => ({ useTrafficIncidents: () => [] }));
jest.unstable_mockModule('@/hooks/useStrategyLoadingMessages', () => ({ useStrategyLoadingMessages: () => ({
  badge: '', text: '', icon: '', step: '', messageCount: 1, currentIndex: 0,
}) }));
jest.unstable_mockModule('@/components/strategy/StrategyMap', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/BarsDataGrid', () => ({ default: () => null }));
jest.unstable_mockModule('@/components/co-pilot/GreetingBanner', () => ({ GreetingBanner: () => null }));
jest.unstable_mockModule('@/components/SmartBlocksStatus', () => ({ SmartBlocksStatus: () => null }));

const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
const { CoPilotProvider, useCoPilot } = await import('@/contexts/co-pilot-context');
const { default: StrategyPage } = await import('@/pages/co-pilot/StrategyPage');
const { closeAllSSE } = await import('@/utils/co-pilot-helpers');
class Source {
  static instances: Source[] = [];
  listeners = new Map<string, (event: { data: string }) => void>();
  close = jest.fn();
  constructor(public url: string) { Source.instances.push(this); }
  addEventListener(name: string, callback: (event: { data: string }) => void) { this.listeners.set(name, callback); }
  emit(snapshotId: string) { this.listeners.get('briefing_ready')?.({ data: JSON.stringify({ snapshot_id: snapshotId }) }); }
}
let setup: ReturnType<typeof useRunSetup>;
let location: ReturnType<typeof useLocation>;
let copilot: ReturnType<typeof useCoPilot>;
let canonical: any;
let aggregate: any;
let savedSnapshot: any;
let preparationResponse: Promise<Response> | null;
let permission: EventTarget & { state: string };
let client: QueryClient;
const originalFetch = global.fetch;
const originalSource = globalThis.EventSource;
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => JSON.parse(JSON.stringify(body)) }) as Response;
const requests = (url: string) => jest.mocked(fetch).mock.calls.filter(([input]) => String(input) === url);
const writes = () => jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Probe() {
  setup = useRunSetup(); location = useLocation(); copilot = useCoPilot();
  return <StrategyPage />;
}
function app() {
  return <QueryClientProvider client={client}><RunSetupProvider><LocationProvider>
    <CoPilotProvider><Probe /></CoPilotProvider>
  </LocationProvider></RunSetupProvider></QueryClientProvider>;
}
async function tick(ms = 1) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function mount() { const view = render(app()); await tick(); await tick(); return view; }
async function completeBriefing(snapshotId = SOURCE, canonicalReady = true) {
  aggregate = { ...aggregate, status: 'complete', updated_at: '2026-10-12T03:00:05Z',
    briefing: Object.fromEntries(Object.entries(aggregate.briefing).map(([key, value]) => [key, { ...(value as object), _pending: false }])) };
  canonical = { ...canonical, currentSnapshot: { ...canonical.currentSnapshot,
    briefingReady: canonicalReady, briefingStatus: canonicalReady ? 'complete' : 'pending' } };
  await act(async () => { Source.instances.find(source => source.url.includes(SOURCE))!.emit(snapshotId); });
  await tick(); await tick();
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  identity = { user: { userId: OWNER }, token: 'synthetic-readiness-token', sessionId: SESSION, isAuthenticated: true };
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, identity.token);
  canonical = { sessionId: SESSION, settingsRevision: 1, rulesVersion: 1, rulesHash: 'synthetic-rules',
    profile: { userId: OWNER }, vehicle: null, rules: {}, ready: true, missingFields: [], currentRun: null,
    currentSnapshot: { snapshot_id: SOURCE, sourceSnapshotId: SOURCE, user_id: OWNER, sessionId: SESSION,
      status: 'ok', ready: true, briefingReady: false, briefingStatus: 'pending', lat: 0, lng: 12.3456789,
      city: 'Synthetic city', state: 'Synthetic region', country: 'ZZ', formattedAddress: 'Synthetic address',
      timeZone: 'Etc/UTC', gps_timestamp: Date.now(), accuracy: 7, created_at: new Date().toISOString(),
      weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } } };
  savedSnapshot = canonical.currentSnapshot;
  preparationResponse = null;
  aggregate = { snapshot_id: SOURCE, status: 'pending', updated_at: '2026-10-12T03:00:00Z',
    briefing: Object.fromEntries(['weather', 'traffic', 'events', 'news', 'school_closures', 'airport_conditions', 'holiday']
      .map(key => [key, { _pending: true, items: [] }])) };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  Source.instances = []; globalThis.EventSource = Source as unknown as typeof EventSource;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn() } });
  permission = Object.assign(new EventTarget(), { state: 'granted' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: jest.fn(async () => permission) } });
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(SOURCE);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === API_ROUTES.MAIN_RUNS.SETUP) return response(canonical);
    if (url === API_ROUTES.LOCATION.SNAPSHOT) {
      canonical = { ...canonical, currentSnapshot: savedSnapshot };
      return response(savedSnapshot);
    }
    if (url === API_ROUTES.LOCATION.NEWS_BRIEFING) {
      if (preparationResponse) return preparationResponse;
      throw new Error('Synthetic interrupted Briefing request');
    }
    if (url === API_ROUTES.BRIEFING.AGGREGATE(SOURCE)) return response(aggregate);
    if (url === API_ROUTES.MAIN_RUNS.CONTINUE) return response({ runId: 'synthetic-run', snapshotId: ADMITTED,
      sourceSnapshotId: SOURCE, sessionId: SESSION, settingsRevision: 1, rulesVersion: 1, rulesHash: 'synthetic-rules', status: 'running' });
    if (url === API_ROUTES.BRIEFING.EVENTS_ACTIVE(ADMITTED)) return response({ events: [] });
    if (url === `/api/snapshot/${ADMITTED}`) return response({ city: 'Synthetic city', timezone: 'Etc/UTC', status: 'ok' });
    if (url === `/api/blocks/strategy/${ADMITTED}`) return response({ snapshotId: ADMITTED, status: 'pending', briefingStatus: 'complete' });
    throw new Error(`Unexpected synthetic ${init?.method ?? 'GET'} request: ${url}`);
  });
});
afterEach(() => {
  cleanup(); client.clear(); closeAllSSE(); localStorage.clear();
  global.fetch = originalFetch; globalThis.EventSource = originalSource;
  if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
  else Reflect.deleteProperty(navigator, 'permissions');
  jest.restoreAllMocks(); jest.useRealTimers();
});

test('a restored pending Briefing becomes Strategy-ready after canonical verification, without GPS or automatic admission', async () => {
  await mount();
  expect(location.lastSnapshotId).toBe(SOURCE); expect(location.contextReady).toBe(false);
  expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(screen.getByTestId('strategy-preparation-status')).toBeInTheDocument();
  expect(screen.queryByText('Use Refresh location to prepare your Strategy.')).not.toBeInTheDocument();
  expect(setup.canContinue).toBe(true); expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(1);
  await completeBriefing();
  expect(Object.values(copilot.briefingData.isLoading)).not.toContain(true);
  expect(copilot.briefingData.generationError).toBeNull();
  // Completion is a wake-up for a canonical read, never authority to admit.
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(location.contextReady).toBe(true);
  expect(screen.getByTestId('strategy-ready-status')).toHaveTextContent('Ready for your Strategy');
  expect(screen.getByTestId('strategy-ready-card')).toHaveTextContent('Select Continue Strategy');
  expect(screen.queryByTestId('strategy-preparation-status')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-start-strategy')).toBeEnabled();
  expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByTestId('button-start-strategy')); }); await tick();
  expect(requests(API_ROUTES.MAIN_RUNS.CONTINUE)).toHaveLength(1);
  expect(JSON.parse(String(requests(API_ROUTES.MAIN_RUNS.CONTINUE)[0][1]?.body)).expectedSnapshotId).toBe(SOURCE);
  expect(copilot.lastSnapshotId).toBe(ADMITTED); expect(copilot.contextSnapshotId).toBe(SOURCE);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test('an unmatched completion cannot release the current saved source', async () => {
  await mount(); await completeBriefing('synthetic-unrelated-source');
  expect(location.contextReady).toBe(false); expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(1);
  expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test.each([
  ['school_closures', 'Synthetic school verification unavailable'],
  ['airport_conditions', 'The data provider timed out.'],
  ['airport_conditions', 'The data provider returned an invalid or incomplete response.'],
])('terminal %s failure preserves the page and cause while Strategy remains held: %s', async (field, reason) => {
  await mount();
  aggregate = { ...aggregate, status: 'error', briefing: { ...aggregate.briefing,
    [field]: { _generationFailed: true, error: reason } } };
  await act(async () => { Source.instances.find(source => source.url.includes(SOURCE))!.emit(SOURCE); }); await tick(); await tick();
  expect(copilot.briefingData.generationError).toContain(reason);
  expect(screen.getByTestId('strategy-page')).toBeInTheDocument();
  expect(screen.getByTestId('strategy-page')).toHaveTextContent(reason);
  expect(screen.getByTestId('strategy-briefing-held-card')).toHaveTextContent('Strategy is waiting for Briefing');
  expect(screen.getByTestId('strategy-briefing-held-card')).toHaveTextContent(reason);
  expect(screen.queryByTestId('strategy-failed-card')).not.toBeInTheDocument();
  expect(location.contextReady).toBe(false); expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('strategy-preparation-status')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByText('Briefing Could Not Be Completed')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign Out & Start Fresh' })).not.toBeInTheDocument();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(1); expect(writes()).toHaveLength(0);
});

test('Briefing GET completion recovers an interrupted preparation POST without recollecting GPS', async () => {
  canonical = { ...canonical, currentSnapshot: null };
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => success({
    coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now(),
  } as GeolocationPosition));
  await mount(); await tick();
  expect(location.lastSnapshotId).toBe(SOURCE); expect(location.contextReady).toBe(false);
  expect(location.locationError?.message).toBe('Synthetic interrupted Briefing request');
  expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(requests(API_ROUTES.LOCATION.SNAPSHOT)).toHaveLength(1);
  expect(requests(API_ROUTES.LOCATION.NEWS_BRIEFING)).toHaveLength(1);
  await completeBriefing();
  expect(location.contextReady).toBe(true); expect(location.locationError).toBeNull();
  expect(screen.getByTestId('button-start-strategy')).toBeEnabled();
  expect(screen.getByTestId('strategy-ready-status')).toHaveTextContent('Ready for your Strategy');
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(2); expect(requests(API_ROUTES.MAIN_RUNS.CONTINUE)).toHaveLength(0);
});

test.each(['canonical not ready', 'pending current-context pointer', 'permission denied'])(
  'a completed aggregate cannot bypass %s', async reason => {
    await mount();
    if (reason === 'pending current-context pointer') canonical = { ...canonical, currentContextPending: true };
    if (reason === 'permission denied') await act(async () => { permission.state = 'denied'; permission.dispatchEvent(new Event('change')); });
    await completeBriefing(SOURCE, reason !== 'canonical not ready');
    expect(Object.values(copilot.briefingData.isLoading)).not.toContain(true);
    expect(location.contextReady).toBe(false); expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
    expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
    if (reason === 'canonical not ready') expect(screen.getByTestId('strategy-preparation-status')).toBeInTheDocument();
    expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  },
);

test('canonical completion preserves a preference draft and requires explicit review instead of admission', async () => {
  await mount();
  await act(async () => { setup.setEditorDraft('preferences', { syntheticUnsavedPreference: true }); });
  await completeBriefing();
  expect(setup.unsavedEditors).toEqual(['preferences']); expect(setup.canContinue).toBe(false);
  expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test('active preparation owns its canonical read and completion does not duplicate or supersede it', async () => {
  canonical = { ...canonical, currentSnapshot: null };
  const preparing = deferred<Response>(); preparationResponse = preparing.promise;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => success({
    coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now(),
  } as GeolocationPosition));
  await mount(); await tick();
  expect(location.isUpdating).toBe(true); expect(location.contextReady).toBe(false);
  await completeBriefing();
  expect(Object.values(copilot.briefingData.isLoading)).not.toContain(true);
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(1);
  expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  await act(async () => { preparing.resolve(response({ success: true, complete: true })); }); await tick(); await tick();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(location.contextReady).toBe(true); expect(screen.getByTestId('button-start-strategy')).toBeEnabled();
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(2); expect(requests(API_ROUTES.MAIN_RUNS.CONTINUE)).toHaveLength(0);
});

test('completion waits for a settings save, then reconciles without clearing an unconfirmed save', async () => {
  await mount(); let finish!: () => void;
  act(() => { finish = setup.beginSave(); });
  await completeBriefing();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(1);
  expect(setup.saving).toBe(true); expect(location.contextReady).toBe(false);
  act(() => { finish(); }); await tick(); await tick();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(location.contextReady).toBe(true); expect(setup.saveUnconfirmed).toBe(true); expect(setup.canContinue).toBe(false);
  expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

test('a failed canonical completion read stays held with an actionable error instead of a preparation spinner', async () => {
  await mount(); const route = jest.mocked(fetch).getMockImplementation()!;
  jest.mocked(fetch).mockImplementation((input, init) => String(input) === API_ROUTES.MAIN_RUNS.SETUP
    ? Promise.resolve(response({ message: 'Synthetic canonical read unavailable' }, 503)) : route(input, init));
  await completeBriefing();
  expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(location.contextReady).toBe(false); expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Synthetic canonical read unavailable');
  expect(screen.queryByTestId('strategy-preparation-status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
  await tick(10000); expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test('a late canonical completion read after logout cannot restore ready data or admit Strategy', async () => {
  const view = await mount(); const route = jest.mocked(fetch).getMockImplementation()!;
  const readback = deferred<Response>();
  jest.mocked(fetch).mockImplementation((input, init) => String(input) === API_ROUTES.MAIN_RUNS.SETUP
    ? readback.promise : route(input, init));
  await completeBriefing();
  expect(setup.loading).toBe(true); expect(requests(API_ROUTES.MAIN_RUNS.SETUP)).toHaveLength(2);
  expect(screen.getByTestId('strategy-preparation-status')).toBeInTheDocument();
  identity = { ...identity, isAuthenticated: false }; localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  view.rerender(app()); await tick();
  await act(async () => { readback.resolve(response(canonical)); }); await tick();
  expect(location.lastSnapshotId).toBeNull(); expect(location.contextReady).toBe(false); expect(setup.setup).toBeNull();
  expect(screen.getByTestId('button-start-strategy')).toBeDisabled();
  expect(screen.queryByTestId('strategy-ready-status')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});
