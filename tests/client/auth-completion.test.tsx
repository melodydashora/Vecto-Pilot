// Synthetic fixtures only: no credentials, gateway, provider calls, or database access.
import React, { StrictMode } from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
import { STORAGE_KEYS, SESSION_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { AuthApiResponse } from '@/types/auth';

const closeAllSSE = jest.fn();
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ closeAllSSE }));
const { AuthProvider, useAuth } = await import('@/contexts/auth-context');
const { GoogleCallbackPage } = await import('@/pages/auth/google/Callback');
const { default: ProtectedRoute } = await import('@/components/auth/ProtectedRoute');
const { default: AuthRedirect } = await import('@/components/auth/AuthRedirect');
const { default: SignInPage } = await import('@/pages/auth/SignInPage');
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
const { RunSetupProvider } = await import('@/contexts/run-setup-context');
const { queryClient: unusedClient } = await import('@/lib/queryClient');

const fixture = (id: string): AuthApiResponse => ({ token: `synthetic-${id}`, user: { userId: id, email: `${id}@example.invalid` } });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return <span data-testid="identity">{auth.isAuthenticated ? auth.user?.userId : 'signed-out'}</span>;
}
const clients: QueryClient[] = [];
function mount(callback = false, strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const tree = <QueryClientProvider client={client}><AuthProvider><Probe />
    {callback && <MemoryRouter initialEntries={['/callback?code=fixture-code&state=fixture-state']}>
      <Routes>
        <Route path="/callback" element={<GoogleCallbackPage />} />
        <Route path="/co-pilot/strategy" element={<ProtectedRoute><p>Protected strategy fixture</p></ProtectedRoute>} />
        <Route path="/auth/sign-in" element={<p>Sign in fixture</p>} />
      </Routes>
    </MemoryRouter>}
  </AuthProvider></QueryClientProvider>;
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return client;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  jest.useFakeTimers();
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => { throw new Error('Unexpected synthetic request'); });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  closeAllSSE.mockClear();
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(c => c.clear()); unusedClient.clear();
  jest.restoreAllMocks(); jest.useRealTimers();
});

describe('VP-002 shared login completion', () => {
  it('publishes password identity and removes stale session data', async () => {
    const client = mount();
    client.setQueryData(['private'], 'account-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'old');
    localStorage.setItem(STORAGE_KEYS.PERSISTENT_STRATEGY, 'old');
    jest.mocked(fetch).mockResolvedValue(response(fixture('B')));
    await act(async () => { expect(await auth.login({ email: 'B@example.invalid', password: 'synthetic-only' })).toEqual({ success: true }); });
    expect(screen.getByTestId('identity')).toHaveTextContent('B');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PERSISTENT_STRATEGY)).toBeNull();
    expect(client.getQueryData(['private'])).toBeUndefined();
  });
  it('enters a protected route after Google login without reload; exchanges once in StrictMode', async () => {
    jest.mocked(fetch).mockResolvedValue(response(fixture('google')));
    mount(true, true); await flush();
    expect(screen.getByTestId('identity')).toHaveTextContent('google');
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.getByText('Protected strategy fixture')).toBeInTheDocument();
  });
  it('keeps new users signed out through failed terms, then completes on explicit retry', async () => {
    const canonical = { ...fixture('new'), sessionId: 'new-session', settingsRevision: 1,
      profile: { id: 'new-profile', userId: 'new', termsAccepted: false } };
    jest.mocked(fetch).mockResolvedValueOnce(response({ ...fixture('new'), isNewUser: true }))
      .mockResolvedValueOnce(response(canonical)).mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response(canonical)).mockResolvedValueOnce(response({ ...canonical, settingsRevision: 2,
        profile: { ...canonical.profile, termsAccepted: true } }));
    mount(true); await flush();
    expect(auth.isAuthenticated).toBe(false);
    // Existing token-before-terms policy is deliberately retained.
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-new');
    expect(screen.getByRole('button', { name: 'Accept & Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept & Continue' })); await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save terms');
    expect(auth.isAuthenticated).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Accept & Continue' })); await flush();
    expect(auth.user?.userId).toBe('new');
    expect(fetch).toHaveBeenLastCalledWith(API_ROUTES.AUTH.PROFILE, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-new' }), body: JSON.stringify({ termsAccepted: true, expectedSettingsRevision: 1 }),
    }));
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.getByText('Protected strategy fixture')).toBeInTheDocument();
  });
  it.each(['ACCOUNT_CONFLICT', 'ACCOUNT_EXISTS'])('shows %s without retry or authenticating', async error => {
    jest.mocked(fetch).mockResolvedValue(response({ error }, 409));
    mount(true, true); await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(/account/i);
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(fetch).toHaveBeenCalledTimes(1); expect(auth.isAuthenticated).toBe(false);
  });
  it('shows the existing-session warning after Google sign-in without retrying or storing a token', async () => {
    const message = 'You already have an active session. Log out of that session before starting a new one.';
    jest.mocked(fetch).mockResolvedValue(response({ error: 'session_already_active', message }, 409));
    mount(true, true); await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    await act(async () => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });
  it('holds the password-revocation notice until Continue', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ ...fixture('google'), passwordRevoked: true }));
    mount(true); await flush();
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByRole('status')).toHaveTextContent('Your old password was disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Protected strategy fixture')).toBeInTheDocument();
  });
  it('retains recovery for an ambiguous successful exchange missing its token', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ user: fixture('bad').user }));
    mount(true); await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm your sign-in');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(auth.isAuthenticated).toBe(false);
  });
});

