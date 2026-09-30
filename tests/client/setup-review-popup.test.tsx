// Real setup/location providers, layout, dialog and both editor save handlers.
// Identity, dropdowns and saved transport are synthetic; no live GPS/API/database.
import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
import { DEFAULT_OFFER_RULESET_CONFIG } from '@/lib/offer-ruleset-schema';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { SavedSetup } from '@/contexts/run-setup-context';
import type { AuthApiResponse, DriverProfile } from '@/types/auth';

Object.assign(globalThis, { TextEncoder, TextDecoder, structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) });
// jsdom has no layout engine; retain the real Settings Radix controls.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const { MemoryRouter, Routes, Route, Link } = await import('react-router-dom');
let saved: SavedSetup;
let setupReadFails = false;
let rulesConflict = false;
let pendingRules: Promise<void> | null = null;
let pendingSetupRead: Promise<void> | null = null;
const toast = jest.fn();
const updateProfile = jest.fn<(data: Partial<DriverProfile>, revision: number) => Promise<{ success: boolean; confirmedProfile?: AuthApiResponse }>>();
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => ({
  user: { userId: 'popup-owner' }, token: 'popup-synthetic-token', isAuthenticated: true, isLoading: false,
  profile: saved.profile, vehicle: saved.vehicle, updateProfile,
}) }));
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({}) }));
jest.unstable_mockModule('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
jest.unstable_mockModule('@/components/GlobalHeader', () => ({ default: () => <p>Driver header</p> }));
jest.unstable_mockModule('@/components/ui/toaster', () => ({ Toaster: () => null }));
jest.unstable_mockModule('@/components/co-pilot/BottomTabNavigation', () => ({ BottomTabNavigation: () => <nav>
  <Link to="/co-pilot/offer-analyzer">Offer Analyzer history</Link><Link to="/co-pilot/strategy">Strategy history</Link>
</nav> }));
jest.unstable_mockModule('@/components/offer-analyzer/GatesCard', () => ({ default: ({ form }: { form: { register: (name: string, opts: object) => object } }) =>
  <label>Saved rider rating<input type="number" step="0.01" {...form.register('global.rating_floor', { valueAsNumber: true })} /></label> }));
for (const name of ['SetupCard', 'RateTargetsCard', 'DeliveryCard', 'LimitsCard', 'GeographyCard', 'VisionRulesCard']) {
  jest.unstable_mockModule(`@/components/offer-analyzer/${name}`, () => ({ default: () => null }));
}
jest.unstable_mockModule('@/components/offer-analyzer/OffersCard', () => ({ default: () => <p>Owned saved offers</p> }));
jest.unstable_mockModule('@/components/offer-analyzer/OffersDecisionChart', () => ({ default: () => <p>Owned saved earnings</p> }));

const { RunSetupProvider, useRunSetup } = await import('@/contexts/run-setup-context');
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
const { default: CoPilotLayout } = await import('@/layouts/CoPilotLayout');
const { default: SettingsPage } = await import('@/pages/co-pilot/SettingsPage');
const { default: OfferAnalyzerPage } = await import('@/pages/co-pilot/OfferAnalyzerPage');
let setup: ReturnType<typeof useRunSetup>;
function Probe() { setup = useRunSetup(); return null; }
function StrategyControls() {
  const location = useLocation();
  return <><p>Previous Strategy and map</p><button onClick={() => setup.reviewSetup()}>Review preferences</button>
    <button disabled={!setup.preferencesConfirmed || !setup.canContinue || !location.contextReady}
      onClick={() => void setup.continueWithSavedPreferences(location.lastSnapshotId!)}>Continue Strategy</button></>;
}
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
function app() {
  return <RunSetupProvider><LocationProvider><Probe /><MemoryRouter initialEntries={['/co-pilot/strategy']}><Routes>
    <Route path="/co-pilot" element={<CoPilotLayout />}>
      <Route path="strategy" element={<StrategyControls />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="offer-analyzer" element={<OfferAnalyzerPage />} />
    </Route>
  </Routes></MemoryRouter></LocationProvider></RunSetupProvider>;
}
async function review() {
  const popup = await screen.findByRole('dialog', { name: 'Ready for your session?' });
  await waitFor(() => expect(within(popup).getByRole('button', { name: 'Continue with Preference' })).toBeEnabled());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  return popup;
}
// Flush the action before querying the next UI state. Deferred saves remain
// pending until explicitly released; all real controls and assertions stay intact.
async function settledClick(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); });
}
async function edit(editor: 'preferences' | 'offerAnalyzer') {
  await settledClick(screen.getByRole('button', { name: 'Change Preferences for this session' }));
  await screen.findByRole('textbox', { name: 'Nickname' });
  if (editor === 'offerAnalyzer') await settledClick(screen.getByRole('link', { name: 'Offer Analyzer history' }));
}
async function startStrategy() {
  await settledClick(screen.getByRole('button', { name: 'Continue with Preference' }));
  expect(starts()).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue Strategy' })).toBeEnabled());
  await settledClick(screen.getByRole('button', { name: 'Continue Strategy' }));
}
const starts = () => jest.mocked(fetch).mock.calls.filter(([input]) => input === API_ROUTES.MAIN_RUNS.CONTINUE);
const assertHeld = () => { expect(starts()).toHaveLength(0); expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1); expect(setup.run).toBeNull(); };
beforeEach(() => {
  localStorage.clear(); toast.mockClear(); updateProfile.mockReset();
  setupReadFails = false; rulesConflict = false; pendingRules = null; pendingSetupRead = null;
  saved = { sessionId: 'popup-session', settingsRevision: 1, rulesVersion: 1, rulesHash: 'rules-1', ready: true,
    missingFields: [], currentRun: null, currentSnapshot: null, rules: structuredClone(DEFAULT_OFFER_RULESET_CONFIG),
    profile: { id: 'popup-profile', userId: 'popup-owner', firstName: 'Fixture', lastName: 'Driver', nickname: 'First nickname',
      phone: '5550000000', address1: 'Synthetic address', city: 'Fixture city', stateTerritory: 'FX', country: 'US', market: 'Fixture market',
      ridesharePlatforms: ['uber'], selectedServices: ['economy'], marketingOptIn: false } as SavedSetup['profile'],
    vehicle: { id: 'popup-vehicle', driverProfileId: 'popup-profile', year: 2024, make: 'Fixture', model: 'Car', seatbelts: 4, isPrimary: true } };
  updateProfile.mockImplementation(async (data, revision) => {
    expect(revision).toBe(saved.settingsRevision);
    saved = { ...saved, settingsRevision: saved.settingsRevision! + 1, profile: { ...saved.profile, ...data } };
    return { success: true, confirmedProfile: { user: { userId: 'popup-owner' } as AuthApiResponse['user'], profile: saved.profile, vehicle: saved.vehicle ?? undefined,
      sessionId: saved.sessionId, settingsRevision: saved.settingsRevision } };
  });
  let uuid = 0;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn((success: (position: unknown) => void) => success({ coords: { latitude: 0, longitude: 0, accuracy: 10 }, timestamp: Date.now() })) } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  global.fetch = jest.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === API_ROUTES.MAIN_RUNS.SETUP) { if (pendingSetupRead) await pendingSetupRead; return setupReadFails ? response({ message: 'Readback unavailable' }, 503) : response(saved); }
    if (url === API_ROUTES.LOCATION.SNAPSHOT) {
      const body = JSON.parse(String(init?.body));
      expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(starts()).toHaveLength(0);
      const snapshot = { snapshot_id: body.captureId, user_id: 'popup-owner', sessionId: saved.sessionId,
        status: 'ok', ready: true, briefingReady: true, lat: body.lat, lng: body.lng, gps_timestamp: body.gps_timestamp,
        accuracy: body.accuracy, city: 'Fixture city', state: 'FX', country: 'US', timeZone: 'UTC',
        formattedAddress: 'Synthetic current location', weather: { tempF: 70, conditions: 'Clear' }, air: { aqi: 20, category: 'Good' } };
      saved = { ...saved, currentSnapshot: snapshot as SavedSetup['currentSnapshot'] };
      return response(snapshot);
    }
    if (url === API_ROUTES.LOCATION.NEWS_BRIEFING) return response({ success: true, complete: true });
    if (url === API_ROUTES.MAIN_RUNS.CONTINUE) {
      const body = JSON.parse(String(init?.body));
      const run = { runId: 'popup-run', snapshotId: 'popup-strategy-copy', sourceSnapshotId: body.expectedSnapshotId,
        sessionId: saved.sessionId, settingsRevision: saved.settingsRevision!, rulesVersion: saved.rulesVersion!,
        rulesHash: saved.rulesHash!, status: 'queued', current: true };
      saved = { ...saved, currentRun: run };
      return response(run);
    }
    if (url === API_ROUTES.OFFER_ANALYZER.RULES) {
      if (init?.method === 'PUT') {
        if (pendingRules) await pendingRules;
        if (rulesConflict) return response({ message: 'Rules changed' }, 409);
        const { config } = JSON.parse(String(init.body));
        saved = { ...saved, rules: config, rulesVersion: saved.rulesVersion! + 1, rulesHash: `rules-${saved.rulesVersion! + 1}` };
      }
      return response({ config: saved.rules, version: saved.rulesVersion, is_default: false });
    }
    if (url === API_ROUTES.PLATFORM.COUNTRIES_DROPDOWN) return response({ countries: [{ value: 'US', label: 'United States' }] });
    if (url.startsWith('/api/platform/regions-dropdown')) return response({ regions: [] });
    if (url.startsWith(API_ROUTES.INTELLIGENCE.MARKETS_DROPDOWN)) return response({ markets: [] });
    if (url === API_ROUTES.VEHICLE.YEARS) return response({ years: [2024] });
    throw new Error(`Unexpected synthetic request ${url}`);
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('both real editors repeatedly save into one shared popup; dismissal preserves hold and location comes first and component Continue alone starts Strategy', async () => {
  render(app());
  await review(); assertHeld();
  await edit('preferences');
  fireEvent.change(await screen.findByRole('textbox', { name: 'Nickname' }), { target: { value: 'Saved nickname' } });
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  await review(); expect(updateProfile).toHaveBeenCalledTimes(1); assertHeld();
  await edit('offerAnalyzer');
  fireEvent.change(await screen.findByRole('spinbutton', { name: 'Saved rider rating' }), { target: { value: '4.95' } });
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  const popup = await review(); expect(popup).not.toHaveTextContent('4.95'); expect(saved.rules.global.rating_floor).toBe(4.95); assertHeld();
  await edit('preferences');
  expect(await screen.findByRole('textbox', { name: 'Nickname' })).toHaveValue('Saved nickname');
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  await review(); expect(updateProfile).toHaveBeenCalledTimes(2); assertHeld();
  await settledClick(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); assertHeld();
  await settledClick(screen.getByRole('link', { name: 'Offer Analyzer history' }));
  expect(await screen.findByRole('spinbutton', { name: 'Saved rider rating' })).toHaveValue(4.95); assertHeld();
  await act(async () => { setup.reviewSetup(); });
  await review();
  await startStrategy();
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(starts()).toHaveLength(1);
  expect(JSON.parse(String(starts()[0][1]?.body))).toMatchObject({ expectedSettingsRevision: 3, expectedRulesVersion: 2, expectedRulesHash: 'rules-2' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each(['conflict', 'readback'])('%s keeps editor draft and disables Continue until saved state is confirmed', async mode => {
  render(app()); await review();
  await edit('offerAnalyzer');
  const rating = await screen.findByRole('spinbutton', { name: 'Saved rider rating' });
  fireEvent.change(rating, { target: { value: '4.94' } });
  rulesConflict = mode === 'conflict'; setupReadFails = mode === 'readback';
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(setup.saveUnconfirmed && !setup.saving).toBe(true));
  expect(rating).toHaveValue(4.94); expect(setup.canContinue).toBe(false); assertHeld();
  await act(async () => { expect(await setup.continueWithSavedPreferences(saved.currentSnapshot!.snapshot_id)).toBe(false); });
  act(() => setup.reviewSetup());
  const popup = await screen.findByRole('dialog');
  await waitFor(() => expect(setup.loading).toBe(false));
  expect(within(popup).getByRole('button', { name: 'Continue with Preference' })).toBeDisabled(); assertHeld();
  if (mode === 'readback') {
    setupReadFails = false;
    await act(async () => { await setup.reload(); });
    await review(); assertHeld();
  }
});

test('an outstanding save disables all popup choices until canonical readback finishes', async () => {
  render(app()); await review();
  await edit('offerAnalyzer');
  await screen.findByRole('spinbutton', { name: 'Saved rider rating' });
  let finish!: () => void;
  pendingRules = new Promise<void>(resolve => { finish = resolve; });
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(setup.saving).toBe(true));
  act(() => setup.reviewSetup());
  const popup = await screen.findByRole('dialog');
  for (const name of ['Continue with Preference', 'Change Preferences for this session']) {
    expect(within(popup).getByRole('button', { name })).toBeDisabled();
  }
  assertHeld();
  await act(async () => { finish(); });
  await review(); assertHeld();
});


test.each([
  ['preferences', 'response'], ['preferences', 'readback'],
  ['offerAnalyzer', 'response'], ['offerAnalyzer', 'readback'],
])('%s preserves newer typing through delayed %s and navigation until explicit save or discard', async (editor, phase) => {
  render(app()); await review();
  const preferences = editor === 'preferences';
  await edit(preferences ? 'preferences' : 'offerAnalyzer');
  const field = preferences ? await screen.findByRole('textbox', { name: 'Nickname' })
    : await screen.findByRole('spinbutton', { name: 'Saved rider rating' });
  const first = preferences ? 'Saved A' : '4.91';
  const newer = preferences ? 'Newer B' : '4.97';
  fireEvent.change(field, { target: { value: first } });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  if (phase === 'readback') pendingSetupRead = pending;
  else if (preferences) {
    const commit = updateProfile.getMockImplementation()!;
    updateProfile.mockImplementationOnce(async (...args) => { await pending; return commit(...args); });
  } else pendingRules = pending;
  await settledClick(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(setup.saving && (phase !== 'readback' || setup.loading)).toBe(true));
  fireEvent.change(field, { target: { value: newer } });
  await act(async () => { release(); });
  const popup = await screen.findByRole('dialog');
  await waitFor(() => expect(setup.saving).toBe(false));
  expect(field).toHaveValue(preferences ? newer : Number(newer));
  expect(within(popup).getByRole('button', { name: 'Continue with Preference' })).toBeDisabled();
  await act(async () => { expect(await setup.continueWithSavedPreferences(saved.currentSnapshot!.snapshot_id)).toBe(false); });
  assertHeld();
  await edit(preferences ? 'offerAnalyzer' : 'preferences');
  await screen.findByRole(preferences ? 'spinbutton' : 'textbox', { name: preferences ? 'Saved rider rating' : 'Nickname' });
  act(() => setup.reviewSetup());
  const returnPopup = await screen.findByRole('dialog');
  expect(within(returnPopup).getByRole('button', { name: 'Continue with Preference' })).toBeDisabled();
  await edit(preferences ? 'preferences' : 'offerAnalyzer');
  const restored = preferences ? await screen.findByRole('textbox', { name: 'Nickname' })
    : await screen.findByRole('spinbutton', { name: 'Saved rider rating' });
  expect(restored).toHaveValue(preferences ? newer : Number(newer));
  assertHeld();
  if (phase === 'response') {
    await settledClick(screen.getByRole('button', { name: 'Save and review' }));
    await review();
    expect(preferences ? saved.profile!.nickname : saved.rules.global.rating_floor).toBe(preferences ? newer : Number(newer));
  } else {
    await settledClick(screen.getByRole('button', { name: 'Discard changes and review preferences' }));
    await review();
    expect(preferences ? saved.profile!.nickname : saved.rules.global.rating_floor).toBe(preferences ? first : Number(first));
    await edit(preferences ? 'preferences' : 'offerAnalyzer');
    const discarded = preferences ? await screen.findByRole('textbox', { name: 'Nickname' })
      : await screen.findByRole('spinbutton', { name: 'Saved rider rating' });
    expect(discarded).toHaveValue(preferences ? first : Number(first));
    await act(async () => { setup.reviewSetup(); });
    await review();
  }
  assertHeld();
  await startStrategy();
  await waitFor(() => expect(starts()).toHaveLength(1));
});


test('incomplete saved setup still requests location first and leaves history accessible', async () => {
  saved = { ...saved, ready: false, missingFields: ['offerRules'] };
  render(app());
  const popup = await screen.findByRole('dialog', { name: 'Ready for your session?' });
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(within(popup).getByRole('button', { name: 'Continue with Preference' })).toBeDisabled();
  expect(within(popup).getByRole('button', { name: 'Change Preferences for this session' })).toBeEnabled();
  expect(within(popup).queryByText('Fixture Car')).not.toBeInTheDocument();
  await settledClick(within(popup).getByRole('button', { name: 'Close' }));
  await settledClick(screen.getByRole('link', { name: 'Offer Analyzer history' }));
  expect(await screen.findByText('Owned saved offers')).toBeVisible();
  assertHeld();
});
