// Synthetic auth/network fixtures. No gateway, real credentials or database.
import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextEncoder, TextDecoder } from 'node:util';
import { STORAGE_KEYS, SESSION_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { AuthApiResponse } from '@/types/auth';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const closeAllSSE = jest.fn();
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ closeAllSSE }));
const { AuthProvider, useAuth } = await import('@/contexts/auth-context');
const { default: SignInPage } = await import('@/pages/auth/SignInPage');

const fixture = (id: string): AuthApiResponse => ({ token: `synthetic-${id}`, user: { userId: id, email: `${id}@example.invalid` } });
const response = (status = 200, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
let auth: ReturnType<typeof useAuth>;
function Probe() { auth = useAuth(); return null; }
const clients: QueryClient[] = [];
function mount(signIn = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const view = render(<QueryClientProvider client={client}><AuthProvider><Probe />
    {signIn && <MemoryRouter initialEntries={['/auth/sign-in']}><Routes>
      <Route path="/auth/sign-in" element={<SignInPage />} />
      <Route path="/co-pilot/strategy" element={<p>Signed-in fixture</p>} />
    </Routes></MemoryRouter>}
  </AuthProvider></QueryClientProvider>);
  return { client, view };
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  jest.useFakeTimers();
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => { throw new Error('Unexpected synthetic request'); });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  closeAllSSE.mockClear();
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear());
  jest.restoreAllMocks(); jest.useRealTimers();
});

describe('logout delivery recovery', () => {
  it.each(['network', 'server'])('clears private state immediately after a %s failure, then retries before a new login', async failure => {
    const { client } = mount();
    act(() => auth.completeLogin(fixture('A')));
    client.setQueryData(['private'], 'account-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'private-snapshot');
    localStorage.setItem(STORAGE_KEYS.PERSISTENT_STRATEGY, 'private-strategy');
    if (failure === 'network') jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Synthetic offline'));
    else jest.mocked(fetch).mockResolvedValueOnce(response(503));
    let logout!: Promise<void>;
    act(() => { logout = auth.logout(); });
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.token).toBeNull();
    expect(client.getQueryData(['private'])).toBeUndefined();
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PERSISTENT_STRATEGY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBe('synthetic-A');
    await act(async () => { await logout; });
    expect(auth.hasPendingLogout).toBe(true);
    expect(auth.logoutError).toMatch(/could not finish signing out/i);
    await act(async () => {
      expect((await auth.login({ email: 'A@example.invalid', password: 'synthetic-only' })).success).toBe(false);
      jest.advanceTimersByTime(60000);
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    jest.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(response(200, fixture('B')));
    await act(async () => { await auth.retryLogout(); });
    expect(auth.hasPendingLogout).toBe(false);
    expect(auth.logoutError).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBeNull();
    expect(jest.mocked(fetch).mock.calls[1]).toEqual([API_ROUTES.AUTH.LOGOUT,
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer synthetic-A' } })]);
    await act(async () => { expect((await auth.login({ email: 'B@example.invalid', password: 'synthetic-only' })).success).toBe(true); });
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
  });

  it.each([200, 401])('restores pending logout after reload and exposes an explicit retry (HTTP %s)', async status => {
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
    mount(true); await flush();
    expect(auth.isAuthenticated).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('synthetic-A');
    jest.mocked(fetch).mockResolvedValue(response(status));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' })); });
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shows failure and deduplicates repeated retry while its request is pending', async () => {
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
    mount(true); await flush();
    const delayed = deferred<Response>();
    jest.mocked(fetch).mockReturnValue(delayed.promise);
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = auth.retryLogout(); second = auth.retryLogout(); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    await act(async () => { delayed.resolve(response(500)); await first; await second; });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not finish signing out/i);
    expect(screen.getByRole('button', { name: 'Finish signing out' })).toBeEnabled();
  });

  it('a timed-out logout can be explicitly retried without retaining active auth', async () => {
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
    mount();
    jest.mocked(fetch).mockImplementationOnce((_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')));
    }));
    let pending!: Promise<void>;
    act(() => { pending = auth.retryLogout(); });
    await flush();
    await act(async () => { jest.advanceTimersByTime(15000); await pending; });
    expect(auth.isLoggingOut).toBe(false);
    expect(auth.hasPendingLogout).toBe(true);
    expect(auth.logoutError).toMatch(/could not finish signing out/i);
    jest.mocked(fetch).mockResolvedValueOnce(response());
    await act(async () => { await auth.retryLogout(); });
    expect(auth.hasPendingLogout).toBe(false);
  });

  it('does not revive auth if reload interrupted local logout teardown', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
    sessionStorage.setItem(SESSION_KEYS.SNAPSHOT, 'old-private-snapshot');
    mount(); await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.hasPendingLogout).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEYS.SNAPSHOT)).toBeNull();
  });

  it.each([200, 503])('late logout A (%s) cannot clear a newer active identity or its private data', async status => {
    const { client } = mount();
    act(() => auth.completeLogin(fixture('A')));
    const old = deferred<Response>();
    jest.mocked(fetch).mockReturnValueOnce(old.promise);
    let exiting!: Promise<void>;
    act(() => { exiting = auth.logout(); });
    await flush();
    act(() => auth.completeLogin(fixture('B')));
    client.setQueryData(['private'], 'account-B');
    await act(async () => { old.resolve(response(status)); await exiting; });
    expect(auth.user?.userId).toBe('B');
    expect(auth.isAuthenticated).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
    expect(client.getQueryData(['private'])).toBe('account-B');
  });

  it.each([200, 503])('late logout A (%s) cannot clear the pending logout for B', async status => {
    mount(); act(() => auth.completeLogin(fixture('A')));
    const old = deferred<Response>(), newer = deferred<Response>();
    jest.mocked(fetch).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = auth.logout(); }); await flush();
    act(() => auth.completeLogin(fixture('B')));
    act(() => { second = auth.logout(); }); await flush();
    await act(async () => { old.resolve(response(status)); await first; });
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBe('synthetic-B');
    expect(auth.hasPendingLogout).toBe(true);
    expect(auth.isLoggingOut).toBe(true);
    expect(auth.logoutError).toBeNull();
    await act(async () => { newer.resolve(response()); await second; });
    expect(auth.hasPendingLogout).toBe(false);
  });

  it('another tab receives pending sign-out and successful completion without exposing a login early', async () => {
    mount(true); await flush();
    act(() => {
      localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.PENDING_LOGOUT_TOKEN,
        newValue: 'synthetic-A', storageArea: localStorage }));
    });
    expect(screen.getByRole('button', { name: 'Finish signing out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    act(() => {
      localStorage.removeItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.PENDING_LOGOUT_TOKEN,
        oldValue: 'synthetic-A', newValue: null, storageArea: localStorage }));
    });
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
