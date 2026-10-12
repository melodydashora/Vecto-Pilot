// Synthetic browser GPS and owned server receipts; every HTTP request is local.
import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

let auth = { user: { userId: 'fixture-driver' }, token: 'fixture-token', sessionId: 'fixture-session', isAuthenticated: true };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => auth }));
const { useCoachSnapshot } = await import('@/hooks/coach/useCoachSnapshot');
const { CoachSnapshotStatus } = await import('@/components/coach/CoachContextStatus');
let context: ReturnType<typeof useCoachSnapshot>;
function Probe() { context = useCoachSnapshot(); return <CoachSnapshotStatus context={context} />; }
const originalFetch = globalThis.fetch;
const originalGps = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
const MAIN_EVENTS = ['vecto-snapshot-saved', 'vecto-main-run-held', 'vecto-strategy-started'];
const mainEvent = jest.fn();
const SAVED = '00000000-0000-4000-8000-000000000090';
let saved: any;
let gps: { latitude: number; longitude: number; accuracy: number; timestamp: number };
let requests: Array<{ input: string; options: RequestInit }>;
let handler: (options: RequestInit) => Promise<Response>;
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response;
const receipt = (capture: any = {}) => ({
  ok: true, success: true, context_kind: 'coach', status: 'ok', ready: true,
  snapshot_id: capture.captureId || SAVED, user_id: auth.user.userId, sessionId: auth.sessionId,
  city: 'Fixture city', state: 'Fixture state', country: 'Fixture country', formattedAddress: 'Fixture resolved address',
  timeZone: 'America/Chicago', lat: capture.lat ?? gps.latitude, lng: capture.lng ?? gps.longitude,
  accuracy: capture.accuracy ?? gps.accuracy, gps_timestamp: capture.gps_timestamp ?? gps.timestamp,
  created_at: new Date().toISOString(), weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' },
});
async function flush() { await act(async () => { await Promise.resolve(); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  localStorage.clear(); mainEvent.mockClear(); requests = [];
  auth = { user: { userId: 'fixture-driver' }, token: 'fixture-token', sessionId: 'fixture-session', isAuthenticated: true };
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, auth.token);
  gps = { latitude: 0, longitude: -96.123456789, accuracy: 9, timestamp: Date.now() };
  saved = { ...receipt(), gps_timestamp: Date.now() - 600_000 };
  let id = 0;
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: jest.fn((success: PositionCallback) => success({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition)),
  } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  handler = async options => response(options.method === 'POST' ? receipt(JSON.parse(String(options.body))) : saved || { ok: true, snapshot: null });
  globalThis.fetch = jest.fn<typeof fetch>(async (input, options = {}) => {
    if (String(input) !== API_ROUTES.COACH.SNAPSHOT) throw new Error('Unexpected Coach snapshot request');
    requests.push({ input: String(input), options });
    return handler(options);
  });
  MAIN_EVENTS.forEach(name => window.addEventListener(name, mainEvent));
});
afterEach(() => {
  cleanup();
  MAIN_EVENTS.forEach(name => window.removeEventListener(name, mainEvent));
  expect(mainEvent).not.toHaveBeenCalled();
  expect(requests.every(request => request.input === '/api/coach/snapshot')).toBe(true);
  globalThis.fetch = originalFetch;
  if (originalGps) Object.defineProperty(navigator, 'geolocation', originalGps); else Reflect.deleteProperty(navigator, 'geolocation');
  if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions); else Reflect.deleteProperty(navigator, 'permissions');
  jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers();
});

async function activate() {
  const view = render(<Probe />); await flush();
  saved = context.snapshot;
  requests = [];
  jest.mocked(navigator.geolocation.getCurrentPosition).mockClear();
  return view;
}

