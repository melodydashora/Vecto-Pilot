// Real AuthProvider survives real Settings route remounts. Deferred HTTP models
// server commit order without opening a gateway, database or provider connection.
import { jest } from '@jest/globals';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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

function account(id = 'alice', token = `synthetic-${id}`): AuthApiResponse {
  return { token, sessionId: `session-${id}`, settingsRevision: 1, user: { userId: id, email: `${id}@example.invalid` },
    profile: { id: `profile-${id}`, userId: id, firstName: id, lastName: 'Driver', nickname: `${id} saved`,
      email: `${id}@example.invalid`, phone: '5555555555', address1: '1 Synthetic Lane', city: 'Synthetic City',
      stateTerritory: 'TX', country: 'US', market: 'Synthetic Market', ridesharePlatforms: ['uber', 'private', 'legacy-service'],
      settingsRevision: 1, selectedServices: ['economy'], eligEconomy: true, eligXl: false, eligXxl: false, eligComfort: false, eligLuxurySedan: false, eligLuxurySuv: false,
      attrElectric: false, attrGreen: false, attrWav: false, attrSki: false, attrCarSeat: false,
      prefPetFriendly: false, prefTeen: false, prefAssist: false, prefShared: false,
      marketingOptIn: false, termsAccepted: true, emailVerified: true, phoneVerified: false, profileComplete: true },
    vehicle: { id: `vehicle-${id}`, driverProfileId: `profile-${id}`, year: 2020, make: 'Synthetic', model: 'Car', seatbelts: 4, isPrimary: true } };
}
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Pending = { init: RequestInit; reply: ReturnType<typeof deferred<Response>>; resolved: boolean };
const writes: Pending[] = [];
const reads: Pending[] = [];
const unexpected: string[] = [];
let durable: AuthApiResponse;
let auth: ReturnType<typeof useAuth>;
let client: QueryClient;
let activeWrites = 0;
let maxActiveWrites = 0;
let holdReads = false;
const originalFetch = globalThis.fetch;
const originalClone = globalThis.structuredClone;
function Probe() { auth = useAuth(); return <span data-testid="current-user">{auth.user?.userId ?? 'signed-out'}</span>; }
async function mount(completeLogin = true) {
  render(<QueryClientProvider client={client}><AuthProvider><Probe /><MemoryRouter initialEntries={['/settings']}>
    <Link to="/away">Leave Settings</Link><Link to="/settings">Open Settings</Link>
    <Routes><Route path="/settings" element={<SettingsPage />} /><Route path="/away" element={<p>Another page</p>} /></Routes>
  </MemoryRouter></AuthProvider></QueryClientProvider>);
  if (completeLogin) {
    act(() => auth.completeLogin(durable));
    await screen.findByRole('textbox', { name: 'Nickname' });
  }
}
async function save(nickname: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: nickname } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await act(async () => { await Promise.resolve(); });
}
async function remount() {
  fireEvent.click(screen.getByRole('link', { name: 'Leave Settings' }));
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Open Settings' }));
  await screen.findByRole('textbox', { name: 'Nickname' });
}
async function settle(index: number, status = 200, commit = true) {
  const pending = writes[index];
  if (pending.resolved) return;
  pending.resolved = true; activeWrites -= 1;
  if (commit && status === 200) {
    const payload = JSON.parse(pending.init.body as string);
    const settingsRevision = (durable.settingsRevision || 1) + 1;
    durable = { ...durable, settingsRevision, profile: { ...durable.profile!, settingsRevision, nickname: payload.nickname } };
  }
  await act(async () => { pending.reply.resolve(response(status === 200 ? { ...durable, ok: true } : { error: 'Synthetic rejection' }, status)); });
}
beforeEach(() => {
  writes.length = 0; reads.length = 0; unexpected.length = 0; activeWrites = 0; maxActiveWrites = 0; holdReads = false;
  durable = account(); mockToast.mockClear(); mockNavigate.mockClear(); mockFinishSave.mockClear(); localStorage.clear(); sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === API_ROUTES.AUTH.PROFILE) {
      const pending = { init: init!, reply: deferred<Response>(), resolved: false };
      writes.push(pending); activeWrites += 1; maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      return pending.reply.promise;
    }
    if (url === API_ROUTES.AUTH.ME) {
      if (!holdReads) return response(structuredClone(durable));
      const pending = { init: init!, reply: deferred<Response>(), resolved: false };
      reads.push(pending);
      return pending.reply.promise;
    }
    if (url === API_ROUTES.AUTH.LOGOUT) return response({ ok: true });
    if (url === API_ROUTES.PLATFORM.COUNTRIES_DROPDOWN) return response({ countries: [{ value: 'US', label: 'United States' }] });
    if (url === API_ROUTES.PLATFORM.REGIONS_DROPDOWN('US')) return response({ regions: [{ value: 'TX', label: 'Texas' }] });
    if (url === API_ROUTES.VEHICLE.YEARS) return response({ years: [2020] });
    if (url.startsWith(API_ROUTES.INTELLIGENCE.MARKETS_DROPDOWN)) return response({ markets: ['Synthetic Market'] });
    unexpected.push(url); throw new Error(`Unexpected mutation-admission request: ${url}`);
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => { [...writes, ...reads].forEach(pending => pending.reply.resolve(response({ error: 'Fixture cleanup' }, 503))); });
  client.clear(); localStorage.clear(); sessionStorage.clear(); jest.restoreAllMocks();
  globalThis.fetch = originalFetch; globalThis.structuredClone = originalClone;
  expect(unexpected).toEqual([]);
});

