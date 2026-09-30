// Real header + setup/location providers, synthetic persisted session and GPS.
import React from 'react';
import { jest, test, expect, afterEach } from '@jest/globals';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ROUTES } from '@/constants/apiRoutes';
let saved: any;
const toast = jest.fn();
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => ({
  user: { userId: 'header-owner' }, token: 'header-fixture', sessionId: 'header-session', isAuthenticated: true,
}) }));
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
jest.unstable_mockModule('@/components/HamburgerMenu', () => ({ default: () => <span>Menu</span> }));
const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
const { default: GlobalHeader } = await import('@/components/GlobalHeader');
let setup: ReturnType<typeof useRunSetup>;
let location: ReturnType<typeof useLocation>;
function Probe() { setup = useRunSetup(); location = useLocation(); return <GlobalHeader />; }
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) }) as Response;
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
test('one explicit header refresh restores first, then collects context and admits Strategy after canonical readback', async () => {
  const sessionId = 'header-session';
  const snapshot = (id: string) => ({ snapshot_id: id, sourceSnapshotId: id, user_id: 'header-owner', sessionId,
    status: 'ok', ready: true, briefingReady: true, lat: 33.12345678, lng: -96.87654321,
    gps_timestamp: Date.now(), city: 'Fixture', state: 'FX', country: 'US', timeZone: 'America/Chicago',
    formattedAddress: 'Fixture location', weather: { tempF: 70, conditions: 'Clear' }, air: { aqi: 20, category: 'Good' } });
  saved = { sessionId, settingsRevision: 1, rulesVersion: 1, rulesHash: 'a'.repeat(64), ready: true, missingFields: [],
    profile: { id: 'fixture-profile', userId: 'header-owner' }, vehicle: null, rules: {},
    currentSnapshot: snapshot('original-source'), currentRun: { runId: 'old-run', snapshotId: 'old-copy',
      sourceSnapshotId: 'original-source', sessionId, settingsRevision: 1, rulesVersion: 1, rulesHash: 'a'.repeat(64), status: 'complete' } };
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn((success: PositionCallback) =>
    success({ coords: { latitude: 33.12345678, longitude: -96.87654321, accuracy: 10 }, timestamp: Date.now() } as GeolocationPosition)) } });
  global.fetch = jest.fn<typeof fetch>(async (input, init) => {
    if (input === API_ROUTES.MAIN_RUNS.SETUP) return response(saved);
    if (input === API_ROUTES.LOCATION.SNAPSHOT) { const data = JSON.parse(String(init?.body)); saved.currentSnapshot = snapshot(data.captureId); return response(saved.currentSnapshot); }
    if (input === API_ROUTES.LOCATION.NEWS_BRIEFING) return response({ success: true, complete: true });
    if (input === API_ROUTES.MAIN_RUNS.CONTINUE) {
      const data = JSON.parse(String(init?.body));
      expect(data.expectedSnapshotId).toBe(saved.currentSnapshot.snapshot_id);
      expect(data.expectedRunId).toBe('old-run');
      saved.currentRun = { ...saved.currentRun, runId: 'new-run', snapshotId: 'new-copy', sourceSnapshotId: data.expectedSnapshotId, status: 'running', current: true };
      return response(saved.currentRun);
    }
    throw Error('Unexpected header fixture request');
  });
  const started = jest.fn(); window.addEventListener('vecto-strategy-started', started);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(<QueryClientProvider client={client}><RunSetupProvider><LocationProvider><Probe /></LocationProvider></RunSetupProvider></QueryClientProvider>);
    await waitFor(() => expect(location.contextReady && setup.preferencesConfirmed).toBe(true));
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'Refresh' }).click(); });
    await waitFor(() => expect(setup.run?.runId).toBe('new-run'));
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
    expect((started.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ runId: 'new-run', snapshotId: 'new-copy', sourceSnapshotId: saved.currentSnapshot.snapshot_id });
    expect(jest.mocked(fetch).mock.calls.filter(([url]) => url === API_ROUTES.MAIN_RUNS.CONTINUE)).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refreshing Strategy' }));
  } finally { window.removeEventListener('vecto-strategy-started', started); client.clear(); }
});
