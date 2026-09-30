// client/src/components/auth/AuthRedirect.tsx
// Smart redirect component that routes based on authentication state

import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import SessionCheck from './SessionCheck';

/**
 * AuthRedirect - Routes users based on their authentication state
 *
 * - If loading: Show spinner (don't redirect yet!)
 * - If authenticated: Go to /co-pilot/strategy
 * - If not authenticated: Go to /auth/sign-in
 */
export default function AuthRedirect() {
  const { isAuthenticated, isLoading, sessionCheckError, refreshProfile } = useAuth();

  // CRITICAL: Wait for auth state to load before making any routing decision
  if (isLoading || (!isAuthenticated && sessionCheckError)) {
    return <SessionCheck error={isLoading ? null : sessionCheckError} onRetry={refreshProfile} />;
  }

  // Route based on auth state
  if (isAuthenticated) {
    return <Navigate to="/co-pilot/strategy" replace />;
  }

  return <Navigate to="/auth/sign-in" replace />;
}