test('a remounted Settings editor cannot overlap and roll back its earlier same-account write', async () => {
  await mount(); await save('Save A');
  await waitFor(() => expect(writes).toHaveLength(1));
  await remount(); await save('Save B');
  await waitFor(() => expect(writes.length === 2 || mockToast.mock.calls.some(([toast]) => toast.title === 'Error')).toBe(true));

  if (writes.length === 2) {
    // Before the provider guard, both real editors have admitted a PUT. Model
    // the valid server ordering B then A: both the durable value and UI regress.
    await settle(1); await settle(0);
  } else {
    expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error', description: expect.stringMatching(/save.*progress|save.*pending|save.*finish/i) }));
    expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Save B');
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    await settle(0);
    expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Save B');
    await save('Save B');
    await waitFor(() => expect(writes).toHaveLength(2));
    await settle(1);
  }

  expect({ durable: durable.profile?.nickname, displayed: screen.getByRole('textbox', { name: 'Nickname' }).getAttribute('value') })
    .toEqual({ durable: 'Save B', displayed: 'Save B' });
  expect(maxActiveWrites).toBe(1);
  expect(auth.profile?.nickname).toBe('Save B');
});

test('same-user token rollover keeps a pending write admitted once and ignores its stale 401', async () => {
  await mount(); await save('Old session save');
  await waitFor(() => expect(writes).toHaveLength(1));
  durable = { ...durable, token: 'synthetic-alice-new-session' };
  act(() => auth.completeLogin(durable));
  await remount(); await save('New session draft');
  await waitFor(() => expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error' })));
  expect(writes).toHaveLength(1);
  await settle(0, 401, false);
  expect(auth.isAuthenticated).toBe(true);
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-alice-new-session');
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('New session draft');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  await save('New session draft');
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].init.headers).toMatchObject({ Authorization: 'Bearer synthetic-alice-new-session' });
  await settle(1);
  expect(auth.profile?.nickname).toBe('New session draft');
  expect(maxActiveWrites).toBe(1);
});

