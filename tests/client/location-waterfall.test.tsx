// All GPS, authentication, network responses and measurements are synthetic.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { render, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SESSION_KEYS } from '@/constants/storageKeys';

const identity = { user: { userId: 'fixture-driver' }, profile: null, token: 'fixture-only', isLoading: false };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => identity }));
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
let location: ReturnType<typeof useLocation>;
const clients: QueryClient[] = [];
const published = jest.fn();
let gps: { latitude: number; longitude: number; accuracy: number; timestamp: number };
let enrichStatus: string;
let enrichHttp: number;
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
async function route(input: string | URL | Request) {
  const url = new URL(String(input), 'http://fixture.invalid');
  if (url.pathname.endsWith('/resolve')) return response({ city: 'Fixture city', state: 'Fixture region', country: 'Fixture country', timeZone: 'America/Chicago', formattedAddress: 'Fixture resolved address', snapshot_id: 'fixture-snapshot' });
  if (url.pathname.endsWith('/weather')) return response({ available: true, temperature: 0, conditions: 'Clear' });
  if (url.pathname.endsWith('/airquality') || url.pathname.endsWith('/air-quality')) return response({ available: true, aqi: 0, category: 'Good' });
  if (url.pathname.endsWith('/enrich')) return response({ ok: true, status: enrichStatus, weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } }, enrichHttp);
  if (url.pathname.endsWith('/drop') || url.pathname.endsWith('/release-snapshot')) return response({ ok: true });
  throw new Error(`Unexpected fixture request ${url.pathname}`);
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  function Probe() { location = useLocation(); return null; }
  render(<QueryClientProvider client={client}><LocationProvider><Probe /></LocationProvider></QueryClientProvider>);
}
async function start() { await act(async () => { jest.advanceTimersByTime(55); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-11T18:00:00Z'));
  localStorage.clear(); sessionStorage.clear(); published.mockClear();
  gps = { latitude: 33.12345678, longitude: -96.87654321, accuracy: 9, timestamp: Date.now() };
  enrichStatus = 'ok'; enrichHttp = 200;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn((success: PositionCallback) => success({ coords: gps, timestamp: gps.timestamp } as unknown as GeolocationPosition)) } });
  global.fetch = jest.fn<typeof fetch>().mockImplementation(route);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  window.addEventListener('vecto-snapshot-saved', published);
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear());
  window.removeEventListener('vecto-snapshot-saved', published);
  jest.restoreAllMocks(); jest.useRealTimers();
});

test('fresh GPS is normalized before APIs and readiness is published only after server enrichment', async () => {
  mount(); await start();
  expect(location.currentCoords).toEqual({ latitude: 33.123457, longitude: -96.876543 });
  const requests = jest.mocked(fetch).mock.calls.map(call => String(call[0]));
  expect(requests.find(url => url.includes('/resolve'))).toContain('lat=33.123457');
  expect(requests.find(url => url.includes('/resolve'))).toContain('lng=-96.876543');
  expect(location.isLocationResolved).toBe(true);
  expect(location.weather?.temp).toBe(0); expect(location.airQuality?.aqi).toBe(0);
  expect(published).toHaveBeenCalledTimes(1);
});

test.each(['pending', 'error'])('server enrichment status %s cannot publish a ready waterfall', async status => {
  enrichStatus = status;
  mount(); await start();
  expect(location.isLocationResolved).toBe(false);
  expect(location.lastSnapshotId).toBe('fixture-snapshot');
  expect(location.locationError?.code).toBe('snapshot_incomplete');
  expect(published).not.toHaveBeenCalled();
});

test('failed enrichment HTTP cannot pass even when its body claims ok', async () => {
  enrichHttp = 500;
  mount(); await start();
  expect(location.isLocationResolved).toBe(false); expect(published).not.toHaveBeenCalled();
});