describe('VP-006 provided cache and auth transition races', () => {
  it('holds and clears the old account when another tab changes the token, then hydrates the new owner', async () => {
    const client = mount();
    act(() => auth.completeLogin(fixture('A')));
    client.setQueryData(['private'], 'account-A');
    const pending = deferred<Response>();
    jest.mocked(fetch).mockReturnValue(pending.promise);
    act(() => {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-B');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.AUTH_TOKEN,
        oldValue: 'synthetic-A', newValue: 'synthetic-B', storageArea: localStorage }));
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.user).toBeNull();
    expect(client.getQueryData(['private'])).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
    await act(async () => { pending.resolve(response({ ...fixture('B'),
      profile: { id: 'profile-B', userId: 'B' }, sessionId: 'session-B' })); });
    expect(auth.user?.userId).toBe('B');
    expect(auth.isAuthenticated).toBe(true);
  });
  it('cross-tab logout clears identity and fences a pending profile read', async () => {
    const client = mount();
    act(() => auth.completeLogin(fixture('A')));
    client.setQueryData(['private'], 'account-A');
    const pending = deferred<Response>();
    jest.mocked(fetch).mockReturnValue(pending.promise);
    let refreshing!: Promise<void>;
    act(() => { refreshing = auth.refreshProfile(); });
    act(() => {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.AUTH_TOKEN,
        oldValue: 'synthetic-A', newValue: null, storageArea: localStorage }));
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(client.getQueryData(['private'])).toBeUndefined();
    await act(async () => { pending.resolve(response({ ...fixture('A'), profile: { id: 'profile-A', userId: 'A' } })); await refreshing; });
    expect(auth.user).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });
  it.each(['logout', 'auth-error'])('%s clears the provided cache before server completion; late A query cannot replace B', async mode => {
    const client = mount();
    act(() => auth.completeLogin(fixture('A')));
    const late = deferred<string>(); const logoutReply = deferred<Response>();
    unusedClient.setQueryData(['sentinel'], 'untouched');
    client.setQueryData(['private'], 'A');
    const query = client.fetchQuery({ queryKey: ['late'], queryFn: () => late.promise }).catch(() => undefined);
    jest.mocked(fetch).mockReturnValue(logoutReply.promise);
    let exiting: Promise<void> | undefined;
    act(() => {
      if (mode === 'logout') exiting = auth.logout();
      else window.dispatchEvent(new CustomEvent('vecto-auth-error'));
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(closeAllSSE).toHaveBeenCalled();
    expect(unusedClient.getQueryData(['sentinel'])).toBe('untouched');
    act(() => auth.completeLogin(fixture('B')));
    client.setQueryData(['late'], 'B');
    await act(async () => { late.resolve('A'); logoutReply.resolve(response({})); await query; await exiting; });
    expect(auth.user?.userId).toBe('B');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
    expect(client.getQueryData(['late'])).toBe('B');
  });
  it.each([200, 401])('ignores a late account-A /me response (%s) after account B signs in', async status => {
    const late = deferred<Response>();
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    jest.mocked(fetch).mockReturnValue(late.promise);
    mount();
    act(() => auth.completeLogin(fixture('B')));
    await act(async () => { late.resolve(response(fixture('A'), status)); });
    expect(auth.user?.userId).toBe('B');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
  });
  it('does not reauthenticate a password login that resolves after logout', async () => {
    const late = deferred<Response>(); mount();
    jest.mocked(fetch).mockImplementation(url => url === API_ROUTES.AUTH.LOGIN_RECOVERY_CANCEL
      ? Promise.resolve(response({ ok: true })) : late.promise);
    let login!: ReturnType<typeof auth.login>;
    act(() => { login = auth.login({ email: 'A@example.invalid', password: 'synthetic-only' }); });
    await act(async () => { await auth.logout(); });
    await act(async () => { late.resolve(response(fixture('A'))); expect((await login).success).toBe(false); });
    expect(auth.isAuthenticated).toBe(false);
  });
  it('a signed-out location refresh preserves unrelated cached work and sends no private requests', async () => {
    let location!: ReturnType<typeof useLocation>;
    function LocationProbe() { location = useLocation(); return null; }
    const client = new QueryClient(); clients.push(client);
    render(<QueryClientProvider client={client}><AuthProvider><RunSetupProvider><LocationProvider><LocationProbe /></LocationProvider></RunSetupProvider></AuthProvider></QueryClientProvider>);
    client.setQueryData(['private'], 'old'); unusedClient.setQueryData(['sentinel'], 'untouched');
    await act(async () => { await location.refreshGPS(); });
    expect(client.getQueryData(['private'])).toBe('old');
    expect(unusedClient.getQueryData(['sentinel'])).toBe('untouched');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('returning to a saved session', () => {
  function mountSavedRoute(home = false) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(client);
    render(<QueryClientProvider client={client}><AuthProvider><Probe />
      <MemoryRouter initialEntries={[home ? '/' : '/co-pilot/strategy']}><Routes>
        <Route path="/" element={<AuthRedirect />} />
        <Route path="/co-pilot/strategy" element={<ProtectedRoute><p>Saved Strategy fixture</p></ProtectedRoute>} />
        <Route path="/auth/sign-in" element={<p>Sign in fixture</p>} />
      </Routes></MemoryRouter>
    </AuthProvider></QueryClientProvider>);
    return client;
  }
  const savedIdentity = { ...fixture('A'), sessionId: 'session-A',
    profile: { id: 'profile-A', userId: 'A' } };

  it.each([false, true])('keeps a saved token during temporary verification failure and retries the same session (home=%s)', async home => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'same-snapshot');
    localStorage.setItem(STORAGE_KEYS.PERSISTENT_STRATEGY, 'same-strategy');
    jest.mocked(fetch).mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(savedIdentity));
    mountSavedRoute(home); await flush();
    expect(screen.queryByText('Sign in fixture')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved Strategy fixture')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/connection/i);
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-A');
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBe('same-snapshot');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Saved Strategy fixture')).toBeInTheDocument();
    expect(auth.sessionId).toBe('session-A');
    expect(localStorage.getItem(STORAGE_KEYS.PERSISTENT_STRATEGY)).toBe('same-strategy');
    expect(closeAllSSE).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of jest.mocked(fetch).mock.calls) {
      expect(url).toBe(API_ROUTES.AUTH.ME);
      expect(options?.headers).toEqual({ Authorization: 'Bearer synthetic-A' });
    }
  });

  it('rechecks an interrupted initial session on foreground return, without sending login or logout', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Synthetic offline connection'))
      .mockResolvedValueOnce(response(savedIdentity));
    mountSavedRoute(); await flush();
    expect(screen.queryByText('Sign in fixture')).not.toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByText('Saved Strategy fixture')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps mounted identity and data after a quick pickup, even when a profile readback temporarily fails', async () => {
    const client = mount();
    act(() => auth.completeLogin(savedIdentity as AuthApiResponse));
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'same-snapshot');
    client.setQueryData(['private'], 'same-data');
    jest.mocked(fetch).mockResolvedValue(response({}, 503));
    await act(async () => { jest.advanceTimersByTime(59 * 60 * 1000); });
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await auth.refreshProfile(); });
    expect(auth.user?.userId).toBe('A');
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.sessionId).toBe('session-A');
    expect(client.getQueryData(['private'])).toBe('same-data');
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBe('same-snapshot');
  });

  it('a rejected saved session still clears its data and requires sign-in', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'old-snapshot');
    jest.mocked(fetch).mockResolvedValue(response({ error: 'session_expired' }, 401));
    mountSavedRoute(); await flush();
    expect(screen.getByText('Sign in fixture')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBeNull();
  });

  it('ignores an old retry failure after a different owner logs in', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    const retry = deferred<Response>();
    jest.mocked(fetch).mockResolvedValueOnce(response({}, 503)).mockReturnValueOnce(retry.promise);
    const client = mountSavedRoute(); await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    act(() => auth.completeLogin({ ...fixture('B'), sessionId: 'session-B' }));
    client.setQueryData(['private'], 'B-data');
    await act(async () => { retry.resolve(response({ error: 'session_expired' }, 401)); });
    expect(screen.getByText('Saved Strategy fixture')).toBeInTheDocument();
    expect(auth.user?.userId).toBe('B');
    expect(client.getQueryData(['private'])).toBe('B-data');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
  });
});

