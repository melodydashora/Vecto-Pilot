// client/src/components/auth/ProtectedRoute.tsx
// Route guard component that redirects unauthenticated users to sign in

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import SessionCheck from './SessionCheck';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, sessionCheckError, refreshProfile } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking auth status
  if (isLoading || (!isAuthenticated && sessionCheckError)) {
    return <SessionCheck error={isLoading ? null : sessionCheckError} onRetry={refreshProfile} />;
  }

  // Redirect to sign in if not authenticated
  if (!isAuthenticated) {
    // Save the attempted location for redirect after login
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
