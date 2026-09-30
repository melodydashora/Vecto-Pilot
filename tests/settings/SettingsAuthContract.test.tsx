// 2026-09-11: real SettingsPage + AuthProvider + query cache; synthetic HTTP only.
// Only unrelated debug flags and toast display are fixtures.
import { jest } from '@jest/globals';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { AuthApiResponse } from '@/types/auth';

const mockToast = jest.fn();
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ ...jest.requireActual('react-router-dom') as object, useNavigate: () => mockNavigate }));
const mockFinishSave = jest.fn(async () => true);
jest.mock('@/contexts/run-setup-context', () => ({ useRunSetup: () => {
  const { useAuth } = jest.requireActual('@/contexts/auth-context') as typeof import('@/contexts/auth-context');
  const auth = useAuth();
  return { setup: auth.profile ? { profile: auth.profile, vehicle: auth.vehicle, settingsRevision: auth.profile.settingsRevision } : null,
    getEditorDraft: () => null, setEditorDraft: () => {}, draftResetVersion: 0, loading: false, beginSave: () => () => {}, finishSave: mockFinishSave };
} }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/components/settings/UberSettingsSection', () => ({ UberSettingsSection: () => <div>Connection fixture</div> }));
jest.mock('@/constants/featureFlags', () => ({ COACH_STREAMING_TTS_ENABLED: true,
  DEBUG_MAP_ENABLED: false, DEBUG_VENUES_ENABLED: false, DEBUG_SSE_ENABLED: false, DEBUG_BLOCKS_ENABLED: false }));
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import SettingsPage from '@/pages/co-pilot/SettingsPage';

function account(id = 'alice'): AuthApiResponse {
  return {
    token: `synthetic-${id}`, sessionId: `session-${id}`, settingsRevision: 1, user: { userId: id, email: `${id}@example.invalid` },
    profile: { id: `profile-${id}`, userId: id, firstName: id, lastName: 'Driver', nickname: `${id} saved`,
      email: `${id}@example.invalid`, phone: '5555555555', address1: '1 Synthetic Lane', city: 'Synthetic City',
      stateTerritory: 'TX', country: 'US', market: 'Synthetic Market', ridesharePlatforms: ['uber', 'private', 'legacy-service'],
      settingsRevision: 1, selectedServices: ['economy'], eligEconomy: true, eligXl: false, eligXxl: false, eligComfort: false, eligLuxurySedan: false, eligLuxurySuv: false,
      attrElectric: false, attrGreen: false, attrWav: false, attrSki: false, attrCarSeat: false,
      prefPetFriendly: false, prefTeen: false, prefAssist: false, prefShared: false,
      marketingOptIn: false, termsAccepted: true, emailVerified: true, phoneVerified: false, profileComplete: true },
    vehicle: { id: `vehicle-${id}`, driverProfileId: `profile-${id}`, year: 2020, make: 'Synthetic', model: 'Car', seatbelts: 4, isPrimary: true },
  };
}
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
type Pending = { init: RequestInit; reply: ReturnType<typeof deferred<Response>> };
const writes: Pending[] = [], reads: Pending[] = [];
const marketWrites: RequestInit[] = [];
const unexpected: string[] = [];
let auth: ReturnType<typeof useAuth>;
let client: QueryClient;
const originalFetch = globalThis.fetch;
const originalClone = globalThis.structuredClone;
function Probe() { auth = useAuth(); return <span data-testid="current-user">{auth.user?.userId ?? 'signed-out'}</span>; }
async function mount(fixture = account()) {
  render(<QueryClientProvider client={client}><AuthProvider><Probe /><MemoryRouter><SettingsPage /></MemoryRouter></AuthProvider></QueryClientProvider>);
  act(() => auth.completeLogin(fixture));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue(fixture.profile!.nickname));
}
async function saveNickname(nickname = 'Submitted nickname') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: nickname } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(writes).toHaveLength(1));
}
beforeEach(() => {
  writes.length = 0; reads.length = 0; marketWrites.length = 0; unexpected.length = 0;
  mockToast.mockClear(); mockNavigate.mockClear(); mockFinishSave.mockClear(); localStorage.clear(); sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === API_ROUTES.AUTH.PROFILE || url === API_ROUTES.AUTH.ME) {
      const pending = { init: init!, reply: deferred<Response>() };
      (url === API_ROUTES.AUTH.PROFILE ? writes : reads).push(pending);
      return pending.reply.promise;
    }
    if (url === API_ROUTES.INTELLIGENCE.ADD_MARKET) {
      marketWrites.push(init!);
      return (init?.headers as Record<string, string>).Authorization === 'Bearer synthetic-alice'
        ? response({ success: true, market_name: 'Synthetic New Market' }) : response({ error: 'Unauthorized' }, 401);
    }
    if (url === API_ROUTES.AUTH.LOGOUT) return response({ ok: true });
    if (url === API_ROUTES.PLATFORM.COUNTRIES_DROPDOWN) return response({ countries: [{ value: 'US', label: 'United States' }] });
    if (url === API_ROUTES.PLATFORM.REGIONS_DROPDOWN('US')) return response({ regions: [{ value: 'TX', label: 'Texas' }] });
    if (url === API_ROUTES.VEHICLE.YEARS) return response({ years: [2020] });
    if (url.startsWith(API_ROUTES.INTELLIGENCE.MARKETS_DROPDOWN)) return response({ markets: ['Synthetic Market'] });
    unexpected.push(url); throw new Error(`Unexpected Settings contract request: ${url}`);
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => { [...writes, ...reads].forEach(pending => pending.reply.resolve(response({ error: 'Fixture cleanup' }, 503))); });
  client.clear(); localStorage.clear(); sessionStorage.clear(); jest.restoreAllMocks();
  globalThis.fetch = originalFetch; globalThis.structuredClone = originalClone;
  expect(unexpected).toEqual([]);
});

