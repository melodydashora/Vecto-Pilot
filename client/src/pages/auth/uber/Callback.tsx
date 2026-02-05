import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { exchangeUberCode } from '@/services/uber/uberAuth';

export const UberCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMsg(`Uber authorization failed: ${error}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code received.');
      return;
    }

    // Exchange code for token
    const handleExchange = async () => {
      try {
        await exchangeUberCode(code);
        setStatus('success');
        // Redirect back to settings or dashboard after short delay
        setTimeout(() => navigate('/settings'), 2000);
      } catch (err) {
        setStatus('error');
        setErrorMsg('Failed to connect Uber account. Please try again.');
        console.error('Uber auth error:', err);
      }
    };

    handleExchange();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Uber Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === 'processing' && (
            <>
              <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
              <p className="text-gray-600">Connecting your account...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <div className="text-center">
                <p className="font-medium text-lg">Connected Successfully!</p>
                <p className="text-sm text-gray-500">Redirecting...</p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-12 h-12 text-red-500" />
              <div className="text-center">
                <p className="font-medium text-lg text-red-600">Connection Failed</p>
                <p className="text-sm text-gray-500 mt-2">{errorMsg}</p>
                <button 
                  onClick={() => navigate('/settings')}
                  className="mt-4 px-4 py-2 text-sm text-blue-600 hover:underline"
                >
                  Return to Settings
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