describe('sign-in entry preserves existing sessions', () => {
  function mountSignIn() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(client);
    render(<QueryClientProvider client={client}><AuthProvider><Probe />
      <MemoryRouter initialEntries={['/auth/sign-in']}><Routes>
        <Route path="/auth/sign-in" element={<SignInPage />} />
        <Route path="/co-pilot/strategy" element={<ProtectedRoute><p>Existing Strategy fixture</p></ProtectedRoute>} />
      </Routes></MemoryRouter>
    </AuthProvider></QueryClientProvider>);
  }

  it('retries a saved session instead of offering a replacement login after a temporary check failure', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'same-snapshot');
    localStorage.setItem(STORAGE_KEYS.PERSISTENT_STRATEGY, 'same-strategy');
    jest.mocked(fetch).mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({
      ...fixture('A'), sessionId: 'session-A', profile: { id: 'profile-A', userId: 'A' },
    }));
    mountSignIn(); await flush();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/check your saved session/i);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Existing Strategy fixture')).toBeInTheDocument();
    expect(auth.sessionId).toBe('session-A');
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBe('same-snapshot');
    expect(localStorage.getItem(STORAGE_KEYS.PERSISTENT_STRATEGY)).toBe('same-strategy');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(fetch).mock.calls.every(([url]) => url === API_ROUTES.AUTH.ME)).toBe(true);
    expect(closeAllSSE).not.toHaveBeenCalled();
  });

  it('shows a second-session refusal in the password form without authenticating or automatically retrying', async () => {
    const message = 'You already have an active session. Log out of that session before starting a new one.';
    jest.mocked(fetch).mockResolvedValue(response({ error: 'session_already_active', message }, 409));
    mountSignIn(); await flush();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'driver@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-only' } });
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!); });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    await act(async () => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });
});
