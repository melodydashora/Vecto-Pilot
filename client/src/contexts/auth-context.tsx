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

interface AuthContextValue extends AuthState {
  completeLogin: (data: AuthApiResponse) => void;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<DriverProfile>) => Promise<{
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
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    vehicle: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
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
    clearSessionData();
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    setState({ user: null, profile: null, vehicle: null, token: null,
      isAuthenticated: false, isLoading: false });
  }, [clearSessionData]);

  // 2026-09-10: Password and Google auth publish the same mounted provider state.
  const completeLogin = useCallback((data: AuthApiResponse) => {
    if (!data.token) throw new Error('Login succeeded but no token was returned');
    authGeneration.current += 1;
    clearSessionData();
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
    setState({ user: data.user || null, profile: data.profile || null,
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
    const handleAuthError = () => { void logout(); };
    window.addEventListener('vecto-auth-error', handleAuthError);
    return () => window.removeEventListener('vecto-auth-error', handleAuthError);
  }, [logout]);

  const fetchProfile = useCallback(async (token: string) => {
    if (localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== token) return;
    const generation = authGeneration.current;
    const request = ++profileRequest.current;
    const isCurrent = () => generation === authGeneration.current &&
      request === profileRequest.current &&
      localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === token;
    if (!isCurrent()) return;
    try {
      const response = await fetch(API_ROUTES.AUTH.ME, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data: AuthApiResponse = await response.json();
        if (!isCurrent()) return;
        setState({
          user: data.user || null,
          profile: data.profile || null,
          vehicle: data.vehicle || null,
          token,
          isAuthenticated: true,
          isLoading: false,
        });
        return data;
      } else {
        if (isCurrent()) clearAuth();
      }
    } catch (error) {
      console.error('[auth] Failed to fetch profile:', error);
      if (isCurrent()) setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [clearAuth]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      setState(prev => ({ ...prev, token }));
      void fetchProfile(token);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
    return () => { authGeneration.current += 1; };
  }, [fetchProfile]);

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
      await fetchProfile(state.token);
    }
  }, [state.token, fetchProfile]);

  const updateProfile = useCallback(async (data: Partial<DriverProfile>) => {
    if (!state.token) {
      return { success: false, error: 'Not authenticated' };
    }

    const generation = authGeneration.current;
    const isCurrent = () => generation === authGeneration.current &&
      localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === state.token;

    try {
      const response = await fetch(API_ROUTES.AUTH.PROFILE, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify(data),
      });

      const result: AuthApiResponse = await response.json();

      if (!isCurrent()) return { success: false, error: 'Your sign-in changed. Review your current settings.' };

      if (!response.ok) {
        return { success: false, error: result.message || result.error || 'Update failed' };
      }

      // Return this save's own readback; an unrelated refresh cannot confirm its payload.
      const confirmedProfile = await fetchProfile(state.token);
      if (!isCurrent()) return { success: false, error: 'Your sign-in changed. Review your current settings.' };
      return { success: true, confirmedProfile, profileRefreshFailed: !confirmedProfile };
    } catch (error) {
      console.error('[auth] Update profile error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [state.token, fetchProfile]);

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
