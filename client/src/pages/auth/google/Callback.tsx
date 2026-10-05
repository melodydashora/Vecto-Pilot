// client/src/pages/auth/google/Callback.tsx
// 2026-02-13: Google OAuth callback handler
// Google OAuth landing page (2026-09-13: Uber OAuth integration removed).
//
// Flow: Google redirects here with ?code=XXX&state=YYY
// This page sends code+state to the server for token exchange,
// then stores the app token and redirects to the strategy page.
//
// 2026-02-13: New users must accept Terms & Conditions before proceeding.
// The server sets terms_accepted: false for new Google sign-ups.

import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';
import { useAuth } from '@/contexts/auth-context';
import LoginRecovery from '@/components/auth/LoginRecovery';
import SessionCheck from '@/components/auth/SessionCheck';
import type { AuthApiResponse } from '@/types/auth';
import { STORAGE_KEYS } from '@/constants/storageKeys';

type GoogleAuthResponse = AuthApiResponse & { isNewUser?: boolean; passwordRevoked?: boolean };

export const GoogleCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { completeLogin, loginWithGoogle, googleAuthResult, dismissGoogleAuthResult,
    pendingLoginCount, hasPendingLogout, loginRecoveryError, token, isLoading: authLoading,
    isAuthenticated, sessionCheckError, refreshProfile } = useAuth();
  const [status, setStatus] = useState<'processing' | 'terms' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<GoogleAuthResponse | null>(null);
  const [passwordRevoked, setPasswordRevoked] = useState(false);
  // Reuse a one-time exchange during StrictMode effect replay; never retry conflicts.
  const exchangeRef = useRef<{ key: string; promise: ReturnType<typeof loginWithGoogle> } | null>(null);
  const sawPendingRecovery = useRef(false);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    if (!googleAuthResult) return;
    setPasswordRevoked(googleAuthResult.passwordRevoked === true);
    setPendingAuth(googleAuthResult);
    setStatus(googleAuthResult.isNewUser ? 'terms' : 'success');
  }, [googleAuthResult]);

  useEffect(() => {
    if (googleAuthResult || authLoading || token) return;
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

    let active = true;
    const key = JSON.stringify([code, state]);
    if (exchangeRef.current?.key !== key) {
      exchangeRef.current = { key, promise: loginWithGoogle(code, state) };
    }
    exchangeRef.current.promise.then(result => {
      if (!active) return;
      if (!result.success && !result.recoveryPending) {
        setStatus('error');
        setErrorMsg(result.error || 'Google authentication failed. Please try again.');
      }
    }).catch(err => {
      if (!active) return;
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to complete Google sign-in. Please try again.');
    });
    return () => { active = false; };
  }, [searchParams, loginWithGoogle, googleAuthResult, authLoading, token]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !googleAuthResult && pendingLoginCount === 0) {
      navigate('/co-pilot/strategy', { replace: true });
    }
  }, [authLoading, isAuthenticated, googleAuthResult, pendingLoginCount, navigate]);

  useEffect(() => {
    if (pendingLoginCount > 0) sawPendingRecovery.current = true;
    else if (sawPendingRecovery.current && !googleAuthResult && status === 'processing') {
      // Cancellation or expiry ends this one-time callback. Never replay its code.
      setStatus('error');
      setErrorMsg(loginRecoveryError || 'This sign-in was cancelled. Return to sign in to start again.');
    }
  }, [pendingLoginCount, googleAuthResult, status, loginRecoveryError]);

  useEffect(() => {
    // Let drivers read a password revocation notice before continuing.
    if (status !== 'success' || passwordRevoked || pendingLoginCount > 0) return;
    const timer = setTimeout(() => { dismissGoogleAuthResult(); navigate('/co-pilot/strategy'); }, 1500);
    return () => clearTimeout(timer);
  }, [status, passwordRevoked, pendingLoginCount, navigate, dismissGoogleAuthResult]);

  // 2026-02-13: Handle terms acceptance for new Google users
  const handleAcceptTerms = async () => {
    if (!termsAccepted || !pendingAuth?.token || isAccepting) return;
    const authToken = pendingAuth.token;

    setIsAccepting(true);
    setErrorMsg('');
    try {
      const currentResponse = await fetch(API_ROUTES.AUTH.ME, { headers: { Authorization: `Bearer ${authToken}` }, cache: 'no-store' });
      const current: AuthApiResponse = await currentResponse.json();
      if (!currentResponse.ok || current.user?.userId !== pendingAuth.user?.userId || !Number.isInteger(current.settingsRevision) ||
          localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== authToken) throw new Error('Could not confirm the current sign-in.');
      const response = await fetch(API_ROUTES.AUTH.PROFILE, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ termsAccepted: true, expectedSettingsRevision: current.settingsRevision }),
      });

      if (!response.ok) {
        throw new Error('Failed to save terms acceptance');
      }

      if (localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== authToken) {
        throw new Error('Sign-in session changed');
      }
      const canonical: AuthApiResponse = await response.json();
      if (canonical.user?.userId !== pendingAuth.user?.userId || canonical.profile?.userId !== pendingAuth.user?.userId ||
          canonical.profile?.termsAccepted !== true || canonical.sessionId !== current.sessionId || !Number.isInteger(canonical.settingsRevision)) {
        throw new Error('Terms acceptance was not confirmed.');
      }
      completeLogin({ ...pendingAuth, ...canonical, token: authToken });
      setStatus('success');
    } catch (err) {
      console.error('[google-auth] Terms acceptance error:', err);
      setErrorMsg('Failed to save terms acceptance. Please try again.');
      // Keep the checkbox and retry action available; do not authenticate on failure.
    } finally {
      setIsAccepting(false);
    }
  };

  if (hasPendingLogout) return <div className="p-6"><Link to="/auth/sign-in">Finish signing out before signing in again</Link></div>;
  if (pendingLoginCount > 0) return <LoginRecovery />;
  if (!isAuthenticated && sessionCheckError) return <SessionCheck error={sessionCheckError} onRetry={refreshProfile} />;

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

                {errorMsg && <p role="alert" className="text-sm text-red-600">{errorMsg}</p>}
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
                {passwordRevoked ? (
                  <>
                    <p role="status" className="text-sm text-gray-700 mt-2">
                      Your old password was disabled. Use Google to sign in, or reset your password.
                    </p>
                    <Button className="mt-4" onClick={() => { dismissGoogleAuthResult(); navigate('/co-pilot/strategy'); }}>Continue</Button>
                  </>
                ) : <p className="text-sm text-gray-500">Redirecting...</p>}
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-12 h-12 text-red-500" />
              <div className="text-center">
                <p className="font-medium text-lg text-red-600">Sign-In Failed</p>
                <p role="alert" className="text-sm text-gray-500 mt-2">{errorMsg}</p>
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