test('admission spans canonical response parsing and old same-user completion cannot alter the replacement session', async () => {
  await mount(); await save('Old save');
  await waitFor(() => expect(writes).toHaveLength(1));
  const parsed = deferred<AuthApiResponse>();
  writes[0].resolved = true; activeWrites -= 1;
  await act(async () => { writes[0].reply.resolve({ ...response({}), json: () => parsed.promise }); });
  durable = { ...durable, token: 'synthetic-alice-refreshed' };
  act(() => auth.completeLogin(durable));
  await remount(); await save('After canonical response');
  await waitFor(() => expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error' })));
  expect(writes).toHaveLength(1);
  await act(async () => { parsed.resolve(account()); });
  expect(auth.isAuthenticated).toBe(true);
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-alice-refreshed');
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('After canonical response');
  await save('After canonical response');
  await waitFor(() => expect(writes).toHaveLength(2));
  await settle(1);
  expect(auth.profile?.nickname).toBe('After canonical response');
  expect(reads).toHaveLength(0);
});

test('a different owner may save while old completion cannot release the new owner’s pending admission', async () => {
  await mount(); await save('Alice pending');
  await waitFor(() => expect(writes).toHaveLength(1));
  durable = account('bob');
  act(() => auth.completeLogin(durable));
  await save('Bob pending');
  await waitFor(() => expect(writes).toHaveLength(2));
  await settle(0, 401, false);
  await remount(); await save('Bob next');
  await waitFor(() => expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error' })));
  expect(writes).toHaveLength(2);
  expect(auth.user?.userId).toBe('bob');
  await settle(1);
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Bob next');
  await save('Bob next');
  await waitFor(() => expect(writes).toHaveLength(3));
  await settle(2);
  expect(auth.profile?.nickname).toBe('Bob next');
  expect(durable.profile?.nickname).toBe('Bob next');
});

test('a rejected current PUT ends sign-in and releases mutation admission for the next login', async () => {
  await mount(); await save('Current save');
  await waitFor(() => expect(writes).toHaveLength(1));
  await settle(0, 401, false);
  expect(mockFinishSave).not.toHaveBeenCalled();
  expect(auth.isAuthenticated).toBe(false);
  expect(screen.getByTestId('current-user')).toHaveTextContent('signed-out');
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).not.toBeInTheDocument();
  expect(screen.getByText('Please sign in to access your settings.')).toBeInTheDocument();
  durable = { ...durable, token: 'synthetic-alice-relogin' };
  act(() => auth.completeLogin(durable));
  await save('After sign-in');
  await waitFor(() => expect(writes).toHaveLength(2));
  await settle(1);
  expect(auth.profile?.nickname).toBe('After sign-in');
  expect(auth.isAuthenticated).toBe(true);
  expect(maxActiveWrites).toBe(1);
});

test('a failed PUT releases admission and preserves the draft for an explicit retry', async () => {
  await mount(); await save('Retry draft');
  await waitFor(() => expect(writes).toHaveLength(1));
  await settle(0, 503, false);
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Retry draft');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  await save('Retry draft');
  await waitFor(() => expect(writes).toHaveLength(2));
  await settle(1);
  expect(auth.profile?.nickname).toBe('Retry draft');
  expect(maxActiveWrites).toBe(1);
});

test.each(['503', 'malformed JSON', 'different owner', 'inconsistent owner', 'missing profile', 'different vehicle owner', 'missing revision'])('PUT with %s canonical response preserves sign-in/draft and stays held', async outcome => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await mount(); await save('Submitted save');
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Newer unsaved draft' } });
  let failedResponse: Response;
  if (outcome === '503') failedResponse = response({ error: 'Synthetic unavailable' }, 503);
  else if (outcome === 'malformed JSON') failedResponse = { ...response({}), json: async () => { throw new SyntaxError('Synthetic invalid JSON'); } };
  else if (outcome === 'different owner') failedResponse = response(account('bob'));
  else if (outcome === 'inconsistent owner') failedResponse = response({ ...account(), user: account('bob').user });
  else if (outcome === 'different vehicle owner') failedResponse = response({ ...account(), vehicle: account('bob').vehicle });
  else if (outcome === 'missing revision') failedResponse = response({ ...account(), settingsRevision: undefined });
  else failedResponse = response({ user: account().user });
  writes[0].resolved = true; activeWrites -= 1;
  await act(async () => { writes[0].reply.resolve(failedResponse); });

  expect(auth.isAuthenticated).toBe(true);
  expect(auth.user?.userId).toBe('alice');
  expect(auth.profile?.userId).toBe('alice');
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-alice');
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Newer unsaved draft');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Error' }));
  expect(auth.profile?.nickname).toBe('alice saved');
  expect(mockFinishSave).not.toHaveBeenCalled();
  expect(reads).toHaveLength(0);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test.each(['valid', 'inconsistent owner', '503'])('initial profile bootstrap handles %s without publishing an unverified identity', async outcome => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-alice');
  holdReads = true;
  await mount(false);
  await waitFor(() => expect(reads).toHaveLength(1));
  const body = outcome === 'inconsistent owner' ? { ...account(), profile: account('bob').profile } : account();
  await act(async () => { reads[0].reply.resolve(response(body, outcome === '503' ? 503 : 200)); });
  expect(auth.isLoading).toBe(false);
  expect(auth.isAuthenticated).toBe(outcome === 'valid');
  expect(auth.user?.userId).toBe(outcome === 'valid' ? 'alice' : undefined);
  expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-alice');
});
