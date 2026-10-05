// Synthetic GPS and API receipts. No network or live account data.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { render, act, cleanup } from '@testing-library/react';
import { SESSION_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';

let identity = { user: { userId: 'fixture-driver' }, profile: null, token: 'fixture-only', sessionId: 'fixture-session', isAuthenticated: true, isLoading: false };
let setupContext: any;
const reviewSetup = jest.fn();
const reload = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => setupContext }));
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
let location: ReturnType<typeof useLocation>;
const published = jest.fn();
let gps: { latitude: number; longitude: number; accuracy: number; timestamp: number };
let enrichStatus: string;
let enrichHttp: number;
let environment: any;
let storedSnapshot: any;
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
async function route(input: string | URL | Request, options?: RequestInit) {
  if (String(input) === API_ROUTES.LOCATION.SNAPSHOT) {
    const payload = JSON.parse(String(options?.body));
    storedSnapshot = { city: 'Fixture city', state: 'Fixture region', country: 'Fixture country',
      timeZone: 'America/Chicago', formattedAddress: 'Fixture resolved address', snapshot_id: payload.captureId,
      sourceSnapshotId: payload.captureId, user_id: identity.user.userId, sessionId: identity.sessionId,
      lat: gps.latitude, lng: gps.longitude, gps_timestamp: gps.timestamp, accuracy: gps.accuracy,
      created_at: new Date(gps.timestamp).toISOString(), status: enrichStatus, ready: enrichStatus === 'ok',
      briefingReady: true, ...environment };
    return response(storedSnapshot, enrichHttp);
  }
  if (String(input) === API_ROUTES.LOCATION.NEWS_BRIEFING) return response({ success: true, complete: true });
  throw new Error('Unexpected fixture request ' + String(input));
}
function Probe() { location = useLocation(); return null; }
const app = () => <LocationProvider><Probe /></LocationProvider>;
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T18:00:00Z'));
  localStorage.clear(); sessionStorage.clear(); published.mockClear(); reviewSetup.mockClear();
  identity = { user: { userId: 'fixture-driver' }, profile: null, token: 'fixture-only', sessionId: 'fixture-session', isAuthenticated: true, isLoading: false };
  setupContext = { run: null, loading: false, setup: { sessionId: identity.sessionId,
    ready: false, currentSnapshot: null }, reviewSetup, reload };
  reload.mockReset(); reload.mockImplementation(async () => ({ ...setupContext.setup, currentSnapshot: storedSnapshot }));
  gps = { latitude: 33.12345678, longitude: -96.87654321, accuracy: 9, timestamp: Date.now() };
  enrichStatus = 'ok'; enrichHttp = 200;
  environment = { weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } };
  let uuid = 0;
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn((success: PositionCallback) => success({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition)) } });
  global.fetch = jest.fn<typeof fetch>().mockImplementation(route);
  window.addEventListener('vecto-snapshot-saved', published);
});
afterEach(() => { cleanup(); window.removeEventListener('vecto-snapshot-saved', published); jest.restoreAllMocks(); jest.useRealTimers(); });

