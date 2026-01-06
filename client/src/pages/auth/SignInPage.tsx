// client/src/pages/auth/SignInPage.tsx
// Sign in page with email/password and social login (Google, Apple)

import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2 } from 'lucide-react';

// Social login icons as inline SVGs for reliability
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const AppleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

// Separator component
const OrDivider = () => (
  <div className="relative my-6">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full border-t border-slate-600" />
    </div>
    <div className="relative flex justify-center text-sm">
      <span className="px-4 bg-slate-800/50 text-slate-400">or continue with</span>
    </div>
  </div>
);

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type SignInFormData = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if user just registered successfully
  const justRegistered = searchParams.get('registered') === 'true';

  // IMPORTANT: All hooks must be called before any conditional returns
  const form = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  // Redirect authenticated users to the app - don't show login page
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      console.log('🔐 [SignIn] User already authenticated - redirecting to app');
      navigate('/co-pilot/strategy', { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Show loading while checking auth state - prevents flash of login form
  if (authLoading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: SignInFormData) => {
    setIsLoading(true);
    setError(null);

    const result = await login(data);

    if (result.success) {
      navigate('/co-pilot/strategy');
    } else {
      setError(result.error || 'Login failed');
    }

    setIsLoading(false);
  };

  // Social login handlers - redirect to OAuth endpoints
  const handleGoogleLogin = async () => {
    setSocialLoading('google');
    setError(null);
    // Redirect to Google OAuth endpoint
    window.location.href = '/api/auth/google';
  };

  const handleAppleLogin = async () => {
    setSocialLoading('apple');
    setError(null);
    // Redirect to Apple OAuth endpoint
    window.location.href = '/api/auth/apple';
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 overflow-y-auto">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
            <span className="text-2xl font-bold text-white">VP</span>
          </div>
          <CardTitle className="text-2xl text-white">Welcome Back</CardTitle>
          <CardDescription className="text-slate-400">
            Sign in to your VectoPilot account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Success message after registration */}
          {justRegistered && (
            <Alert className="mb-4 border-green-600/50 bg-green-900/20">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-300">
                Account created successfully! Please sign in with your credentials.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="driver@example.com"
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Link
                  to="/auth/forgot-password"
                  className="text-sm text-amber-400 hover:text-amber-300"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                disabled={isLoading || socialLoading !== null}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </Form>

          {/* Social Login Options */}
          <OrDivider />

          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full bg-white hover:bg-gray-50 text-gray-900 border-gray-300"
              onClick={handleGoogleLogin}
              disabled={isLoading || socialLoading !== null}
            >
              {socialLoading === 'google' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              <span className="ml-2">Continue with Google</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full bg-black hover:bg-gray-900 text-white border-gray-700"
              onClick={handleAppleLogin}
              disabled={isLoading || socialLoading !== null}
            >
              {socialLoading === 'apple' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <AppleIcon />
              )}
              <span className="ml-2">Continue with Apple</span>
            </Button>
          </div>

          <div className="mt-6 text-center text-slate-400">
            <span>Don't have an account? </span>
            <Link to="/auth/sign-up" className="text-amber-400 hover:text-amber-300 font-medium">
              Sign up
            </Link>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
