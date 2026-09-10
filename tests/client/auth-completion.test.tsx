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
const { LocationProvider, useLocation } = await import('@/contexts/location-context-clean');
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
    jest.mocked(fetch).mockResolvedValueOnce(response({ ...fixture('new'), isNewUser: true }))
      .mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response({ ok: true }));
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
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-new' }), body: JSON.stringify({ termsAccepted: true }),
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
  it('holds the password-revocation notice until Continue', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ ...fixture('google'), passwordRevoked: true }));
    mount(true); await flush();
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByRole('status')).toHaveTextContent('Your old password was disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Protected strategy fixture')).toBeInTheDocument();
  });
  it('rejects a successful exchange missing its token', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ user: fixture('bad').user }));
    mount(true); await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('No token received');
    expect(auth.isAuthenticated).toBe(false);
  });
});

describe('VP-006 provided cache and auth transition races', () => {
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
    jest.mocked(fetch).mockReturnValue(late.promise);
    let login!: ReturnType<typeof auth.login>;
    act(() => { login = auth.login({ email: 'A@example.invalid', password: 'synthetic-only' }); });
    await act(async () => { await auth.logout(); });
    await act(async () => { late.resolve(response(fixture('A'))); expect((await login).success).toBe(false); });
    expect(auth.isAuthenticated).toBe(false);
  });
  it('manual GPS refresh clears the provided cache (synthetic denied GPS; no live requests)', async () => {
    let location!: ReturnType<typeof useLocation>;
    function LocationProbe() { location = useLocation(); return null; }
    const client = new QueryClient(); clients.push(client);
    render(<QueryClientProvider client={client}><AuthProvider><LocationProvider><LocationProbe /></LocationProvider></AuthProvider></QueryClientProvider>);
    client.setQueryData(['private'], 'old'); unusedClient.setQueryData(['sentinel'], 'untouched');
    await act(async () => { await location.refreshGPS(); });
    expect(client.getQueryData(['private'])).toBeUndefined();
    expect(unusedClient.getQueryData(['sentinel'])).toBe('untouched');
    expect(fetch).not.toHaveBeenCalled();
  });
});
