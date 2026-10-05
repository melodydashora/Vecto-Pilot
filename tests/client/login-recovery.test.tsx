// Synthetic storage/network fixtures only. Proofs below never authorize real accounts.
import React, { StrictMode } from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextEncoder, TextDecoder } from 'node:util';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';
import { createLoginAttempt, listLoginAttempts, readLoginAttempt, cancelLoginAttempt,
  removeLoginAttempt, saveLoginSessionOwner } from '@/lib/login-recovery';
import type { AuthApiResponse } from '@/types/auth';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
jest.unstable_mockModule('@/utils/co-pilot-helpers', () => ({ closeAllSSE: jest.fn() }));
const { AuthProvider, useAuth } = await import('@/contexts/auth-context');
const { default: SignInPage } = await import('@/pages/auth/SignInPage');
const { GoogleCallbackPage } = await import('@/pages/auth/google/Callback');
const response = (status = 200, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const fixture = (id = 'A') => ({ token: `synthetic-${id}`, sessionId: `session-${id}`, settingsRevision: 1,
  user: { userId: id, email: `${id}@example.invalid` }, profile: { id: `profile-${id}`, userId: id, termsAccepted: true } }) as AuthApiResponse;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let auth: ReturnType<typeof useAuth>;
function Probe() { auth = useAuth(); return null; }
const clients: QueryClient[] = [];
function mount(entry = '/auth/sign-in', strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const tree = <QueryClientProvider client={client}><AuthProvider><Probe /><MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/auth/sign-in" element={<SignInPage />} />
    <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
    <Route path="/co-pilot/strategy" element={<p>Authenticated Strategy</p>} />
  </Routes></MemoryRouter></AuthProvider></QueryClientProvider>;
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  jest.useFakeTimers();
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => { throw new Error('Unexpected synthetic request'); });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach(client => client.clear());
  jest.restoreAllMocks(); jest.useRealTimers();
});