test('signed-out setup ignores stored snapshots, refresh and ownership events without private collection', async () => {
  identity.isAuthenticated = false;
  sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, JSON.stringify({ snapshotId: 'old', city: 'Old city', timestamp: Date.now() }));
  render(app()); await flush();
  await act(async () => { await location.refreshGPS(); window.dispatchEvent(new CustomEvent('snapshot-ownership-error')); });
  expect(reviewSetup).not.toHaveBeenCalled();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(location.lastSnapshotId).toBeNull(); expect(location.city).toBeNull();
});
test('fresh GPS preserves extra precision, timestamp and permission before Strategy admission', async () => {
  render(app()); await flush();
  expect(location.currentCoords).toEqual({ latitude: gps.latitude, longitude: gps.longitude });
  const captureCall = jest.mocked(fetch).mock.calls[0];
  expect(captureCall[0]).toBe(API_ROUTES.LOCATION.SNAPSHOT);
  expect(JSON.parse(String(captureCall[1]?.body))).toMatchObject({ lat: gps.latitude, lng: gps.longitude,
    gps_timestamp: gps.timestamp, permission: 'granted', captureId: storedSnapshot.snapshot_id });
  expect(captureCall[1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-only' });
  expect(location.isLocationResolved).toBe(true); expect(location.weather?.temp).toBe(0);
  expect(location.airQuality?.aqi).toBe(0); expect(published).toHaveBeenCalledTimes(1);
  expect((published.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ snapshotId: storedSnapshot.snapshot_id, reason: 'context' });
  expect(location.runId).toBeNull(); expect(location.contextReady).toBe(true);
  expect(jest.mocked(fetch).mock.calls.some(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE)).toBe(false);
  expect(jest.mocked(fetch).mock.calls.some(([input]) => /drop|release-snapshot/.test(String(input)))).toBe(false);
});
test.each(['pending', 'error'])('enrichment status %s stays incomplete', async status => {
  enrichStatus = status; render(app()); await flush();
  expect(location.isLocationResolved).toBe(false); expect(location.contextReady).toBe(false);
  expect(location.locationError?.code).toBe('context_preparation_failed');
  expect(published).not.toHaveBeenCalled();
});
test('failed snapshot HTTP cannot publish ready', async () => {
  enrichHttp = 500; render(app()); await flush();
  expect(location.isLocationResolved).toBe(false); expect(published).not.toHaveBeenCalled();
});
test.each(['weather', 'air'])('missing saved %s measurements cannot publish ready', async field => {
  environment[field] = null;
  render(app()); await flush();
  expect(location.isLocationResolved).toBe(false); expect(location.contextReady).toBe(false);
  expect(published).not.toHaveBeenCalled();
});
test.each(['Invalid/Fixture', ''])('a fresh capture with unverified timezone %s cannot publish ready', async timeZone => {
  environment.timeZone = timeZone;
  render(app()); await flush();
  expect(location.isLocationResolved).toBe(false); expect(location.contextReady).toBe(false);
  expect(location.timeZone).toBeNull(); expect(published).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls).toHaveLength(1);
});
test('only persisted measured values are rendered; Briefing receives the saved snapshot identity', async () => {
  environment = { weather: { tempF: 41, conditions: 'Rain' }, air: { aqi: 55, category: 'Moderate' } };
  render(app()); await flush();
  expect(jest.mocked(fetch).mock.calls[1][0]).toBe(API_ROUTES.LOCATION.NEWS_BRIEFING);
  expect(JSON.parse(String(jest.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ snapshotId: storedSnapshot.snapshot_id });
  expect(location.weather).toMatchObject({ temp: 41, conditions: 'Rain' });
});
test.each(['coarse', 'stale', 'invalid'])('%s GPS stops before API collection', async kind => {
  if (kind === 'coarse') gps.accuracy = 5000;
  if (kind === 'stale') gps.timestamp -= 60000;
  if (kind === 'invalid') gps.latitude = 999;
  render(app()); await flush();
  expect(fetch).not.toHaveBeenCalled(); expect(location.currentCoords).toBeNull(); expect(published).not.toHaveBeenCalled();
});
test.each(['owner', 'session'])('late GPS from a superseded %s cannot restore current context', async kind => {
  const callbacks: PositionCallback[] = [];
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { callbacks.push(success); });
  const view = render(app()); await flush();
  identity = { ...identity, token: 'replacement-token', sessionId: 'replacement-session',
    user: { userId: kind === 'owner' ? 'replacement-owner' : identity.user.userId } };
  setupContext = { ...setupContext, setup: { ...setupContext.setup, sessionId: identity.sessionId } };
  view.rerender(app());
  await act(async () => { callbacks[0]({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition); });
  expect(fetch).not.toHaveBeenCalled(); expect(location.lastSnapshotId).toBeNull();
  await act(async () => { callbacks[1]({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition); });
  expect(location.lastSnapshotId).toBe(storedSnapshot.snapshot_id); expect(published).toHaveBeenCalledTimes(1);
});

test('observed geolocation revocation aborts capture and holds local context for manual retry', async () => {
  const permission = new EventTarget() as EventTarget & { state: string };
  permission.state = 'granted';
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
  let callback!: PositionCallback;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { callback = success; });
  render(app()); await flush();
  await act(async () => { permission.state = 'denied'; permission.dispatchEvent(new Event('change')); });
  expect(reviewSetup).not.toHaveBeenCalled();
  expect(location.locationError?.message).toMatch(/permission|location/i);
  expect(location.contextReady).toBe(false); expect(location.isLoading).toBe(false);
  await act(async () => { callback({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition); });
  expect(fetch).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
});

test('concurrent capture winner supplies coordinates and observation time for the displayed snapshot', async () => {
  const stored = { lat: 0, lng: 12.3456789, gps_timestamp: Date.now() - 1000, accuracy: 8 };
  jest.mocked(fetch).mockImplementation(async (input, options) => {
    const original = await route(input, options);
    if (String(input) !== API_ROUTES.LOCATION.SNAPSHOT) return original;
    storedSnapshot = { ...await original.json(), ...stored };
    return response(storedSnapshot);
  });
  render(app()); await flush();
  expect(location.isLocationResolved).toBe(true);
  expect(location.currentCoords).toEqual({ latitude: stored.lat, longitude: stored.lng });
  expect(location.lastUpdated).toBe(new Date(stored.gps_timestamp).toISOString());
  expect(published).toHaveBeenCalledTimes(1);
});

test.each(['coordinates', 'observation'])('invalid saved snapshot %s cannot be replaced with the request GPS', async field => {
  jest.mocked(fetch).mockImplementation(async (input, options) => {
    const original = await route(input, options);
    return String(input) === API_ROUTES.LOCATION.SNAPSHOT ? response({ ...await original.json(),
      ...(field === 'coordinates' ? { lat: 999 } : { gps_timestamp: null }) }) : original;
  });
  render(app()); await flush();
  expect(location.isLocationResolved).toBe(false);
  expect(location.currentCoords).toBeNull();
  expect(published).not.toHaveBeenCalled();
});


test('matching terminal Briefing failure aborts capture and late success cannot mark context ready', async () => {
  let finish!: (value: Response) => void;
  let signal!: AbortSignal;
  jest.mocked(fetch).mockImplementation((input, options) => String(input) === API_ROUTES.LOCATION.NEWS_BRIEFING
    ? new Promise<Response>(resolve => { finish = resolve; signal = options!.signal as AbortSignal; }) : route(input, options));
  render(app()); await flush();
  expect(location.isUpdating).toBe(true);
  act(() => window.dispatchEvent(new CustomEvent('vecto-briefing-failed', { detail: {
    snapshotId: location.lastSnapshotId, ownerId: identity.user.userId, sessionId: identity.sessionId, message: 'Airport source failed',
  } })));
  expect(signal.aborted).toBe(true);
  expect(location.isUpdating).toBe(false); expect(location.isLoading).toBe(false);
  expect(location.contextReady).toBe(false); expect(location.locationError?.code).toBe('briefing_failed');
  await act(async () => { finish(response({ success: true, complete: true })); });
  expect(reload).not.toHaveBeenCalled(); expect(location.contextReady).toBe(false);
});

test.each(['owner', 'session', 'snapshot'])('a foreign %s failure cannot release the current capture', async boundary => {
  let signal!: AbortSignal;
  jest.mocked(fetch).mockImplementation((input, options) => String(input) === API_ROUTES.LOCATION.NEWS_BRIEFING
    ? new Promise<Response>(() => { signal = options!.signal as AbortSignal; }) : route(input, options));
  render(app()); await flush();
  const detail = { snapshotId: location.lastSnapshotId, ownerId: identity.user.userId, sessionId: identity.sessionId, message: 'Old failure' };
  if (boundary === 'owner') detail.ownerId = 'old-owner';
  if (boundary === 'session') detail.sessionId = 'old-session';
  if (boundary === 'snapshot') detail.snapshotId = 'old-snapshot';
  act(() => window.dispatchEvent(new CustomEvent('vecto-briefing-failed', { detail })));
  expect(signal.aborted).toBe(false); expect(location.isUpdating).toBe(true);
  expect(location.locationError).toBeNull();
});
