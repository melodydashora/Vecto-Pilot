// client/src/components/auth/AuthRedirect.tsx
// Smart redirect component that routes based on authentication state

import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

/**
 * AuthRedirect - Routes users based on their authentication state
 *
 * - If loading: Show spinner (don't redirect yet!)
 * - If authenticated: Go to /co-pilot/strategy
 * - If not authenticated: Go to /auth/sign-in
 */
export default function AuthRedirect() {
  const { isAuthenticated, isLoading } = useAuth();

  // CRITICAL: Wait for auth state to load before making any routing decision
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Route based on auth state
  if (isAuthenticated) {
    return <Navigate to="/co-pilot/strategy" replace />;
  }

  return <Navigate to="/auth/sign-in" replace />;
}
