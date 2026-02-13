// client/src/pages/auth/google/Callback.tsx
// 2026-02-13: Google OAuth callback handler
// Follows the same pattern as client/src/pages/auth/uber/Callback.tsx
//
// Flow: Google redirects here with ?code=XXX&state=YYY
// This page sends code+state to the server for token exchange,
// then stores the app token and redirects to the strategy page.

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

export const GoogleCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Google returns error param if user denied consent
    if (error) {
      setStatus('error');
      setErrorMsg(
        error === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : `Google authorization failed: ${error}`
      );
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMsg('Missing authorization code or state. Please try again.');
      return;
    }

    const handleExchange = async () => {
      try {
        const response = await fetch(API_ROUTES.AUTH.GOOGLE_CALLBACK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        const data = await response.json();

        if (!response.ok) {
          // Handle specific error cases
          if (data.error === 'NO_ACCOUNT') {
            setStatus('error');
            setErrorMsg(data.message || 'No account found. Please sign up first.');
            return;
          }
          throw new Error(data.message || 'Google authentication failed');
        }

        if (data.token) {
          // Store token and update auth state
          localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
          setStatus('success');
          // Short delay so user sees success before redirect
          setTimeout(() => navigate('/co-pilot/strategy'), 1500);
        } else {
          throw new Error('No token received from server');
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Failed to complete Google sign-in. Please try again.'
        );
        console.error('[google-auth] Exchange error:', err);
      }
    };

    handleExchange();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Google Sign-In</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === 'processing' && (
            <>
              <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
              <p className="text-gray-600">Completing sign-in...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <div className="text-center">
                <p className="font-medium text-lg">Signed In Successfully!</p>
                <p className="text-sm text-gray-500">Redirecting...</p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-12 h-12 text-red-500" />
              <div className="text-center">
                <p className="font-medium text-lg text-red-600">Sign-In Failed</p>
                <p className="text-sm text-gray-500 mt-2">{errorMsg}</p>
                <button
                  onClick={() => navigate('/auth/sign-in')}
                  className="mt-4 px-4 py-2 text-sm text-blue-600 hover:underline"
                >
                  Back to Sign In
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
