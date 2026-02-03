// client/src/components/CriticalError.tsx
// 2026-01-15: FAIL HARD - Critical error modal that blocks the UI
// When the app enters an unrecoverable state (no snapshot, no location, etc.),
// this component replaces the entire dashboard - no partial rendering allowed.

import React from 'react';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type CriticalErrorType =
  | 'snapshot_missing'
  | 'snapshot_incomplete'
  | 'location_failed'
  | 'auth_failed'
  | 'unknown';

interface CriticalErrorProps {
  type: CriticalErrorType;
  message?: string;
  details?: string;
  onRetry?: () => void;
  onLogout?: () => void;
}

const ERROR_MESSAGES: Record<CriticalErrorType, { title: string; description: string }> = {
  snapshot_missing: {
    title: 'Session Data Missing',
    description: 'Unable to load your current session. Your location snapshot could not be retrieved.'
  },
  snapshot_incomplete: {
    title: 'Incomplete Location Data',
    description: 'Your location could not be fully resolved. This may be a GPS permissions issue or network problem.'
  },
  location_failed: {
    title: 'Location Resolution Failed',
    description: 'Unable to determine your current location. Please ensure GPS permissions are enabled.'
  },
  auth_failed: {
    title: 'Authentication Required',
    description: 'Your session has expired or you are not signed in. Please sign in to continue.'
  },
  unknown: {
    title: 'Something Went Wrong',
    description: 'An unexpected error occurred. Please try refreshing the page.'
  }
};

/**
 * CriticalError - Blocking error modal for unrecoverable states
 *
 * FAIL HARD principle: Instead of showing partial/broken UI with soft fallbacks,
 * we show a full-screen error that forces the user to take action.
 *
 * This prevents:
 * - "Unknown Location" being displayed
 * - Partial dashboard with missing data
 * - Broken features that fail silently
 */
export default function CriticalError({
  type,
  message,
  details,
  onRetry,
  onLogout
}: CriticalErrorProps) {
  const errorInfo = ERROR_MESSAGES[type] || ERROR_MESSAGES.unknown;

  const handleRefresh = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      // Clear all storage and reload
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-red-900 to-red-950 flex items-center justify-center z-50">
      <div className="max-w-md mx-auto p-8 text-center">
        {/* Error Icon */}
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-red-400" />
        </div>

        {/* Error Title */}
        <h1 className="text-2xl font-bold text-white mb-3">
          {errorInfo.title}
        </h1>

        {/* Error Description */}
        <p className="text-red-200 mb-4">
          {message || errorInfo.description}
        </p>

        {/* Technical Details (if provided) */}
        {details && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 mb-6 text-left">
            <p className="text-xs text-red-400 font-mono break-all">
              {details}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleRefresh}
            className="w-full bg-white text-red-900 hover:bg-red-100"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>

          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full border-red-400 text-red-200 hover:bg-red-900/50"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out & Start Fresh
          </Button>
        </div>

        {/* Support Link */}
        <p className="text-red-400 text-xs mt-6">
          If this problem persists, please contact support.
        </p>
      </div>
    </div>
  );
}
