// Actual provider/event/query lifecycle with synthetic auth, GPS and transport.
import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { render, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';

const reviewSetup = jest.fn();
const saved = { snapshot_id: 'fixture-snapshot', sourceSnapshotId: 'fixture-snapshot',
  user_id: 'fixture-owner', sessionId: 'fixture-session', ready: true, briefingReady: true,
  status: 'ok', lat: 0, lng: 12.3456789, city: 'Fixture city', state: 'Fixture region',
  timeZone: 'Etc/UTC', formattedAddress: 'Fixture saved address', gps_timestamp: 1790712000000,
  weather: { tempF: 0, conditions: 'Clear' }, air: { aqi: 0, category: 'Good' } };
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => ({
  token: 'fixture-token', user: { userId: 'fixture-owner' }, isAuthenticated: true, sessionId: 'fixture-session',
}) }));
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({
  run: null, loading: false, setup: { sessionId: 'fixture-session', ready: false, currentSnapshot: saved }, reviewSetup,
}) }));
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ subscribeBriefingReady: () => () => {} }));
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
const { useActiveEventsQuery } = await import('@/hooks/useBriefingQueries');
let location: ReturnType<typeof useLocation>;
const clients: QueryClient[] = [];
const previousGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
function Probe() { location = useLocation(); return null; }
function EventsProbe() { useActiveEventsQuery(saved.snapshot_id); return null; }
function mount(query = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const children = React.createElement(LocationProvider, null, React.createElement(Probe), query && React.createElement(EventsProbe));
  return render(React.createElement(QueryClientProvider, { client, children }));
}
async function tick() { await act(async () => { await jest.advanceTimersByTimeAsync(0); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T21:00:00Z'));
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'fixture-token'); reviewSetup.mockClear();
  window.dispatchEvent(new CustomEvent('vecto-auth-error'));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn() } });
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => { throw new Error('Unexpected synthetic request'); });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear());
  window.dispatchEvent(new CustomEvent('vecto-auth-error'));
  if (previousGeolocation) Object.defineProperty(navigator, 'geolocation', previousGeolocation);
  else Reflect.deleteProperty(navigator, 'geolocation');
  localStorage.clear(); jest.restoreAllMocks(); jest.useRealTimers();
});

test('a current ownership error holds context for manual refresh and removes its listener on unmount', async () => {
  const add = jest.spyOn(window, 'addEventListener');
  const remove = jest.spyOn(window, 'removeEventListener');
  const view = mount(); await tick();
  expect(location.contextReady).toBe(true);
  act(() => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: saved.snapshot_id } })); });
  expect(location.locationError?.code).toBe('snapshot_ownership_error');
  expect(location.contextReady).toBe(false);
  expect(location.currentCoords).toEqual({ latitude: saved.lat, longitude: saved.lng });
  expect(reviewSetup).not.toHaveBeenCalled();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  const listener = add.mock.calls.find(([name]) => name === 'snapshot-ownership-error')?.[1];
  expect(listener).toBeDefined();
  view.unmount();
  expect(remove).toHaveBeenCalledWith('snapshot-ownership-error', listener);
  act(() => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: saved.snapshot_id } })); });
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('an actual snapshot-not-found 404 dispatches its snapshot identity and holds generation without new GPS', async () => {
  const ownership = jest.fn(); window.addEventListener('snapshot-ownership-error', ownership);
  try {
    jest.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'snapshot_not_found' }) } as Response);
    mount(true); await tick();
    expect(ownership).toHaveBeenCalledTimes(1);
    expect((ownership.mock.calls[0][0] as CustomEvent).detail).toEqual({ snapshotId: saved.snapshot_id });
    expect(location.locationError?.code).toBe('snapshot_ownership_error'); expect(location.contextReady).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(API_ROUTES.BRIEFING.EVENTS_ACTIVE(saved.snapshot_id));
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(reviewSetup).not.toHaveBeenCalled();
  } finally { window.removeEventListener('snapshot-ownership-error', ownership); }
});

test('an unrelated snapshot error and a non-ownership 404 leave the saved context intact', async () => {
  const ownership = jest.fn(); window.addEventListener('snapshot-ownership-error', ownership);
  try {
    jest.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'briefing_not_generated' }) } as Response);
    mount(true); await tick();
    expect(ownership).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: 'unrelated-old-snapshot' } })); });
    expect(location.locationError).toBeNull(); expect(location.contextReady).toBe(true);
    expect(location.lastSnapshotId).toBe(saved.snapshot_id);
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(reviewSetup).not.toHaveBeenCalled();
  } finally { window.removeEventListener('snapshot-ownership-error', ownership); }
});