test('ready header uses persisted server values and never sends provisional readings back as authority', async () => {
  jest.mocked(fetch).mockImplementation(async input => {
    if (String(input).endsWith('/enrich')) return response({ ok: true, status: 'ok', weather: { tempF: 41, conditions: 'Rain' }, air: { aqi: 55, category: 'Moderate' } });
    return route(input);
  });
  mount(); await start();
  const enrichCall = jest.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/enrich'));
  expect(JSON.parse(String(enrichCall?.[1]?.body))).toEqual({});
  expect(location.weather).toMatchObject({ temp: 41, conditions: 'Rain' });
  expect(location.airQuality).toEqual({ aqi: 55, category: 'Moderate' });
  expect(location.isLocationResolved).toBe(true);
});

test('server status alone without persisted measured values cannot unlock the client', async () => {
  jest.mocked(fetch).mockImplementation(async input => String(input).endsWith('/enrich')
    ? response({ ok: true, status: 'ok' }) : route(input));
  mount(); await start();
  expect(location.isLocationResolved).toBe(false);
  expect(published).not.toHaveBeenCalled();
});

test.each(['coarse', 'stale', 'invalid'])('%s GPS stops before location APIs', async kind => {
  if (kind === 'coarse') gps.accuracy = 5000;
  if (kind === 'stale') gps.timestamp -= 60_000;
  if (kind === 'invalid') gps.latitude = 999;
  mount(); await start();
  expect(jest.mocked(fetch).mock.calls.some(call => String(call[0]).includes('/resolve'))).toBe(false);
  expect(location.isLocationResolved).toBe(false); expect(location.currentCoords).toBeNull();
  expect(published).not.toHaveBeenCalled();
});

test('a reopened cached session still requests fresh GPS and cannot unlock on a coarse fix', async () => {
  sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, JSON.stringify({ snapshotId: 'old-snapshot', coords: { latitude: 1, longitude: 1 }, city: 'Old city', state: 'Old region', timeZone: 'America/Chicago', timestamp: Date.now() - 60_000, lastUpdated: new Date(Date.now() - 60_000).toISOString() }));
  gps.accuracy = 5000;
  mount(); await start();
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(location.isLocationResolved).toBe(false);
  expect(published).not.toHaveBeenCalled();
});

test('an older GPS callback cannot overwrite a newer accepted fix', async () => {
  const callbacks: PositionCallback[] = [];
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { callbacks.push(success); });
  mount(); await start();
  let refresh!: Promise<void>;
  await act(async () => { refresh = location.refreshGPS(); });
  expect(callbacks).toHaveLength(2);
  await act(async () => {
    callbacks[1]({ coords: { ...gps, latitude: 34 }, timestamp: gps.timestamp } as unknown as GeolocationPosition);
    await refresh;
  });
  await act(async () => { callbacks[0]({ coords: { ...gps, latitude: 12 }, timestamp: gps.timestamp } as unknown as GeolocationPosition); });
  expect(location.currentCoords?.latitude).toBe(34);
  expect(published).toHaveBeenCalledTimes(1);
  expect(location.isUpdating).toBe(false);
});

test('starting a GPS refresh immediately invalidates older enrichment, even while the new fix is pending', async () => {
  let finishWeather!: (response: Response) => void;
  const oldWeather = new Promise<Response>(resolve => { finishWeather = resolve; });
  jest.mocked(fetch).mockImplementation(async input => String(input).includes('/weather') ? oldWeather : route(input));
  mount(); await start();
  const callbacks: PositionCallback[] = [];
  jest.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => { callbacks.push(success); });
  let refresh!: Promise<void>;
  await act(async () => { refresh = location.refreshGPS(); });
  await act(async () => { finishWeather(response({ available: true, temperature: 80, conditions: 'Old result' })); });
  expect(location.isLocationResolved).toBe(false);
  expect(published).not.toHaveBeenCalled();
  await act(async () => {
    callbacks[0]({ coords: { ...gps, accuracy: 5000 }, timestamp: gps.timestamp } as unknown as GeolocationPosition);
    await refresh;
  });
  expect(location.isLocationResolved).toBe(false);
  expect(location.locationError?.code).toBe('gps_unavailable');
  expect(published).not.toHaveBeenCalled();
});