describe('recovering the exact committed login', () => {
  it.each(['network', 'server', 'malformed'])('persists proof before password POST and recovers a %s loss without sending the password again', async failure => {
    let sentProof = '';
    jest.mocked(fetch).mockImplementationOnce(async (url, options) => {
      expect(url).toBe(API_ROUTES.AUTH.LOGIN);
      const body = JSON.parse(options!.body as string);
      sentProof = body.recoveryProof;
      expect(sentProof).toMatch(/^[a-f0-9]{64}$/);
      expect(listLoginAttempts().map(attempt => attempt.proof)).toContain(sentProof);
      expect(JSON.stringify(listLoginAttempts())).not.toContain('synthetic-password');
      if (failure === 'network') throw new TypeError('Synthetic response lost after commit');
      if (failure === 'malformed') return { ...response(), json: async () => { throw new SyntaxError('Synthetic truncated JSON'); } };
      return response(503);
    });
    mount(); await flush();
    await act(async () => { expect((await auth.login({ email: 'A@example.invalid', password: 'synthetic-password' })).success).toBe(false); });
    expect(auth.pendingLoginCount).toBe(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture()));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(auth.sessionId).toBe('session-A');
    expect(auth.isAuthenticated).toBe(true);
    expect(listLoginAttempts()).toHaveLength(0);
    const [url, options] = jest.mocked(fetch).mock.calls[1];
    expect(url).toBe(API_ROUTES.AUTH.LOGIN_RECOVERY);
    expect(JSON.parse(options!.body as string)).toEqual({ recoveryProof: sentProof });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains an unknown/processing attempt over reload, then recovers without issuing a new login', async () => {
    const attempt = createLoginAttempt('password');
    const first = mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(202, { pending: true }));
    await act(async () => { await auth.recoverLogin(); });
    expect(readLoginAttempt(attempt.id)?.proof).toBe(attempt.proof);
    first.unmount();
    mount(); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.pendingLoginCount).toBe(1);
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture()));
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.isAuthenticated).toBe(true);
    expect(jest.mocked(fetch).mock.calls.every(([url]) => url === API_ROUTES.AUTH.LOGIN_RECOVERY)).toBe(true);
  });

  it('an expired attempt clears only its own durable record and permits a fresh sign-in', async () => {
    createLoginAttempt('password'); mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(410, { message: 'This sign-in expired.' }));
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.pendingLoginCount).toBe(0);
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });

  it('storage failure stops before submitting credentials or the Google code', async () => {
    mount(); await flush();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Synthetic full storage', 'QuotaExceededError'); });
    await act(async () => {
      expect((await auth.login({ email: 'A@example.invalid', password: 'synthetic-only' })).success).toBe(false);
      expect((await auth.loginWithGoogle('synthetic-code', 'synthetic-state')).success).toBe(false);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancel intent survives network failure and reload and never switches back to recovery', async () => {
    const attempt = createLoginAttempt('password');
    const first = mount(); await flush();
    jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Synthetic offline cancellation'));
    await act(async () => { await auth.cancelPendingLogin(); });
    expect(readLoginAttempt(attempt.id)?.intent).toBe('cancel');
    first.unmount(); mount(); await flush();
    expect(screen.getByText('Finish cancelling sign-in')).toBeInTheDocument();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(listLoginAttempts()).toHaveLength(0);
    expect(jest.mocked(fetch).mock.calls.every(([url]) => url === API_ROUTES.AUTH.LOGIN_RECOVERY_CANCEL)).toBe(true);
  });

  it('cancelling an in-flight original login prevents its late successful response from reviving auth', async () => {
    const original = deferred<Response>();
    jest.mocked(fetch).mockImplementation(url => url === API_ROUTES.AUTH.LOGIN
      ? original.promise : Promise.resolve(response(200, { ok: true })));
    mount(); await flush();
    let login!: ReturnType<typeof auth.login>;
    act(() => { login = auth.login({ email: 'A@example.invalid', password: 'synthetic-only' }); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' })); });
    expect(listLoginAttempts()).toHaveLength(0);
    await act(async () => { original.resolve(response(200, fixture())); await login; });
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });

  it('a cancellation from another tab fences an already-produced successful recovery response', async () => {
    const attempt = createLoginAttempt('password');
    mount(); await flush();
    const pending = deferred<Response>();
    jest.mocked(fetch).mockReturnValue(pending.promise);
    let recovering!: Promise<void>;
    act(() => { recovering = auth.recoverLogin(); }); await flush();
    act(() => {
      cancelLoginAttempt(attempt);
      window.dispatchEvent(new StorageEvent('storage', { key: `${STORAGE_KEYS.LOGIN_RECOVERY_PREFIX}${attempt.id}`, storageArea: localStorage }));
    });
    await act(async () => { pending.resolve(response(200, fixture())); await recovering; });
    expect(auth.isAuthenticated).toBe(false);
    expect(readLoginAttempt(attempt.id)?.intent).toBe('cancel');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });

  it.each([false, true])('cancellation during token publication cannot revive auth (already confirmed=%s)', async confirmed => {
    const attempt = createLoginAttempt('password'); mount(); await flush();
    const realSet = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      realSet.call(this, key, value);
      if (key === STORAGE_KEYS.AUTH_TOKEN) {
        const cancelling = cancelLoginAttempt(attempt)!;
        if (confirmed) removeLoginAttempt(cancelling);
      }
    });
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture()));
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER)).toBeNull();
    expect(readLoginAttempt(attempt.id)?.intent ?? null).toBe(confirmed ? null : 'cancel');
  });

  it('completion cannot erase a cancel marker written while it retires the recovery record', async () => {
    const attempt = createLoginAttempt('password'); mount(); await flush();
    const realRemove = Storage.prototype.removeItem;
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function(key) {
      realRemove.call(this, key);
      if (key === `${STORAGE_KEYS.LOGIN_RECOVERY_PREFIX}${attempt.id}`) {
        cancelLoginAttempt(attempt);
        window.dispatchEvent(new StorageEvent('storage', { key: `${STORAGE_KEYS.LOGIN_CANCEL_PREFIX}${attempt.id}`, storageArea: localStorage }));
      }
    });
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture()));
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.isAuthenticated).toBe(false);
    expect(readLoginAttempt(attempt.id)?.intent).toBe('cancel');
    expect(listLoginAttempts()).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });

  it('a captured cancel action still cancels after another tab removes the base record', async () => {
    const attempt = createLoginAttempt('password'); mount(); await flush();
    removeLoginAttempt(attempt);
    jest.mocked(fetch).mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => { await auth.cancelPendingLogin(); });
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(API_ROUTES.AUTH.LOGIN_RECOVERY_CANCEL);
    expect(listLoginAttempts()).toHaveLength(0);
  });

  it('reload hides a published token whose exact attempt has pending cancellation', async () => {
    const attempt = createLoginAttempt('password');
    saveLoginSessionOwner(attempt, 'synthetic-A');
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A'); cancelLoginAttempt(attempt);
    mount(); await flush();
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Finish cancelling sign-in')).toBeInTheDocument();
  });

  it('confirmed logout removes the completed login owner credential', async () => {
    createLoginAttempt('password'); mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture())).mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => { await auth.recoverLogin(); });
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER)).not.toBeNull();
    await act(async () => { await auth.logout(); });
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBeNull();
  });

  it('confirmed logout retry removes an owner credential left by interrupted local teardown', async () => {
    const attempt = createLoginAttempt('password'); removeLoginAttempt(attempt);
    saveLoginSessionOwner(attempt, 'synthetic-A');
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-A');
    mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => { await auth.retryLogout(); });
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)).toBeNull();
  });

  it('independent pending keys survive simultaneous tab attempts and cancellation clears one at a time', async () => {
    const first = createLoginAttempt('password'), second = createLoginAttempt('google', 'synthetic-state');
    expect(first.proof).not.toBe(second.proof);
    mount(); await flush();
    expect(auth.pendingLoginCount).toBe(2);
    const oldest = listLoginAttempts()[0];
    jest.mocked(fetch).mockResolvedValue(response(200, { ok: true }));
    await act(async () => { await auth.cancelPendingLogin(); });
    expect(listLoginAttempts()).toHaveLength(1);
    expect(readLoginAttempt(oldest.id)).toBeNull();
    expect(auth.pendingLoginCount).toBe(1);
    await act(async () => { await auth.cancelPendingLogin(); });
    expect(listLoginAttempts()).toHaveLength(0);
  });

  it('finishes the remaining attempt before entering the app, without replacing a recovered account', async () => {
    createLoginAttempt('password'); createLoginAttempt('password');
    mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture('A')))
      .mockResolvedValueOnce(response(200, fixture('B')))
      .mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.user?.userId).toBe('A');
    expect(auth.pendingLoginCount).toBe(1);
    expect(screen.queryByText('Authenticated Strategy')).not.toBeInTheDocument();
    await act(async () => { await auth.recoverLogin(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Another sign-in is already active');
    expect(auth.user?.userId).toBe('A');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-A');
    await act(async () => { await auth.cancelPendingLogin(); });
    expect(screen.getByText('Authenticated Strategy')).toBeInTheDocument();
    expect(auth.user?.userId).toBe('A');
  });

  it('logout cancels an unresolved login and fences its late result', async () => {
    const original = deferred<Response>();
    jest.mocked(fetch).mockImplementation(url => url === API_ROUTES.AUTH.LOGIN ? original.promise : Promise.resolve(response(200, { ok: true })));
    mount(); await flush();
    let login!: ReturnType<typeof auth.login>;
    act(() => { login = auth.login({ email: 'A@example.invalid', password: 'synthetic-only' }); }); await flush();
    await act(async () => { await auth.logout(); });
    expect(jest.mocked(fetch).mock.calls.some(([url]) => url === API_ROUTES.AUTH.LOGIN_RECOVERY_CANCEL)).toBe(true);
    await act(async () => { original.resolve(response(200, fixture())); await login; });
    expect(auth.isAuthenticated).toBe(false);
    expect(listLoginAttempts()).toHaveLength(0);
  });

  it('pending logout takes priority over login recovery and cannot silently start it', async () => {
    createLoginAttempt('password');
    localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, 'synthetic-old');
    mount(); await flush();
    expect(screen.getByRole('button', { name: 'Finish signing out' })).toBeInTheDocument();
    await act(async () => { await auth.recoverLogin(); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a newer authenticated owner is not replaced by an older recovery response', async () => {
    createLoginAttempt('password'); mount(); await flush();
    const old = deferred<Response>(); jest.mocked(fetch).mockReturnValueOnce(old.promise);
    let recovering!: Promise<void>;
    act(() => { recovering = auth.recoverLogin(); }); await flush();
    act(() => auth.completeLogin(fixture('B')));
    await act(async () => { old.resolve(response(200, fixture('A'))); await recovering; });
    expect(auth.user?.userId).toBe('B');
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-B');
  });
});

