// client/src/contexts/auth-context.tsx
// Authentication context for user login, registration, and session management

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
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

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<DriverProfile>) => Promise<{ success: boolean; error?: string }>;
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
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    vehicle: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Load token from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      setState(prev => ({ ...prev, token }));
      // Fetch user profile
      fetchProfile(token);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // 2026-01-06: Listen for auth errors from API calls and force logout
  // This handles cases where server returns 401 (no_token, session_expired, etc.)
  // Dispatched by useBriefingQueries and other hooks when API returns 401
  useEffect(() => {
    const handleAuthError = (event: Event) => {
      const customEvent = event as CustomEvent;
      const error = customEvent.detail?.error || 'unknown';
      console.warn(`[auth] 🔐 Auth error received: ${error} - forcing logout`);

      // Clear local auth state
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);
      sessionStorage.removeItem(SESSION_KEYS.SNAPSHOT);

      setState({
        user: null,
        profile: null,
        vehicle: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    };

    window.addEventListener('vecto-auth-error', handleAuthError);
    return () => window.removeEventListener('vecto-auth-error', handleAuthError);
  }, []);

  const fetchProfile = async (token: string) => {
    try {
      const response = await fetch(API_ROUTES.AUTH.ME, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data: AuthApiResponse = await response.json();
        setState({
          user: data.user || null,
          profile: data.profile || null,
          vehicle: data.vehicle || null,
          token,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        // Token invalid, clear it
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        setState({
          user: null,
          profile: null,
          vehicle: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch (error) {
      console.error('[auth] Failed to fetch profile:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      const response = await fetch(API_ROUTES.AUTH.LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      const data: AuthApiResponse = await response.json();

      if (!response.ok) {
        return { success: false, error: data.message || data.error || 'Login failed' };
      }

      if (data.token) {
        localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
        setState({
          user: data.user || null,
          profile: data.profile || null,
          vehicle: data.vehicle || null,
          token: data.token,
          isAuthenticated: true,
          isLoading: false,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[auth] Login error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

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

  const logout = useCallback(async () => {
    try {
      if (state.token) {
        await fetch(API_ROUTES.AUTH.LOGOUT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${state.token}`,
          },
        });
      }
    } catch (error) {
      console.error('[auth] Logout error:', error);
    } finally {
      // Clear all session data on logout
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);
      sessionStorage.removeItem(SESSION_KEYS.SNAPSHOT);

      setState({
        user: null,
        profile: null,
        vehicle: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, [state.token]);

  const refreshProfile = useCallback(async () => {
    if (state.token) {
      await fetchProfile(state.token);
    }
  }, [state.token]);

  const updateProfile = useCallback(async (data: Partial<DriverProfile>) => {
    if (!state.token) {
      return { success: false, error: 'Not authenticated' };
    }

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

      if (!response.ok) {
        return { success: false, error: result.message || result.error || 'Update failed' };
      }

      // Refresh profile data
      await fetchProfile(state.token);
      return { success: true };
    } catch (error) {
      console.error('[auth] Update profile error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [state.token]);

  // 2026-01-06: CRITICAL FIX - Memoize context value to prevent infinite re-render loops
  // Without useMemo, every render creates a new object → all consumers re-render → cascade
  // This was causing "Maximum update depth exceeded" errors in LocationContext
  const value: AuthContextValue = useMemo(() => ({
    ...state,
    login,
    register,
    logout,
    refreshProfile,
    updateProfile,
  }), [state, login, register, logout, refreshProfile, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Helper function to get auth header for API calls
export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
