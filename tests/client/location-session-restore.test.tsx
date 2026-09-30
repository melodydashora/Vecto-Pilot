// All identities, GPS receipts and transports are synthetic; no gateway or database.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, render } from '@testing-library/react';
import { API_ROUTES } from '@/constants/apiRoutes';

const OWNER = '00000000-0000-4000-8000-000000000041';
const SESSION = '00000000-0000-4000-8000-000000000042';
const SAVED = '00000000-0000-4000-8000-000000000043';
const FRESH = '00000000-0000-4000-8000-000000000044';
let identity: { user: { userId: string }; token: string; sessionId: string; isAuthenticated: boolean };
let canonical: any;
let nextReceipt: any;
const reload = jest.fn<() => Promise<any>>();
const reviewSetup = jest.fn();
let setupContext: any;
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => setupContext }));
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
let location: ReturnType<typeof useLocation>;
function Probe() { location = useLocation(); return null; }
const app = () => <LocationProvider><Probe /></LocationProvider>;
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { resolve, promise };
}
function snapshot(id = SAVED, observedAt = Date.now() - 59 * 60 * 1000) {
  return { snapshot_id: id, sourceSnapshotId: id, user_id: OWNER, sessionId: SESSION,
    status: 'ok', ready: true, briefingReady: true,
    lat: 0, lng: 12.3456789, city: 'Synthetic saved city', state: 'Synthetic region', country: 'ZZ',
    formattedAddress: 'Synthetic saved address', timeZone: 'Etc/UTC', gps_timestamp: observedAt,
    accuracy: 7, created_at: new Date(observedAt).toISOString(),
    weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } };
}
async function route(input: string | URL | Request, options?: RequestInit) {
  if (String(input) === API_ROUTES.LOCATION.SNAPSHOT) {
    const payload = JSON.parse(String(options?.body));
    return response({ ...nextReceipt, snapshot_id: payload.captureId, sourceSnapshotId: payload.captureId });
  }
  if (String(input) === API_ROUTES.LOCATION.NEWS_BRIEFING) return response({ success: true, complete: true });
  throw new Error('Unexpected synthetic request: ' + String(input));
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T21:00:00Z'));
  identity = { user: { userId: OWNER }, token: 'synthetic-token-A', sessionId: SESSION, isAuthenticated: true };
  canonical = { sessionId: SESSION, currentSnapshot: snapshot(), ready: false, missingFields: ['saved_preferences'] };
  setupContext = { setup: canonical, run: { runId: 'synthetic-old-run' }, loading: false, reload, reviewSetup };
  nextReceipt = { ...snapshot(FRESH, Date.now()), city: 'Synthetic fresh city',
    formattedAddress: 'Synthetic fresh address', weather: { tempF: 52, conditions: 'Rain' } };
  reload.mockReset(); reload.mockImplementation(async () => {
    canonical = { ...canonical, currentSnapshot: nextReceipt };
    setupContext.setup = canonical;
    return canonical;
  });
  reviewSetup.mockClear();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: jest.fn((success: PositionCallback) => success({
      coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now(),
    } as GeolocationPosition)),
  } });
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(FRESH);
  global.fetch = jest.fn<typeof fetch>().mockImplementation(route);
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('a 59-minute-old same-session snapshot is restored without GPS or POSTs on foreground return and remount', async () => {
  const view = render(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED);
  expect(location.currentCoords).toEqual({ latitude: 0, longitude: 12.3456789 });
  expect(location.weather?.temp).toBe(0); expect(location.airQuality?.aqi).toBe(0);
  expect(location.contextReady).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  // A canonical settings/profile refresh for this session is still read-only.
  setupContext = { ...setupContext, setup: { ...canonical } };
  view.rerender(app()); await flush();
  view.unmount(); render(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  expect(reviewSetup).not.toHaveBeenCalled();
});

test('returning to the app waits for canonical setup before deciding whether a snapshot is missing', async () => {
  setupContext = { ...setupContext, setup: null, loading: true };
  const view = render(app()); await flush();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  setupContext = { ...setupContext, setup: canonical, loading: false };
  view.rerender(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.contextReady).toBe(true);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('an unfinished previous refresh is held for manual retry instead of starting another capture on return', async () => {
  canonical = { ...canonical, currentSnapshot: null, currentContextPending: true };
  setupContext = { ...setupContext, setup: canonical, run: null };
  const view = render(app()); await flush();
  expect(location.contextReady).toBe(false); expect(location.lastSnapshotId).toBeNull();
  expect(location.locationError?.code).toBe('context_preparation_unfinished');
  await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  view.unmount(); render(app()); await flush();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('first-session GPS and Briefing run before incomplete preference setup, without Strategy admission', async () => {
  canonical.currentSnapshot = null;
  setupContext.run = null;
  render(app()); await flush();
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(location.locationRequested).toBe(true);
  expect(location.lastSnapshotId).toBe(FRESH);
  expect(location.contextReady).toBe(true);
  expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    API_ROUTES.LOCATION.SNAPSHOT, API_ROUTES.LOCATION.NEWS_BRIEFING,
  ]);
  expect(canonical.ready).toBe(false); expect(reload).toHaveBeenCalledTimes(1);
  const capture = JSON.parse(String(jest.mocked(fetch).mock.calls[0][1]?.body));
  expect(capture).toMatchObject({ captureId: FRESH, lat: 0, lng: 12.3456789,
    accuracy: 7, gps_timestamp: Date.now(), permission: 'granted' });
  expect(jest.mocked(fetch).mock.calls.some(([url]) => url === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test('manual snapshot refresh keeps previous data during capture and returns an actionable id only after Briefing and canonical readback', async () => {
  const briefing = deferred<Response>(); const readback = deferred<any>();
  let gps!: PositionCallback;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { gps = success; });
  jest.mocked(fetch).mockImplementation((input, options) => String(input) === API_ROUTES.LOCATION.NEWS_BRIEFING
    ? briefing.promise : route(input, options));
  reload.mockReturnValue(readback.promise);
  render(app()); await flush();
  let refreshing!: Promise<string | null>; let returned = false;
  act(() => { refreshing = location.refreshGPS(); void refreshing.then(() => { returned = true; }); });
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.city).toBe('Synthetic saved city');
  expect(location.weather?.temp).toBe(0); expect(location.isUpdating).toBe(true);
  await act(async () => { gps({ coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now() } as GeolocationPosition); });
  expect(returned).toBe(false); expect(location.contextReady).toBe(false); expect(reload).not.toHaveBeenCalled();
  await act(async () => { briefing.resolve(response({ success: true, complete: true })); });
  expect(returned).toBe(false); expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => { readback.resolve({ ...canonical, currentSnapshot: nextReceipt }); expect(await refreshing).toBe(FRESH); });
  expect(location.lastSnapshotId).toBe(FRESH); expect(location.weather?.temp).toBe(52);
  expect(location.contextReady).toBe(true); expect(location.isUpdating).toBe(false);
  expect(jest.mocked(fetch).mock.calls.some(([url]) => url === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
});

test.each(['wrong owner', 'wrong session', 'missing session'])('a saved snapshot with %s is not restored or replaced with automatic GPS', async kind => {
  if (kind === 'wrong owner') canonical.currentSnapshot.user_id = 'synthetic-other-owner';
  if (kind === 'wrong session') canonical.currentSnapshot.sessionId = 'synthetic-other-session';
  if (kind === 'missing session') delete canonical.currentSnapshot.sessionId;
  render(app()); await flush();
  expect(location.lastSnapshotId).toBeNull(); expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('saved_context_incomplete');
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test.each(['GPS observation', 'weather'])('a legacy saved snapshot without %s stays readable without fabricating data or automatically collecting again', async missing => {
  canonical.currentSnapshot.ready = false;
  if (missing === 'GPS observation') canonical.currentSnapshot.gps_timestamp = null;
  else canonical.currentSnapshot.weather = null;
  render(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED);
  expect(location.city).toBe('Synthetic saved city');
  expect(location.currentCoords).toEqual({ latitude: 0, longitude: 12.3456789 });
  expect(location.timeZone).toBe('Etc/UTC');
  if (missing === 'GPS observation') expect(location.lastUpdated).toBeNull();
  else expect(location.weather).toBeNull();
  expect(location.contextReady).toBe(false);
  expect(location.locationError).not.toBeNull();
  await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('an invalid saved timezone stays unknown while genuine location remains readable without a workflow restart', async () => {
  canonical.currentSnapshot.timeZone = 'Invalid/Fixture';
  canonical.currentSnapshot.ready = false;
  const view = render(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.city).toBe('Synthetic saved city');
  expect(location.currentCoords).toEqual({ latitude: 0, longitude: 12.3456789 });
  expect(location.timeZone).toBeNull(); expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('context_incomplete');
  await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  view.unmount(); render(app()); await flush();
  expect(location.timeZone).toBeNull(); expect(location.currentCoords?.latitude).toBe(0);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test.each(['missing readback', 'stale readback'])('a new snapshot cannot be used for Strategy after %s', async kind => {
  reload.mockResolvedValue(kind === 'missing readback' ? null : canonical);
  render(app()); await flush();
  await act(async () => { expect(await location.refreshGPS()).toBeNull(); });
  expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('context_preparation_failed');
});

test.each(['owner', 'session'])('an old deferred capture cannot publish into a replacement %s', async kind => {
  const capture = deferred<Response>(); const published = jest.fn();
  jest.mocked(fetch).mockImplementation((input, options) => String(input) === API_ROUTES.LOCATION.SNAPSHOT
    ? capture.promise : route(input, options));
  window.addEventListener('vecto-snapshot-saved', published);
  const view = render(app()); await flush();
  let refreshing!: Promise<string | null>;
  act(() => { refreshing = location.refreshGPS(); }); await flush();
  const receipt = { ...nextReceipt };
  const replacement = kind === 'owner' ? { ...snapshot(SAVED), user_id: 'synthetic-owner-B', sessionId: 'synthetic-session-B' }
    : { ...snapshot(SAVED), sessionId: 'synthetic-session-B' };
  identity = { ...identity, user: { userId: replacement.user_id }, token: 'synthetic-token-B', sessionId: replacement.sessionId };
  setupContext = { ...setupContext, setup: { ...canonical, sessionId: replacement.sessionId, currentSnapshot: replacement } };
  view.rerender(app()); await flush();
  await act(async () => { capture.resolve(response(receipt)); expect(await refreshing).toBeNull(); });
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.city).toBe('Synthetic saved city');
  expect(published).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls).toHaveLength(1);
  window.removeEventListener('vecto-snapshot-saved', published);
});


test('a newer canonical same-session snapshot is hydrated without requesting fresh GPS', async () => {
  const view = render(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED);
  canonical = { ...canonical, currentSnapshot: nextReceipt };
  setupContext = { ...setupContext, setup: canonical };
  view.rerender(app()); await flush();
  expect(location.lastSnapshotId).toBe(FRESH);
  expect(location.city).toBe('Synthetic fresh city');
  expect(location.contextReady).toBe(true);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});

test('completed canonical preparation restores readiness without starting another collection', async () => {
  canonical = { ...canonical, currentContextPending: true, currentSnapshot: { ...snapshot(), briefingReady: false } };
  setupContext = { ...setupContext, setup: canonical };
  const view = render(app()); await flush();
  expect(location.contextReady).toBe(false);
  canonical = { ...canonical, currentContextPending: false, currentSnapshot: { ...canonical.currentSnapshot, briefingReady: true } };
  setupContext = { ...setupContext, setup: canonical };
  view.rerender(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.contextReady).toBe(true);
  expect(location.locationError).toBeNull();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('unchanged canonical readback preserves a scoped ownership hold until explicit Refresh', async () => {
  const view = render(app()); await flush();
  await act(async () => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: SAVED } })); });
  expect(location.contextReady).toBe(false);
  setupContext = { ...setupContext, setup: { ...canonical, currentSnapshot: { ...canonical.currentSnapshot } } };
  view.rerender(app()); await flush();
  expect(location.contextReady).toBe(false); expect(location.locationError?.code).toBe('snapshot_ownership_error');
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('a changed canonical snapshot cannot clear revoked location permission', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions');
  const permission = Object.assign(new EventTarget(), { state: 'granted' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: jest.fn(async () => permission) } });
  try {
    const view = render(app()); await flush();
    await act(async () => { permission.state = 'denied'; permission.dispatchEvent(new Event('change')); });
    canonical = { ...canonical, currentSnapshot: nextReceipt };
    setupContext = { ...setupContext, setup: canonical };
    view.rerender(app()); await flush();
    expect(location.lastSnapshotId).toBe(FRESH); expect(location.contextReady).toBe(false);
    expect(location.locationError?.code).toBe('location_permission_denied');
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'permissions', descriptor);
    else Reflect.deleteProperty(navigator, 'permissions');
  }
});

test('a missing canonical snapshot after hydration holds previous context for manual Refresh without recapturing', async () => {
  const view = render(app()); await flush();
  canonical = { ...canonical, currentSnapshot: null };
  setupContext = { ...setupContext, setup: canonical };
  view.rerender(app()); await flush();
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('context_incomplete');
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('a delayed ownership error for previous context cannot cancel the driver’s new manual GPS retry', async () => {
  let gps!: PositionCallback;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { gps = success; });
  render(app()); await flush();
  let refreshing!: Promise<string | null>;
  act(() => { refreshing = location.refreshGPS(); }); await flush();
  expect(location.lastSnapshotId).toBe(SAVED); expect(location.isUpdating).toBe(true);
  await act(async () => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: SAVED } })); });
  expect(location.isUpdating).toBe(true);
  await act(async () => {
    gps({ coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now() } as GeolocationPosition);
    expect(await refreshing).toBe(FRESH);
  });
  expect(location.lastSnapshotId).toBe(FRESH); expect(location.contextReady).toBe(true);
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
});

test('an ownership error for the active manual capture still cancels that capture', async () => {
  let gps!: PositionCallback;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { gps = success; });
  render(app()); await flush();
  let refreshing!: Promise<string | null>;
  act(() => { refreshing = location.refreshGPS(); }); await flush();
  await act(async () => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: FRESH } })); });
  expect(location.isUpdating).toBe(false); expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('snapshot_ownership_error');
  await act(async () => {
    gps({ coords: { latitude: 0, longitude: 12.3456789, accuracy: 7 }, timestamp: Date.now() } as GeolocationPosition);
    expect(await refreshing).toBeNull();
  });
  expect(fetch).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});