test('activation refreshes once; rerenders, foreground and age updates do not recapture GPS', async () => {
  const view = render(<Probe />); await flush();
  expect(context.snapshot?.snapshot_id).not.toBe(SAVED);
  expect(screen.getByText(/observed just now/)).toBeInTheDocument();
  view.rerender(<Probe />); await flush();
  await act(async () => { jest.advanceTimersByTime(60_000); window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText(/observed 1 minute ago/)).toBeInTheDocument();
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST']);
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  gps.timestamp = Date.now();
  view.unmount(); render(<Probe />); await flush();
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
});

test('first activation without saved context posts exact sensor fields only', async () => {
  saved = null; render(<Probe />); await flush();
  const post = requests[1].options;
  expect(post.method).toBe('POST');
  expect(post.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
  expect(JSON.parse(String(post.body))).toEqual({ captureId: context.snapshot?.snapshot_id,
    lat: 0, lng: gps.longitude, accuracy: 9, gps_timestamp: gps.timestamp, permission: 'granted' });
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  expect(context.refreshing).toBe(false);
  expect(context.snapshot?.lat).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Coach context' })); await flush();
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST', 'POST']);
});

test('a failed refresh retains the observation, its timestamp and an actionable error', async () => {
  await activate();
  handler = async () => response({ message: 'Synthetic collection unavailable' }, 502);
  let result: string | null = 'unset';
  await act(async () => { result = await context.refresh(); });
  expect(result).toBeNull();
  expect(context.snapshot).toEqual(saved);
  expect(context.error).toContain('Synthetic collection unavailable');
  expect(screen.getByRole('alert')).toHaveTextContent('previous observation is still shown');
  expect(screen.getByRole('button', { name: 'Refresh Coach context' })).toBeEnabled();
});

test.each(['headers', 'body'] as const)('a stalled %s times out without adopting its late receipt', async stage => {
  await activate();
  const late = deferred<any>(); let pendingReceipt: any;
  handler = async options => {
    pendingReceipt = receipt(JSON.parse(String(options.body)));
    return stage === 'headers' ? late.promise : { ok: true, status: 200, json: () => late.promise } as Response;
  };
  let pending!: Promise<string | null>;
  act(() => { pending = context.refresh(); }); await flush();
  await act(async () => { jest.advanceTimersByTime(30_001); await pending; });
  expect(context.refreshing).toBe(false);
  expect(context.error).toContain('timed out');
  await act(async () => { late.resolve(stage === 'headers' ? response(pendingReceipt) : pendingReceipt); });
  expect(context.snapshot).toEqual(saved);
});

test('a late restore cannot overwrite an explicit successful capture', async () => {
  const late = deferred<Response>();
  handler = async options => options.method === 'GET' ? late.promise : response(receipt(JSON.parse(String(options.body))));
  render(<Probe />); await flush();
  await act(async () => context.refresh());
  const fresh = context.snapshot;
  await act(async () => late.resolve(response(saved)));
  expect(context.snapshot).toBe(fresh);
  expect(fresh?.snapshot_id).not.toBe(SAVED);
});

test('activation and simultaneous explicit/model refreshes share one capture and return its saved ID', async () => {
  const late = deferred<Response>(); let pendingReceipt: any;
  handler = async options => {
    if (options.method === 'GET') return response(saved);
    pendingReceipt = receipt(JSON.parse(String(options.body))); return late.promise;
  };
  render(<Probe />); await flush();
  const first = context.refresh();
  const second = context.refresh();
  expect(first).toBe(second);
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST']);
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  await act(async () => { late.resolve(response(pendingReceipt)); await first; });
  expect(await first).toBe(pendingReceipt.snapshot_id);
  expect(context.snapshot?.snapshot_id).toBe(pendingReceipt.snapshot_id);
});

test('a successful older observation returns the retained newer saved ID for the follow-up answer', async () => {
  await activate();
  const newer = context.snapshot;
  gps.timestamp -= 1000;
  let id: string | null = null;
  await act(async () => { id = await context.refresh(); });
  expect(context.snapshot).toBe(newer);
  expect(id).toBe(newer?.snapshot_id);
});

test('activation still refreshes after a failed restore without retrying the read', async () => {
  handler = async options => options.method === 'GET' ? response({ message: 'Synthetic read failure' }, 503)
    : response(receipt(JSON.parse(String(options.body))));
  render(<Probe />); await flush();
  expect(context.snapshot).not.toBeNull();
  expect(context.error).toBeNull();
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST']);
});

test('unmounting during restore prevents activation GPS even when its response arrives later', async () => {
  const late = deferred<Response>(); handler = async () => late.promise;
  const view = render(<Probe />); await flush(); view.unmount();
  await act(async () => late.resolve(response(saved)));
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

test.each(['owner', 'session', 'purpose', 'identity', 'coordinates', 'timezone', 'observation', 'environment'] as const)('invalid %s receipt never replaces saved context', async field => {
  await activate();
  handler = async options => {
    const value = receipt(JSON.parse(String(options.body)));
    if (field === 'owner') value.user_id = 'foreign';
    if (field === 'session') value.sessionId = 'expired';
    if (field === 'purpose') value.context_kind = 'upstream';
    if (field === 'identity') value.snapshot_id = SAVED;
    if (field === 'coordinates') value.lat = 91;
    if (field === 'timezone') value.timeZone = 'Not/AZone';
    if (field === 'observation') value.gps_timestamp = NaN;
    if (field === 'environment') value.weather = null as any;
    return response(value);
  };
  await act(async () => context.refresh());
  expect(context.snapshot).toEqual(saved);
  expect(context.error).toBeTruthy();
});

test.each(['account', 'token', 'session', 'unmount'] as const)('late refresh callbacks are fenced after %s changes', async boundary => {
  const view = await activate();
  const late = deferred<Response>(); let oldReceipt: any;
  handler = async options => {
    if (options.method === 'GET') return response({ ok: true, snapshot: null });
    oldReceipt = receipt(JSON.parse(String(options.body))); return late.promise;
  };
  let pending!: Promise<string | null>;
  act(() => { pending = context.refresh(); }); await flush();
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => Object.assign(new EventTarget(), { state: 'denied' }) } });
  if (boundary === 'unmount') view.unmount();
  else {
    if (boundary === 'account') auth = { ...auth, user: { userId: 'other-driver' } };
    if (boundary === 'token') { auth = { ...auth, token: 'other-token' }; localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, auth.token); }
    if (boundary === 'session') auth = { ...auth, sessionId: 'other-session' };
    view.rerender(<Probe />); await flush();
  }
  await act(async () => { late.resolve(response(oldReceipt)); await pending; });
  expect(await pending).toBeNull();
  if (boundary !== 'unmount') { expect(context.snapshot).toBeNull(); expect(context.error).toContain('permission was denied'); }
  expect((requests.find(request => request.options.method === 'POST')!.options.signal as AbortSignal).aborted).toBe(true);
});

