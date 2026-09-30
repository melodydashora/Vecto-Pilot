// Header refresh is explicit. Saved data survives foreground/clock updates.
import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const toast = jest.fn();
const refreshGPS = jest.fn<() => Promise<string | null>>();
const continueRun = jest.fn<(id: string) => Promise<boolean>>();
let setup: any;
jest.unstable_mockModule('@/contexts/run-setup-context', () => ({ useRunSetup: () => setup }));
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
jest.unstable_mockModule('@/components/HamburgerMenu', () => ({ default: () => <span>Driver menu</span> }));
const { LocationContext } = await import('@/contexts/location-context-clean');
const { default: GlobalHeader } = await import('@/components/GlobalHeader');
let location: any;
let client: QueryClient;
const app = () => <QueryClientProvider client={client}><LocationContext.Provider value={location}>
  <GlobalHeader /><label>Saved earnings<input defaultValue="25" /></label><p>Previous Strategy history</p>
</LocationContext.Provider></QueryClientProvider>;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T18:00:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  location = { currentCoords: { latitude: 0, longitude: 0 }, city: 'Synthetic location', state: 'Fixture region',
    currentLocationString: 'Synthetic location, Fixture region', timeZone: 'UTC', isUpdating: false,
    lastUpdated: new Date().toISOString(), isLocationResolved: true, lastSnapshotId: null, refreshGPS,
    weather: null, airQuality: null, locationError: null };
  setup = { preferencesConfirmed: true, canContinue: true, continueWithSavedPreferences: continueRun };
  toast.mockReset(); refreshGPS.mockReset().mockResolvedValue('new-context'); continueRun.mockReset().mockResolvedValue(true);
  global.fetch = jest.fn<typeof fetch>(async () => { throw Error('Unexpected request'); });
});
afterEach(() => { cleanup(); client.clear(); jest.useRealTimers(); });
test('59 minutes and foreground return preserve location, earnings and history without automatic refresh', async () => {
  render(app()); fireEvent.change(screen.getByRole('textbox', { name: 'Saved earnings' }), { target: { value: '35' } });
  await act(async () => { jest.advanceTimersByTime(59 * 60_000); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.getByText('Synthetic location, Fixture region')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Saved earnings' })).toHaveValue('35');
  expect(screen.getByText('Previous Strategy history')).toBeVisible();
  expect(refreshGPS).not.toHaveBeenCalled(); expect(continueRun).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test('header refresh prepares context before starting Strategy and venues with confirmed preferences', async () => {
  let complete!: (id: string) => void;
  refreshGPS.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(app()); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(refreshGPS).toHaveBeenCalledTimes(1); expect(continueRun).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  await act(async () => { complete('fresh-context'); });
  expect(continueRun).toHaveBeenCalledWith('fresh-context');
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refreshing Strategy' }));
});
test('preferences being edited hold only Strategy after a manual header refresh', async () => {
  setup.preferencesConfirmed = false; setup.canContinue = false;
  render(app()); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(refreshGPS).toHaveBeenCalledTimes(1); expect(continueRun).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Location and Briefing refreshed' }));
  expect(screen.getByText('Previous Strategy history')).toBeVisible();
});
test('failed context preparation cannot start Strategy and keeps previous data available', async () => {
  refreshGPS.mockResolvedValue(null); render(app());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(continueRun).not.toHaveBeenCalled();
  expect(screen.getByText('Synthetic location, Fixture region')).toBeVisible();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refresh unfinished' }));
});
test('a location failure remains local and leaves earnings/history available', () => {
  location.locationError = { code: 'context_preparation_failed', message: 'Fresh context is incomplete.' };
  render(app()); expect(screen.getByRole('alert')).toHaveTextContent('Fresh context is incomplete.');
  expect(screen.getByRole('textbox', { name: 'Saved earnings' })).toBeVisible();
  expect(screen.getByText('Previous Strategy history')).toBeVisible(); expect(continueRun).not.toHaveBeenCalled();
});
test('rapid refresh clicks are throttled instead of duplicating the waterfall', async () => {
  render(app()); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(refreshGPS).toHaveBeenCalledTimes(1); expect(continueRun).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Please wait' }));
});
