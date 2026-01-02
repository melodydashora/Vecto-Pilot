// client/src/pages/auth/ResetPasswordPage.tsx
// Reset password form - handles both token (email) and code (SMS) flows

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, ArrowLeft } from 'lucide-react';

const resetPasswordSchema = z.object({
  code: z.string().optional(),
  email: z.string().email('Please enter a valid email').optional(),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const _navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Determine if this is a token-based (email) or code-based (SMS) reset
  const isTokenReset = !!token;

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      code: '',
      email: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  // If we have a token, we don't need the code or email
  useEffect(() => {
    if (token) {
      // Optionally validate the token on mount
    }
  }, [token]);

  const onSubmit = async (data: ResetPasswordFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const body = token
        ? { token, newPassword: data.newPassword }
        : { code: data.code, email: data.email, newPassword: data.newPassword };

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.message || result.error || 'Failed to reset password');
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error('[auth] Reset password error:', err);
      setError('Network error. Please try again.');
    }

    setIsLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">Password Reset!</CardTitle>
            <CardDescription className="text-slate-400">
              Your password has been successfully reset. You can now sign in with your new password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/auth/sign-in">
              <Button
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                Sign In
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
            <span className="text-2xl font-bold text-white">VP</span>
          </div>
          <CardTitle className="text-2xl text-white">Reset Password</CardTitle>
          <CardDescription className="text-slate-400">
            {isTokenReset
              ? 'Enter your new password below'
              : 'Enter the code sent to your phone and create a new password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Only show code/email fields for SMS reset */}
              {!isTokenReset && (
                <>
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
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Verification Code</FormLabel>
                        <FormControl>
                          <InputOTP
                            maxLength={6}
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <InputOTPGroup className="gap-2">
                              <InputOTPSlot index={0} className="bg-slate-700/50 border-slate-600 text-white" />
                              <InputOTPSlot index={1} className="bg-slate-700/50 border-slate-600 text-white" />
                              <InputOTPSlot index={2} className="bg-slate-700/50 border-slate-600 text-white" />
                              <InputOTPSlot index={3} className="bg-slate-700/50 border-slate-600 text-white" />
                              <InputOTPSlot index={4} className="bg-slate-700/50 border-slate-600 text-white" />
                              <InputOTPSlot index={5} className="bg-slate-700/50 border-slate-600 text-white" />
                            </InputOTPGroup>
                          </InputOTP>
                        </FormControl>
                        <FormDescription className="text-slate-400 text-xs">
                          Enter the 6-digit code sent to your phone
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Create a new password"
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-slate-400 text-xs">
                      Min 8 chars, 1 uppercase, 1 lowercase, 1 number
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">Confirm New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm your new password"
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  'Reset Password'
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-6 text-center">
            <Link to="/auth/sign-in" className="text-amber-400 hover:text-amber-300 text-sm">
              <ArrowLeft className="inline mr-1 h-4 w-4" />
              Back to Sign In
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