describe('Google completion recovered without code replay', () => {
  it('rechecks a completed callback session after reload without replaying its consumed code', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    jest.mocked(fetch).mockResolvedValueOnce(response(200, fixture()));
    mount('/auth/google/callback?code=used-code&state=synthetic-state'); await flush();
    expect(screen.getByText('Authenticated Strategy')).toBeInTheDocument();
    expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([API_ROUTES.AUTH.ME]);
  });

  it.each(['/auth/sign-in', '/auth/google/callback?code=used-code&state=synthetic-state'])('resumes explicit unaccepted terms on reload at %s', async entry => {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
    jest.mocked(fetch).mockResolvedValueOnce(response(200, { ...fixture(), profile: { ...fixture().profile!, termsAccepted: false } }));
    mount(entry); await flush();
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-A');
    expect(screen.getByRole('button', { name: 'Accept & Continue' })).toBeDisabled();
    expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([API_ROUTES.AUTH.ME]);
  });

  it('a second tab requires explicit unaccepted terms before publishing private identity', async () => {
    mount(); await flush();
    jest.mocked(fetch).mockResolvedValueOnce(response(200, { ...fixture(), profile: { ...fixture().profile!, termsAccepted: false } }));
    await act(async () => {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'synthetic-A');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.AUTH_TOKEN, storageArea: localStorage }));
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(screen.getByRole('button', { name: 'Accept & Continue' })).toBeDisabled();
  });

  it.each(['cancel', 'expire'])('returns an interrupted callback to an actionable sign-in screen after %s', async ending => {
    jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Synthetic lost Google response'));
    mount('/auth/google/callback?code=used-code&state=synthetic-state'); await flush();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    jest.mocked(fetch).mockResolvedValueOnce(ending === 'cancel'
      ? response(200, { ok: true }) : response(410, { message: 'This sign-in expired.' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ending === 'cancel' ? 'Cancel sign-in' : 'Try again' })); });
    expect(screen.queryByText('Completing sign-in...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Sign In' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sign In' }));
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(jest.mocked(fetch).mock.calls.filter(([url]) => url === API_ROUTES.AUTH.GOOGLE_CALLBACK)).toHaveLength(1);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('reuses the saved proof on callback reload and shows the password-revocation notice', async () => {
    const attempt = createLoginAttempt('google', 'synthetic-state');
    jest.mocked(fetch).mockResolvedValue(response(200, { ...fixture(), passwordRevoked: true }));
    mount('/auth/google/callback?code=used-code&state=synthetic-state', true); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(API_ROUTES.AUTH.LOGIN_RECOVERY);
    expect(JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ recoveryProof: attempt.proof });
    expect(screen.getByRole('status')).toHaveTextContent('Your old password was disabled');
    expect(auth.isAuthenticated).toBe(true);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.queryByText('Authenticated Strategy')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Authenticated Strategy')).toBeInTheDocument();
  });

  it('recovers a new Google signup from the sign-in page and waits for verified explicit terms acceptance', async () => {
    createLoginAttempt('google', 'synthetic-state');
    const incoming = { ...fixture(), isNewUser: true, profile: { ...fixture().profile!, termsAccepted: false } };
    jest.mocked(fetch).mockResolvedValueOnce(response(200, incoming))
      .mockResolvedValueOnce(response(200, incoming))
      .mockResolvedValueOnce(response(200, { ...incoming, settingsRevision: 2, profile: { ...incoming.profile, termsAccepted: true } }));
    mount(); await flush();
    await act(async () => { await auth.recoverLogin(); });
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('synthetic-A');
    expect(screen.getByRole('button', { name: 'Accept & Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept & Continue' })); });
    expect(auth.isAuthenticated).toBe(true);
    expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      API_ROUTES.AUTH.LOGIN_RECOVERY, API_ROUTES.AUTH.ME, API_ROUTES.AUTH.PROFILE,
    ]);
  });
});