test('real AuthProvider saves with its current token and adopts canonical profile/vehicle values', async () => {
  await mount(); await saveNickname();
  expect(writes[0].init).toMatchObject({ method: 'PUT', headers: { Authorization: 'Bearer synthetic-alice' } });
  expect(JSON.parse(writes[0].init.body as string)).toMatchObject({ nickname: 'Submitted nickname',
    ridesharePlatforms: ['uber', 'private', 'legacy-service'], eligEconomy: true, selectedServices: ['economy'], expectedSettingsRevision: 1,
    vehicle: { year: 2020, make: 'Synthetic', model: 'Car', seatbelts: 4 } });
  const confirmed = account(); confirmed.profile!.nickname = 'Canonical nickname'; confirmed.profile!.phone = '+15555555555';
  confirmed.settingsRevision = 2; confirmed.profile!.settingsRevision = 2;
  confirmed.vehicle!.make = 'Canonical make';
  await act(async () => { writes[0].reply.resolve(response({ ...confirmed, ok: true })); });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Canonical nickname'));
  expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveValue('+15555555555');
  expect(screen.getByText(/No unsaved changes/)).toBeInTheDocument();
  expect(auth.vehicle?.make).toBe('Canonical make');
  expect(reads).toHaveLength(0);
  expect(mockFinishSave).toHaveBeenCalledWith();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Settings saved' }));
});

test.each([200, 401])('a late account-A PUT (%s) cannot change B or announce A completion', async status => {
  await mount(); await saveNickname('Private Alice draft');
  act(() => auth.completeLogin(account('bob')));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Private Bob draft' } });
  await act(async () => {
    writes[0].reply.resolve(response({ ...account(), ok: true }, status));
  });
  expect(auth.user?.userId).toBe('bob');
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-bob');
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Private Bob draft');
  expect(screen.queryByDisplayValue('Private Alice draft')).not.toBeInTheDocument();
  expect(mockToast).not.toHaveBeenCalled();
  expect(reads).toHaveLength(0);
  expect(mockFinishSave).not.toHaveBeenCalled();
});

test('custom-market creation carries the authenticated identity required by its existing route', async () => {
  const fixture = account(); fixture.profile!.market = '__OTHER__';
  await mount(fixture);
  fireEvent.mouseDown(screen.getByRole('tab', { name: /^Location$/ }), { button: 0, ctrlKey: false });
  fireEvent.change(screen.getByRole('textbox', { name: 'Custom market name' }), { target: { value: 'Synthetic New Market' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(marketWrites).toHaveLength(1));
  expect(marketWrites[0].headers).toMatchObject({ Authorization: 'Bearer synthetic-alice' });
});

test('a held pre-save refresh cannot erase the submitted draft when PUT lacks canonical confirmation', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await mount(); await saveNickname();
  let background!: Promise<void>;
  act(() => { background = auth.refreshProfile(); });
  await waitFor(() => expect(reads).toHaveLength(1));
  const oldRefresh = account(); oldRefresh.profile!.phone = '5552223333';
  await act(async () => { reads[0].reply.resolve(response(oldRefresh)); await background; });
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Submitted nickname');
  await act(async () => { writes[0].reply.resolve(response({ success: true })); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save and review' })).toBeEnabled());
  expect(reads).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Submitted nickname');
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error', description: expect.stringContaining('could not be confirmed') }));
  expect(mockFinishSave).not.toHaveBeenCalled();
});

test.each([200, 401])('an older background profile read (%s) cannot supersede the canonical PUT response', async oldStatus => {
  await mount(); await saveNickname();
  let background!: Promise<void>;
  act(() => { background = auth.refreshProfile(); });
  await waitFor(() => expect(reads).toHaveLength(1));
  const confirmed = account(); confirmed.profile!.nickname = 'Submitted nickname';
  confirmed.settingsRevision = 2; confirmed.profile!.settingsRevision = 2;
  await act(async () => { writes[0].reply.resolve(response({ ...confirmed, ok: true })); });
  await waitFor(() => expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Settings saved' })));
  await act(async () => { reads[0].reply.resolve(response(account(), oldStatus)); await background; });
  expect(auth.user?.userId).toBe('alice');
  expect(auth.profile?.nickname).toBe('Submitted nickname');
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Submitted nickname');
  expect(reads).toHaveLength(1);
});