test('revoked permission cancels capture, retains historical context and ignores late GPS', async () => {
  const permission = Object.assign(new EventTarget(), { state: 'granted' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
  await activate();
  let resolveGps!: PositionCallback;
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { resolveGps = success; });
  let pending!: Promise<string | null>;
  act(() => { pending = context.refresh(); }); await flush();
  await act(async () => { permission.state = 'denied'; permission.dispatchEvent(new Event('change')); await pending; });
  expect(context.snapshot).toEqual(saved);
  expect(context.error).toContain('permission was denied');
  await act(async () => resolveGps({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition));
  expect(requests).toHaveLength(0);
});

test('already denied permission still restores the previous observation without capturing GPS', async () => {
  const permission = Object.assign(new EventTarget(), { state: 'denied' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
  render(<Probe />); await flush();
  expect(context.snapshot).toEqual(saved);
  await act(async () => context.refresh());
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

test('regranting location allows a later refresh instead of reusing the denied capture promise', async () => {
  const permission = Object.assign(new EventTarget(), { state: 'denied' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
  render(<Probe />); await flush();
  expect(context.snapshot).toEqual(saved);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  await act(async () => { permission.state = 'granted'; permission.dispatchEvent(new Event('change')); });
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  let id: string | null = null;
  await act(async () => { id = await context.refresh(); });
  expect(id).toBe(context.snapshot?.snapshot_id);
  expect(id).not.toBe(SAVED);
  expect(context.error).toBeNull();
});

test('failed activation refresh preserves the restored observation and a visible error', async () => {
  handler = async options => options.method === 'GET' ? response(saved)
    : response({ message: 'Synthetic collection unavailable' }, 502);
  render(<Probe />); await flush();
  expect(context.snapshot).toEqual(saved);
  expect(screen.getByRole('alert')).toHaveTextContent('previous observation is still shown');
  expect(screen.getByText(/observed 10 minutes ago/)).toBeInTheDocument();
  expect(requests.map(request => request.options.method)).toEqual(['GET', 'POST']);
});

test('signed-out or session-incomplete identity cannot read or refresh private Coach observations', async () => {
  auth.isAuthenticated = false;
  const view = render(<Probe />); await flush();
  await act(async () => context.refresh());
  expect(context.canRefresh).toBe(false);
  auth = { ...auth, isAuthenticated: true, sessionId: '' };
  view.rerender(<Probe />); await flush();
  await act(async () => context.refresh());
  expect(requests).toHaveLength(0);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});
