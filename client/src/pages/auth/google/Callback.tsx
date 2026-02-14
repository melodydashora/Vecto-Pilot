// client/src/pages/auth/google/Callback.tsx
// 2026-02-13: Google OAuth callback handler
// Follows the same pattern as client/src/pages/auth/uber/Callback.tsx
//
// Flow: Google redirects here with ?code=XXX&state=YYY
// This page sends code+state to the server for token exchange,
// then stores the app token and redirects to the strategy page.
//
// 2026-02-13: New users must accept Terms & Conditions before proceeding.
// The server sets terms_accepted: false for new Google sign-ups.

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

export const GoogleCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'terms' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

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
          // Store token for later use
          setAuthToken(data.token);

          // 2026-02-13: New users must accept terms before proceeding
          if (data.isNewUser) {
            localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
            setStatus('terms');
          } else {
            // Existing user — store token and redirect
            localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
            setStatus('success');
            setTimeout(() => navigate('/co-pilot/strategy'), 1500);
          }
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

  // 2026-02-13: Handle terms acceptance for new Google users
  const handleAcceptTerms = async () => {
    if (!termsAccepted || !authToken) return;

    setIsAccepting(true);
    try {
      const response = await fetch(API_ROUTES.AUTH.PROFILE, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ termsAccepted: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to save terms acceptance');
      }

      setStatus('success');
      setTimeout(() => navigate('/co-pilot/strategy'), 1500);
    } catch (err) {
      console.error('[google-auth] Terms acceptance error:', err);
      setErrorMsg('Failed to save terms acceptance. Please try again.');
      setStatus('error');
    } finally {
      setIsAccepting(false);
    }
  };

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

          {/* 2026-02-13: Terms acceptance step for new Google users */}
          {status === 'terms' && (
            <>
              <FileText className="w-12 h-12 text-blue-500" />
              <div className="text-center space-y-4 w-full">
                <p className="font-medium text-lg">Welcome to Vecto Pilot!</p>
                <p className="text-sm text-gray-500">
                  Your account has been created. Please accept our terms to continue.
                </p>

                <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg text-left">
                  <Checkbox
                    id="google-terms"
                    checked={termsAccepted}
                    onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  />
                  <label htmlFor="google-terms" className="text-sm text-gray-700 cursor-pointer leading-relaxed">
                    I agree to the{' '}
                    <Link
                      to="/auth/terms"
                      target="_blank"
                      className="text-blue-600 hover:underline"
                    >
                      Terms and Conditions
                    </Link>
                    {' '}and{' '}
                    <Link
                      to="/co-pilot/policy"
                      target="_blank"
                      className="text-blue-600 hover:underline"
                    >
                      Privacy Policy
                    </Link>
                  </label>
                </div>

                <Button
                  onClick={handleAcceptTerms}
                  disabled={!termsAccepted || isAccepting}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Accept & Continue'
                  )}
                </Button>
              </div>
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
