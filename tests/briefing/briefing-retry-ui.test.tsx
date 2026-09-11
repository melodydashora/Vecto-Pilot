/** @jest-environment jsdom */
import { jest, test, beforeEach, afterEach, expect } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

let strategyData, authenticated;
const queryClient = { resetQueries: jest.fn(), refetchQueries: jest.fn() };
jest.unstable_mockModule('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useQuery: options => ({ data: options.queryKey[0] === '/api/blocks/strategy' && strategyData ? Object.assign(strategyData, { snapshotId: strategyData._snapshotId, _sessionRevision: options.queryKey[3] }) : null, refetch: jest.fn() }),
}));
const refreshGPS = jest.fn(async () => {
  window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));
});
const location = { lastSnapshotId: 'test-snapshot', refreshGPS };
jest.unstable_mockModule('../../client/src/contexts/location-context-clean.tsx', () => ({ useLocation: () => location }));
jest.unstable_mockModule('../../client/src/contexts/auth-context.tsx', () => ({ useAuth: () => ({ isAuthenticated: authenticated, user: { userId: 'synthetic-driver' }, token: 'synthetic-token' }) }));
jest.unstable_mockModule('../../client/src/utils/co-pilot-helpers.ts', () => ({
  getAuthHeader: () => ({}), subscribeStrategyReady: () => () => {}, subscribeBlocksReady: () => () => {}, subscribePhaseChange: () => () => {},
}));
jest.unstable_mockModule('../../client/src/hooks/useEnrichmentProgress.ts', () => ({ useEnrichmentProgress: () => ({ progress: 0, strategyProgress: 0, phase: 'strategy', pipelinePhase: 'analyzing' }) }));
jest.unstable_mockModule('../../client/src/hooks/useBriefingQueries.ts', () => ({ useBriefingQueries: () => ({ isLoading: {} }) }));
jest.unstable_mockModule('../../client/src/hooks/useBarsQuery.ts', () => ({ useBarsQuery: () => ({}) }));
const { CoPilotProvider } = await import('../../client/src/contexts/co-pilot-context');
const app = () => React.createElement(CoPilotProvider, null, React.createElement('p', null, 'Dashboard content'));

beforeEach(() => {
  authenticated = true; strategyData = null;
  localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks();
});
afterEach(cleanup);

test('a current Briefing failure replaces dashboard with reason and starts a fresh snapshot on retry', async () => {
  strategyData = { _snapshotId: 'test-snapshot', status: 'error', error: 'briefing_failed', message: 'weather_forecast: The data provider timed out.' };
  render(app());
  expect(screen.getByRole('alert').textContent).toContain('Briefing Could Not Be Completed');
  expect(screen.getByRole('alert').textContent).toContain('weather_forecast: The data provider timed out.');
  expect(screen.queryByText('Dashboard content')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try Again' })); });
  expect(refreshGPS).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Dashboard content')).toBeTruthy();
});

test('pending work keeps dashboard mounted', () => {
  strategyData = { _snapshotId: 'test-snapshot', status: 'pending' };
  render(app());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Dashboard content')).toBeTruthy();
});

test('a late failure for an old snapshot does not replace the current dashboard', () => {
  strategyData = { _snapshotId: 'old-snapshot', status: 'error', error: 'briefing_failed', message: 'Old failure' };
  render(app());
  expect(screen.queryByRole('alert')).toBeNull();
});

test('logout clears the blocking screen without reviving the old snapshot error', () => {
  strategyData = { _snapshotId: 'test-snapshot', status: 'error', error: 'briefing_failed', message: 'news: Provider unavailable' };
  const view = render(app());
  expect(screen.getByRole('alert')).toBeTruthy();
  authenticated = false;
  view.rerender(app());
  expect(screen.queryByRole('alert')).toBeNull();
});
