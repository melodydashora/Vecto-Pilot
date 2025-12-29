// client/src/pages/auth/TermsPage.tsx
// Terms and Conditions page

import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Shield, AlertTriangle, Lock, Scale, Ban, FileText } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Terms of Use</h1>
          <p className="text-slate-400">Last updated: December 2024</p>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Shield className="w-5 h-5 text-amber-400" />
              1. Service Description
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p>
              EngelPilot provides AI-powered recommendations and strategic insights for rideshare drivers.
              Our service analyzes various data points including weather, events, traffic patterns, and
              historical trends to suggest optimal driving strategies.
            </p>
            <p>
              The recommendations provided are intended to help drivers make informed decisions about
              when and where to drive. However, all final decisions remain solely with the driver.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Ban className="w-5 h-5 text-amber-400" />
              2. No Platform Affiliation
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p className="font-semibold text-amber-400">
              EngelPilot is NOT affiliated with, endorsed by, or sponsored by Uber, Lyft, or any
              other rideshare platform.
            </p>
            <p>
              All rideshare platform names, logos, and trademarks mentioned in our service are the
              property of their respective owners. We use these names solely to help drivers
              identify which platforms they operate on.
            </p>
            <p>
              EngelPilot is an independent third-party service that provides strategic recommendations
              based on publicly available data and proprietary analysis.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              3. No Guarantees
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p className="font-semibold text-red-400">
              We make NO guarantees about earnings, ride availability, or accuracy of recommendations.
            </p>
            <p>
              Rideshare earnings depend on many factors outside our control, including but not limited to:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Real-time rider demand in your area</li>
              <li>Number of drivers currently active</li>
              <li>Surge pricing availability</li>
              <li>Traffic conditions</li>
              <li>Weather changes</li>
              <li>Platform-specific policies and promotions</li>
            </ul>
            <p>
              Use our recommendations at your own discretion. Past performance or patterns do not
              guarantee future results.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Lock className="w-5 h-5 text-amber-400" />
              4. Data Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p className="font-semibold text-green-400">
              We do NOT sell your personal data to third parties.
            </p>
            <p>Your data is used solely for the following purposes:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Providing personalized driving recommendations based on your location and preferences</li>
              <li>Improving our AI models and service quality</li>
              <li>Sending you important service updates (if you've opted in)</li>
            </ul>
            <p>
              Location data is used in real-time to provide relevant recommendations and is processed
              in accordance with our Privacy Policy.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Scale className="w-5 h-5 text-amber-400" />
              5. Account Termination
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p>
              We reserve the right to suspend or terminate your account at any time for:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Violations of these Terms of Use</li>
              <li>Fraudulent or abusive behavior</li>
              <li>Attempting to manipulate or exploit our service</li>
              <li>Any other reason at our sole discretion</li>
            </ul>
            <p>
              You may also close your account at any time by contacting our support team.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              6. Limitation of Liability
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p className="font-semibold">
              EngelPilot is provided "AS IS" without warranties of any kind, either express or implied.
            </p>
            <p>
              We are not liable for any direct, indirect, incidental, special, consequential, or
              punitive damages arising from:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Your use of or inability to use the service</li>
              <li>Any recommendations provided by the service</li>
              <li>Inaccurate or delayed information</li>
              <li>Any earnings loss or business decisions based on our recommendations</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardContent className="pt-6">
            <p className="text-slate-300 text-center">
              By creating an account, you acknowledge that you have read, understood, and agree
              to these Terms of Use.
            </p>
            <p className="text-slate-400 text-center mt-2 text-sm">
              If you have any questions about these terms, please contact us at{' '}
              <a href="mailto:support@engelpilot.com" className="text-amber-400 hover:text-amber-300">
                support@engelpilot.com
              </a>
            </p>
          </CardContent>
        </Card>

        {/* Back button */}
        <div className="text-center">
          <Link to="/auth/sign-up">
            <Button
              variant="outline"
              className="border-slate-600 text-slate-200 hover:bg-slate-700"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sign Up
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
