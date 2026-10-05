// client/src/contexts/auth-context.tsx
// Authentication context for user login, registration, and session management

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  DriverProfile,
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';
// 2026-01-09: P1-6 FIX - Use centralized storage keys
import { STORAGE_KEYS, SESSION_KEYS } from '@/constants/storageKeys';
// 2026-01-15: Centralized API routes
import { API_ROUTES } from '@/constants/apiRoutes';
// 2026-09-10: Clear the client actually provided by App (VP-006).
import { useQueryClient } from '@tanstack/react-query';
// 2026-04-10: Close SSE connections on logout to prevent orphaned EventSource connections
import { closeAllSSE } from '@/utils/co-pilot-helpers';
import { handleRequestAuthFailure } from '@/lib/session-auth';
import { cancelLoginAttempt, createLoginAttempt, listLoginAttempts, postLoginRequest,
  readLoginAttempt, removeLoginAttempt, saveLoginSessionOwner, clearLoginSessionOwner,
  isLoginSessionCancelled, type LoginAttempt } from '@/lib/login-recovery';

type GoogleAuthResponse = AuthApiResponse & { isNewUser?: boolean; passwordRevoked?: boolean };
type LoginResult = { success: boolean; error?: string; recoveryPending?: boolean };

interface AuthContextValue extends AuthState {
  completeLogin: (data: AuthApiResponse) => void;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPendingLogout: boolean;
  isLoggingOut: boolean;
  logoutError: string | null;
  retryLogout: () => Promise<void>;
  pendingLoginCount: number;
  loginRecoveryBusy: boolean;
  loginRecoveryError: string | null;
  loginCancellationPending: boolean;
  recoverLogin: () => Promise<void>;
  cancelPendingLogin: () => Promise<void>;
  loginWithGoogle: (code: string, oauthState: string) => Promise<LoginResult>;
  googleAuthResult: GoogleAuthResponse | null;
  dismissGoogleAuthResult: () => void;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<DriverProfile>, expectedSettingsRevision: number) => Promise<{
    success: boolean; error?: string; confirmedProfile?: AuthApiResponse; profileRefreshFailed?: boolean;
  }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Invalidates late profile/login responses after an auth transition.
  const authGeneration = useRef(0);
  // Login intent survives StrictMode effect replay, but never logout or an owner change.
  const loginGeneration = useRef(0);
  const providerMounted = useRef(true);
  const profileRequest = useRef(0);
  const observedToken = useRef<string | null>(null);
  const [pendingLogoutToken, setPendingLogoutToken] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN),
  );
  const [logoutRequestToken, setLogoutRequestToken] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutRequests = useRef(new Map<string, Promise<void>>());
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [loginRecoveryError, setLoginRecoveryError] = useState<string | null>(null);
  const [loginWork, setLoginWork] = useState<string[]>([]);
  const [googleAuthResult, setGoogleAuthResult] = useState<GoogleAuthResponse | null>(null);
  const loginRequests = useRef(new Map<string, Promise<LoginResult>>());
  // Settings can unmount while its PUT is pending. Admission belongs to the
  // surviving provider, and stays per owner across a token rollover: an old
  // authenticated write may still be committing after the new session begins.
  const profileMutations = useRef(new Map<string, { token: string; generation: number }>());
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    vehicle: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    sessionCheckError: null,
  });

  const clearSessionData = useCallback(() => {
    // Cancellation takes effect synchronously, even for queries ignoring AbortSignal.
    void queryClient.cancelQueries();
    queryClient.clear();
    closeAllSSE();
    sessionStorage.removeItem(SESSION_KEYS.SNAPSHOT);
    localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
    localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);
  }, [queryClient]);

  const clearAuth = useCallback(() => {
    const clearedToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    authGeneration.current += 1;
    loginGeneration.current += 1;
    observedToken.current = null;
    setGoogleAuthResult(null);
    clearSessionData();
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    clearLoginSessionOwner(clearedToken);
    setState({ user: null, profile: null, vehicle: null, token: null,
      isAuthenticated: false, isLoading: false });
  }, [clearSessionData]);

  // Password and Google auth publish the same mounted provider state.
  const completeLogin = useCallback((data: AuthApiResponse) => {
    if (!data.token) throw new Error('Login succeeded but no token was returned');
    authGeneration.current += 1;
    loginGeneration.current += 1;
    observedToken.current = data.token;
    clearSessionData();
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
    setState({ sessionId: data.sessionId ?? null, user: data.user || null, profile: data.profile || null,
      vehicle: data.vehicle || null, token: data.token,
      isAuthenticated: true, isLoading: false });
  }, [clearSessionData]);

  const refreshLoginAttempts = useCallback(() => {
    try {
      const attempts = listLoginAttempts();
      setLoginAttempts(attempts);
      return attempts;
    } catch {
      setLoginRecoveryError('Saved sign-in recovery is unavailable. Check browser storage before trying again.');
      return null;
    }
  }, []);

  const dismissGoogleAuthResult = useCallback(() => setGoogleAuthResult(null), []);

  const runLoginAttempt = useCallback((attempt: LoginAttempt, url: string, body: object,
    generation = loginGeneration.current): Promise<LoginResult> => {
    const requestKey = `recover:${attempt.id}`;
    const existing = loginRequests.current.get(requestKey);
    if (existing) return existing;
    const initialToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    setLoginWork(work => [...work, requestKey]);
    setLoginRecoveryError(null);
    const request = Promise.resolve().then(async (): Promise<LoginResult> => {
      const ownsAttempt = () => {
        const saved = readLoginAttempt(attempt.id);
        return saved?.proof === attempt.proof && saved.intent === 'recover' &&
          providerMounted.current && loginGeneration.current === generation &&
          localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === initialToken &&
          !localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN);
      };
      try {
        const { response, data } = await postLoginRequest(url, { ...body, recoveryProof: attempt.proof });
        if (!ownsAttempt()) return { success: false, error: 'Sign-in was superseded. Please try again.' };
        if (response.status === 202) {
          setLoginRecoveryError('Your sign-in is still being checked. Try again to recover the same session, or cancel this sign-in.');
          return { success: false, recoveryPending: true };
        }
        const recovering = url === API_ROUTES.AUTH.LOGIN_RECOVERY;
        if (response.status === 410 || (!recovering && response.status >= 400 && response.status < 500)) {
          removeLoginAttempt(attempt);
          refreshLoginAttempts();
          const error = data.error === 'ACCOUNT_CONFLICT'
            ? 'This email is linked to a different Google account. Use that account to sign in.'
            : data.error === 'ACCOUNT_EXISTS'
              ? 'An account was just created with this email. Return to sign in and try again.'
              : typeof data.message === 'string' ? data.message : 'Sign-in could not be completed. Please sign in again.';
          setLoginRecoveryError(error);
          return { success: false, error };
        }
        if (!response.ok) throw new Error('Unconfirmed sign-in');
        const result = data as GoogleAuthResponse;
        if (typeof result.token !== 'string' || !result.token || typeof result.user?.userId !== 'string' ||
            (result.profile && result.profile.userId !== result.user.userId) ||
            (result.vehicle && result.vehicle.driverProfileId !== result.profile?.id)) {
          throw new Error('Unconfirmed sign-in response');
        }
        if (initialToken && initialToken !== result.token) {
          setLoginRecoveryError('Another sign-in is already active in this browser. Cancel this pending sign-in before continuing.');
          return { success: false, recoveryPending: true };
        }
        saveLoginSessionOwner(attempt, result.token);
        if (!ownsAttempt()) return { success: false, recoveryPending: true };
        if (attempt.method === 'google' && result.isNewUser) {
          // Preserve token-before-terms, without publishing authenticated React state.
          clearSessionData();
          localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, result.token);
          observedToken.current = result.token;
        } else completeLogin(result);
        // Another tab can cancel between the last ownership read and token write.
        // Check the durable record again, including its absence after cancellation.
        const publishedAttempt = readLoginAttempt(attempt.id);
        if (publishedAttempt?.proof !== attempt.proof || publishedAttempt.intent !== 'recover' ||
            !providerMounted.current || localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN) ||
            localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== result.token) {
          if (localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === result.token) clearAuth();
          refreshLoginAttempts();
          return { success: false, recoveryPending: true };
        }
        if (attempt.method === 'google') setGoogleAuthResult(result);
        removeLoginAttempt(attempt);
        refreshLoginAttempts();
        setLoginRecoveryError(null);
        return { success: true };
      } catch {
        try {
          const saved = readLoginAttempt(attempt.id);
          if (saved?.proof === attempt.proof && saved.intent === 'recover' && loginGeneration.current === generation) {
            setLoginRecoveryError('We could not confirm your sign-in. Check your connection, then try again to recover the same session.');
          }
        } catch { setLoginRecoveryError('Saved sign-in recovery is unavailable. Check browser storage before trying again.'); }
        return { success: false, recoveryPending: true,
          error: 'We could not confirm your sign-in. Try again to recover the same session.' };
      } finally {
        loginRequests.current.delete(requestKey);
        setLoginWork(work => work.filter(key => key !== requestKey));
      }
    });
    loginRequests.current.set(requestKey, request);
    return request;
  }, [clearSessionData, clearAuth, completeLogin, refreshLoginAttempts]);

  const cancelAttempt = useCallback((attempt: LoginAttempt): Promise<LoginResult> => {
    const requestKey = `cancel:${attempt.id}`;
    const existing = loginRequests.current.get(requestKey);
    if (existing) return existing;
    // Persist the intent before the network: reload or a late login must not undo it.
    let cancelling: LoginAttempt | null;
    try { cancelling = cancelLoginAttempt(attempt); if (!cancelling) return Promise.resolve({ success: true }); }
    catch { setLoginRecoveryError('Could not save cancellation. Check browser storage and try again.'); return Promise.resolve({ success: false }); }
    refreshLoginAttempts();
    authGeneration.current += 1;
    loginGeneration.current += 1;
    const activeToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (activeToken && isLoginSessionCancelled(activeToken)) clearAuth();
    setLoginWork(work => [...work, requestKey]);
    setLoginRecoveryError(null);
    const request = Promise.resolve().then(async (): Promise<LoginResult> => {
      try {
        const { response, data } = await postLoginRequest(API_ROUTES.AUTH.LOGIN_RECOVERY_CANCEL, { recoveryProof: attempt.proof });
        if (!response.ok || data.ok !== true) throw new Error('Cancellation was not confirmed');
        removeLoginAttempt(cancelling!);
        refreshLoginAttempts();
        setLoginRecoveryError(null);
        return { success: true };
      } catch {
        try {
          if (readLoginAttempt(attempt.id)?.proof === attempt.proof) {
            setLoginRecoveryError('We could not finish cancelling sign-in. Check your connection and try again.');
          }
        } catch { setLoginRecoveryError('Saved sign-in recovery is unavailable. Check browser storage before trying again.'); }
        return { success: false, recoveryPending: true };
      } finally {
        loginRequests.current.delete(requestKey);
        setLoginWork(work => work.filter(key => key !== requestKey));
      }
    });
    loginRequests.current.set(requestKey, request);
    return request;
  }, [refreshLoginAttempts, clearAuth]);

  const recoverLogin = useCallback(async () => {
    if (localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)) return;
    const attempt = refreshLoginAttempts()?.[0];
    if (!attempt) return;
    if (attempt.intent === 'cancel') await cancelAttempt(attempt);
    else await runLoginAttempt(attempt, API_ROUTES.AUTH.LOGIN_RECOVERY, {});
  }, [cancelAttempt, refreshLoginAttempts, runLoginAttempt]);

  const cancelPendingLogin = useCallback(async () => {
    // Capture the attempt displayed by this action. Another tab may finish it
    // between rendering the button and the click; cancellation still applies.
    const attempt = loginAttempts[0];
    if (attempt) await cancelAttempt(attempt);
  }, [cancelAttempt, loginAttempts]);

  useEffect(() => { refreshLoginAttempts(); }, [refreshLoginAttempts]);
  useEffect(() => {
    providerMounted.current = true;
    return () => { providerMounted.current = false; };
  }, []);

  const finishLogout = useCallback((token: string): Promise<void> => {
    const existing = logoutRequests.current.get(token);
    if (existing) return existing;
    setLogoutRequestToken(token);
    setLogoutError(null);
    const request = Promise.resolve().then(async () => {
      const abort = new AbortController();
      const timeout = window.setTimeout(() => abort.abort(), 15000);
      try {
        const response = await fetch(API_ROUTES.AUTH.LOGOUT, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
        });
        if (!response.ok && response.status !== 401) throw new Error('Logout was not confirmed');
        // A reload may have interrupted local teardown after removing AUTH_TOKEN.
        clearLoginSessionOwner(token);
        // Another account or another logout may have started while this was pending.
        // Only retire the captured credential; never touch the active auth token.
        if (localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN) === token) {
          localStorage.removeItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN);
          setPendingLogoutToken(null);
          setLogoutError(null);
        }
      } catch {
        if (localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN) === token) {
          setLogoutError('Your account is hidden on this device, but we could not finish signing out. Check your connection and try again before signing in.');
        }
      } finally {
        window.clearTimeout(timeout);
        logoutRequests.current.delete(token);
        setLogoutRequestToken(current => current === token ? null : current);
      }
    });
    logoutRequests.current.set(token, request);
    return request;
  }, []);

  const retryLogout = useCallback(async () => {
    const token = localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN);
    setPendingLogoutToken(token);
    if (token) await finishLogout(token);
  }, [finishLogout]);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    // Keep only the credential needed for the server retry before removing active
    // auth. Private UI/data still disappear immediately, including in other tabs.
    if (token) {
      localStorage.setItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN, token);
      setPendingLogoutToken(token);
    }
    clearAuth();
    const attempts = refreshLoginAttempts() || [];
    await Promise.all([retryLogout(), ...attempts.map(attempt => cancelAttempt(attempt))]);
  }, [clearAuth, retryLogout, refreshLoginAttempts, cancelAttempt]);

  useEffect(() => {
    const handleAuthError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.token !== undefined && (detail.token !== observedToken.current ||
          detail.token !== localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN))) return;
      // A server rejection already ends authorization. Clear locally without
      // making a second authenticated request with the rejected credential.
      if (detail?.status === 401 && typeof detail.token === 'string') clearAuth();
      else void logout();
    };
    window.addEventListener('vecto-auth-error', handleAuthError);
    return () => window.removeEventListener('vecto-auth-error', handleAuthError);
  }, [logout, clearAuth]);

  const fetchProfile = useCallback(async (token: string, expectedOwnerId?: string) => {
    if (localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== token) return;
    const generation = authGeneration.current;
    const request = ++profileRequest.current;
    const isCurrent = () => generation === authGeneration.current &&
      request === profileRequest.current &&
      localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === token;
    if (!isCurrent()) return;
    setState(prev => ({ ...prev, isLoading: !prev.isAuthenticated, sessionCheckError: null }));
    try {
      const response = await fetch(API_ROUTES.AUTH.ME, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data: AuthApiResponse = await response.json();
        if (!isCurrent()) return;
        // A readback confirms only the requested owner. During initial boot the
        // owner is not yet known, but the returned identity/profile/vehicle must
        // still agree before any private values enter shared provider state.
        const ownerId = data?.user?.userId;
        const profile = data?.profile;
        if (typeof ownerId !== 'string' || !ownerId ||
            typeof profile?.id !== 'string' || !profile.id || profile.userId !== ownerId ||
            (expectedOwnerId !== undefined && ownerId !== expectedOwnerId) ||
            (data.vehicle != null && data.vehicle.driverProfileId !== profile.id)) {
          throw new Error('Profile response did not confirm the requested account.');
        }
        if (profile.termsAccepted === false) {
          setGoogleAuthResult({ ...data, token, isNewUser: true });
          setState({ user: null, profile: null, vehicle: null, token,
            isAuthenticated: false, isLoading: false, sessionCheckError: null });
          return data;
        }
        setState({
          sessionId: data.sessionId ?? null,
          user: data.user || null,
          profile: data.profile || null,
          vehicle: data.vehicle || null,
          token,
          isAuthenticated: true,
          isLoading: false,
          sessionCheckError: null,
        });
        return data;
      } else {
        if (!isCurrent()) return;
        // A transient readback failure is not an expired session. Preserve the
        // mounted editor/draft and let updateProfile report verification failure.
        if (response.status === 401) clearAuth();
        else setState(prev => ({ ...prev, isLoading: false,
          sessionCheckError: 'We could not check your saved session. Check your connection and try again.' }));
      }
    } catch (error) {
      console.error('[auth] Failed to fetch profile:', error);
      if (isCurrent()) setState(prev => ({ ...prev, isLoading: false,
        sessionCheckError: 'We could not check your saved session. Check your connection and try again.' }));
    }
  }, [clearAuth]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    // A reload between recording logout intent and removing auth must not revive
    // the session that the user explicitly chose to end.
    if (token && (token === localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN) || isLoginSessionCancelled(token))) {
      clearAuth();
      return;
    }
    observedToken.current = token;
    if (token) {
      setState(prev => ({ ...prev, token }));
      void fetchProfile(token);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
    return () => { authGeneration.current += 1; };
  }, [fetchProfile, clearAuth]);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea !== localStorage ||
          (event.key !== null && event.key !== STORAGE_KEYS.AUTH_TOKEN &&
            event.key !== STORAGE_KEYS.PENDING_LOGOUT_TOKEN &&
            event.key !== STORAGE_KEYS.LOGIN_SESSION_OWNER &&
            !event.key.startsWith(STORAGE_KEYS.LOGIN_CANCEL_PREFIX) &&
            !event.key.startsWith(STORAGE_KEYS.LOGIN_RECOVERY_PREFIX))) return;
      refreshLoginAttempts();
      const pending = localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN);
      setPendingLogoutToken(pending);
      setLogoutError(null);
      const activeToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (activeToken && (activeToken === pending || isLoginSessionCancelled(activeToken))) {
        clearAuth();
        return;
      }
      // Events can arrive after a newer change. Read the current stored token
      // and clear the previous owner's state before hydrating the new session.
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (token === observedToken.current) return;
      observedToken.current = token;
      authGeneration.current += 1;
      loginGeneration.current += 1;
      profileRequest.current += 1;
      setGoogleAuthResult(null);
      clearSessionData();
      setState({ user: null, profile: null, vehicle: null, token,
        isAuthenticated: false, isLoading: token !== null });
      if (token) void fetchProfile(token);
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [clearSessionData, fetchProfile, clearAuth, refreshLoginAttempts]);

  // A suspended browser can resume before its network connection is ready.
  // Retry interrupted initial verification; an already verified session keeps
  // its current data and needs no foreground login or workflow restart.
  useEffect(() => {
    if (!state.sessionCheckError || state.isAuthenticated || state.isLoading || !state.token) return;
    const token = state.token;
    let retrying = false;
    const retry = () => {
      if (retrying) return;
      retrying = true;
      void fetchProfile(token).finally(() => { retrying = false; });
    };
    const visible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [state.sessionCheckError, state.isAuthenticated, state.isLoading, state.token, fetchProfile]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    if (localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)) {
      return { success: false, error: 'Finish signing out of your previous session before signing in.' };
    }
    try {
      if (listLoginAttempts().length) return { success: false, recoveryPending: true, error: 'Finish checking or cancelling your previous sign-in first.' };
      const attempt = createLoginAttempt('password');
      refreshLoginAttempts();
      authGeneration.current += 1;
      return await runLoginAttempt(attempt, API_ROUTES.AUTH.LOGIN, credentials, ++loginGeneration.current);
    } catch {
      return { success: false, error: 'Could not save sign-in recovery. Allow browser storage and try again.' };
    }
  }, [refreshLoginAttempts, runLoginAttempt]);

  const loginWithGoogle = useCallback(async (code: string, oauthState: string): Promise<LoginResult> => {
    if (localStorage.getItem(STORAGE_KEYS.PENDING_LOGOUT_TOKEN)) {
      return { success: false, error: 'Finish signing out of your previous session before signing in.' };
    }
    try {
      const attempts = listLoginAttempts();
      const previous = attempts.find(attempt => attempt.method === 'google' && attempt.oauthState === oauthState);
      if (previous) {
        if (previous.intent === 'cancel') return { success: false, recoveryPending: true };
        return await runLoginAttempt(previous, API_ROUTES.AUTH.LOGIN_RECOVERY, {});
      }
      if (attempts.length) return { success: false, recoveryPending: true };
      const attempt = createLoginAttempt('google', oauthState);
      refreshLoginAttempts();
      authGeneration.current += 1;
      return await runLoginAttempt(attempt, API_ROUTES.AUTH.GOOGLE_CALLBACK, { code, state: oauthState }, ++loginGeneration.current);
    } catch {
      return { success: false, error: 'Could not save sign-in recovery. Allow browser storage and try again.' };
    }
  }, [refreshLoginAttempts, runLoginAttempt]);

  const register = useCallback(async (data: RegisterData) => {
    try {
      const response = await fetch(API_ROUTES.AUTH.REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: AuthApiResponse = await response.json();

      if (!response.ok) {
        return { success: false, error: result.message || result.error || 'Registration failed' };
      }

      // Don't auto-login after registration - user should sign in to verify credentials
      // The token is returned but NOT stored, so user must sign in manually
      return { success: true };
    } catch (error) {
      console.error('[auth] Registration error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (state.token) {
      await fetchProfile(state.token, state.user?.userId);
    }
  }, [state.token, state.user?.userId, fetchProfile]);

  const updateProfile = useCallback(async (data: Partial<DriverProfile>, expectedSettingsRevision: number) => {
    const userId = state.user?.userId;
    if (!state.token || !userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const generation = authGeneration.current;
    const isCurrent = () => generation === authGeneration.current &&
      localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === state.token;
    if (!isCurrent()) return { success: false, error: 'Your sign-in changed. Review your current settings.' };
    if (profileMutations.current.has(userId)) {
      return { success: false, error: 'A settings save is still in progress. Wait for it to finish, then save your changes again.' };
    }
    const mutation = { token: state.token, generation };
    profileMutations.current.set(userId, mutation);

    try {
      const response = await fetch(API_ROUTES.AUTH.PROFILE, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({ ...data, expectedSettingsRevision }),
      });

      if (!isCurrent()) return { success: false, error: 'Your sign-in changed. Review your current settings.' };
      if (handleRequestAuthFailure(response.status, state.token)) {
        return { success: false, error: 'Your session ended. Sign in again to continue.' };
      }

      const result: AuthApiResponse = await response.json();

      if (!isCurrent()) return { success: false, error: 'Your sign-in changed. Review your current settings.' };

      if (!response.ok) {
        return { success: false, error: result.message || result.error || 'Update failed' };
      }

      if (result.user?.userId !== userId || result.profile?.userId !== userId || !result.profile?.id ||
          (result.vehicle != null && result.vehicle.driverProfileId !== result.profile.id) ||
          !Number.isInteger(result.settingsRevision) || typeof result.sessionId !== 'string' || !result.sessionId ||
          (state.sessionId != null && result.sessionId !== state.sessionId)) {
        return { success: false, error: 'Saved settings could not be confirmed. Your draft is preserved; reload your saved setup before continuing.' };
      }
      profileRequest.current++;
      setState(prev => ({ ...prev, profile: result.profile!, vehicle: result.vehicle || null }));
      return { success: true, confirmedProfile: result };
    } catch (error) {
      console.error('[auth] Update profile error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    } finally {
      // A stale request may release only its own admission, never another save.
      if (profileMutations.current.get(userId) === mutation) profileMutations.current.delete(userId);
    }
  }, [state.token, state.user?.userId, state.sessionId]);

  // 2026-01-06: CRITICAL FIX - Memoize context value to prevent infinite re-render loops
  // Without useMemo, every render creates a new object → all consumers re-render → cascade
  // This was causing "Maximum update depth exceeded" errors in LocationContext
  const value: AuthContextValue = useMemo(() => ({
    ...state,
    login,
    completeLogin,
    register,
    logout,
    hasPendingLogout: pendingLogoutToken !== null,
    isLoggingOut: pendingLogoutToken !== null && logoutRequestToken === pendingLogoutToken,
    logoutError,
    retryLogout,
    pendingLoginCount: loginAttempts.length,
    loginRecoveryBusy: loginWork.length > 0,
    loginRecoveryError,
    loginCancellationPending: loginAttempts[0]?.intent === 'cancel',
    recoverLogin,
    cancelPendingLogin,
    loginWithGoogle,
    googleAuthResult,
    dismissGoogleAuthResult,
    refreshProfile,
    updateProfile,
  }), [state, login, completeLogin, register, logout, refreshProfile, updateProfile,
    pendingLogoutToken, logoutRequestToken, logoutError, retryLogout, loginAttempts,
    loginWork, loginRecoveryError, recoverLogin, cancelPendingLogin, loginWithGoogle,
    googleAuthResult, dismissGoogleAuthResult]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Helper function to get auth header for API calls
export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
