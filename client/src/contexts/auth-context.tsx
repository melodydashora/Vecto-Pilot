// client/src/contexts/auth-context.tsx
// Authentication context for user login, registration, and session management

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type {
  User,
  DriverProfile,
  DriverVehicle,
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<DriverProfile>) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'vectopilot_auth_token';

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
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      setState(prev => ({ ...prev, token }));
      // Fetch user profile
      fetchProfile(token);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const fetchProfile = async (token: string) => {
    try {
      const response = await fetch('/api/auth/me', {
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
        localStorage.removeItem(TOKEN_KEY);
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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      const data: AuthApiResponse = await response.json();

      if (!response.ok) {
        return { success: false, error: data.message || data.error || 'Login failed' };
      }

      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: AuthApiResponse = await response.json();

      if (!response.ok) {
        return { success: false, error: result.message || result.error || 'Registration failed' };
      }

      if (result.token) {
        localStorage.setItem(TOKEN_KEY, result.token);
        setState({
          user: result.user || null,
          profile: result.profile || null,
          vehicle: result.vehicle || null,
          token: result.token,
          isAuthenticated: true,
          isLoading: false,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[auth] Registration error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (state.token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${state.token}`,
          },
        });
      }
    } catch (error) {
      console.error('[auth] Logout error:', error);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
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
      const response = await fetch('/api/auth/profile', {
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

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    refreshProfile,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Helper function to get auth header for API calls
export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
