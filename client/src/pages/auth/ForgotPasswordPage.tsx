// client/src/pages/auth/ForgotPasswordPage.tsx
// Forgot password - choose email or SMS reset method

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, Smartphone, ArrowLeft, CheckCircle } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  method: z.enum(['email', 'sms'], { required_error: 'Please select a reset method' }),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'email' | 'sms' | null>(null);

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
      method: 'email',
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.AUTH.FORGOT_PASSWORD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.message || result.error || 'Failed to send reset instructions');
      } else {
        setSelectedMethod(data.method);
        setSuccess(true);
      }
    } catch (err) {
      console.error('[auth] Forgot password error:', err);
      setError('Network error. Please try again.');
    }

    setIsLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 overflow-y-auto">
        <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">Check Your {selectedMethod === 'email' ? 'Email' : 'Phone'}</CardTitle>
            <CardDescription className="text-slate-400">
              {selectedMethod === 'email'
                ? 'We sent you a password reset link. Check your inbox and follow the instructions.'
                : 'We sent you a verification code via SMS. Enter the code on the reset page.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {selectedMethod === 'sms' && (
                <Link to="/auth/reset-password">
                  <Button
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                  >
                    Enter Reset Code
                  </Button>
                </Link>
              )}
              <Link to="/auth/sign-in">
                <Button
                  variant="outline"
                  className="w-full border-slate-600 text-slate-200 hover:bg-slate-700"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 overflow-y-auto">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
            <span className="text-2xl font-bold text-white">VP</span>
          </div>
          <CardTitle className="text-2xl text-white">Forgot Password?</CardTitle>
          <CardDescription className="text-slate-400">
            Enter your email and we'll help you reset your password
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
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">Reset Method</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-2 gap-4"
                      >
                        <div className="relative">
                          <RadioGroupItem
                            value="email"
                            id="email"
                            className="peer sr-only"
                          />
                          <label
                            htmlFor="email"
                            className="flex flex-col items-center justify-center rounded-lg border-2 border-slate-600 bg-slate-700/30 p-4 hover:bg-slate-700/50 cursor-pointer peer-checked:border-amber-500 peer-checked:bg-amber-500/10"
                          >
                            <Mail className="h-6 w-6 text-amber-400 mb-2" />
                            <span className="text-sm font-medium text-slate-200">Email</span>
                            <span className="text-xs text-slate-400">Reset link</span>
                          </label>
                        </div>
                        <div className="relative">
                          <RadioGroupItem
                            value="sms"
                            id="sms"
                            className="peer sr-only"
                          />
                          <label
                            htmlFor="sms"
                            className="flex flex-col items-center justify-center rounded-lg border-2 border-slate-600 bg-slate-700/30 p-4 hover:bg-slate-700/50 cursor-pointer peer-checked:border-amber-500 peer-checked:bg-amber-500/10"
                          >
                            <Smartphone className="h-6 w-6 text-amber-400 mb-2" />
                            <span className="text-sm font-medium text-slate-200">SMS</span>
                            <span className="text-xs text-slate-400">6-digit code</span>
                          </label>
                        </div>
                      </RadioGroup>
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
                    Sending...
                  </>
                ) : (
                  'Send Reset Instructions'
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
