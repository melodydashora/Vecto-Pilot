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

interface AuthContextValue extends AuthState {
  completeLogin: (data: AuthApiResponse) => void;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
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
  const profileRequest = useRef(0);
  const observedToken = useRef<string | null>(null);
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
    authGeneration.current += 1;
    observedToken.current = null;
    clearSessionData();
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    setState({ user: null, profile: null, vehicle: null, token: null,
      isAuthenticated: false, isLoading: false });
  }, [clearSessionData]);

  // 2026-09-10: Password and Google auth publish the same mounted provider state.
  const completeLogin = useCallback((data: AuthApiResponse) => {
    if (!data.token) throw new Error('Login succeeded but no token was returned');
    authGeneration.current += 1;
    observedToken.current = data.token;
    clearSessionData();
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
    setState({ sessionId: data.sessionId ?? null, user: data.user || null, profile: data.profile || null,
      vehicle: data.vehicle || null, token: data.token,
      isAuthenticated: true, isLoading: false });
  }, [clearSessionData]);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    // Local teardown must not wait for the server or erase a subsequent login.
    clearAuth();
    try {
      if (token) await fetch(API_ROUTES.AUTH.LOGOUT, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error('[auth] Logout error:', error);
    }
  }, [clearAuth]);

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
    observedToken.current = token;
    if (token) {
      setState(prev => ({ ...prev, token }));
      void fetchProfile(token);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
    return () => { authGeneration.current += 1; };
  }, [fetchProfile]);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea !== localStorage ||
          (event.key !== null && event.key !== STORAGE_KEYS.AUTH_TOKEN)) return;
      // Events can arrive after a newer change. Read the current stored token
      // and clear the previous owner's state before hydrating the new session.
      const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (token === observedToken.current) return;
      observedToken.current = token;
      authGeneration.current += 1;
      profileRequest.current += 1;
      clearSessionData();
      setState({ user: null, profile: null, vehicle: null, token,
        isAuthenticated: false, isLoading: token !== null });
      if (token) void fetchProfile(token);
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [clearSessionData, fetchProfile]);

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
    const generation = ++authGeneration.current;
    try {
      const response = await fetch(API_ROUTES.AUTH.LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      const data: AuthApiResponse = await response.json();

      if (generation !== authGeneration.current) {
        return { success: false, error: 'Sign-in was superseded. Please try again.' };
      }
      if (!response.ok) {
        return { success: false, error: data.message || data.error || 'Login failed' };
      }

      if (!data.token) return { success: false, error: 'Login succeeded but no token was returned' };
      completeLogin(data);

      return { success: true };
    } catch (error) {
      console.error('[auth] Login error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [completeLogin]);

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
    refreshProfile,
    updateProfile,
  }), [state, login, completeLogin, register, logout, refreshProfile, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Helper function to get auth header for API calls
export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
