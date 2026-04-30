// client/src/pages/co-pilot/AboutPage.tsx
<<<<<<< HEAD
// Wrapper page for the About/Donation tab (static page, no header)

import React from 'react';
import { DonationTab } from '@/components/DonationTab';
import { Link } from 'react-router-dom';

export default function AboutPage() {
  const userId = localStorage.getItem('vecto_user_id') || 'default';

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="about-page">
      <DonationTab userId={userId} />

      {/* Privacy Policy Link */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
=======
// About page — product info, mission, and technical details
//
// 2026-04-05: Rewritten to show unique About content (was duplicate of Donate).

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Heart,
  Code2,
  Zap,
  MapPin,
  Lightbulb,
  TrendingUp,
  Clock,
  DollarSign,
  Users,
  ChevronDown,
  HelpCircle,
  Shield,
  Car,
} from 'lucide-react';
import { InstructionsTab } from '@/components/InstructionsTab';
import { API_ROUTES } from '@/constants/apiRoutes';
import { Link } from 'react-router-dom';

export default function AboutPage() {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24 space-y-6" data-testid="about-page">
      {/* How to Use - Collapsible */}
      <Card
        className="border-blue-200 bg-blue-50 cursor-pointer hover:bg-blue-100 transition"
        onClick={() => setShowInstructions(!showInstructions)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HelpCircle className="w-5 h-5 text-blue-600" />
              <CardTitle className="text-base">How to Use Vecto Pilot</CardTitle>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-blue-600 transition-transform ${
                showInstructions ? 'rotate-180' : ''
              }`}
            />
          </div>
        </CardHeader>
      </Card>
      {showInstructions && (
        <div className="bg-white rounded-lg border border-blue-200 p-6">
          <InstructionsTab />
        </div>
      )}

      {/* Hero — What is Vecto Pilot */}
      <Card className="border-0 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-blue-100">
              <Car className="w-8 h-8 text-blue-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">What is Vecto Pilot?</h1>
              <p className="text-gray-700 mb-3">
                Vecto Pilot is a <strong>strategic rideshare assistant</strong> that combines real-time data,
                multi-model AI, and driver intelligence to help you earn more while driving less.
                Instead of guessing where to go next, you get AI-powered briefings tailored to your
                exact location, time of day, and local events.
              </p>
              <p className="text-gray-600 text-sm">
                Built by a rideshare driver, for rideshare drivers — every feature solves a real problem
                experienced on the road.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Technical Complexity */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-purple-600" />
          Under the Hood
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-600" />
                Multi-Model AI Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>Five specialised AI models work together — strategic analysis, briefing research,
                 tactical consolidation, voice interaction, and deep web research — so you get
                 actionable advice, not generic tips.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="w-4 h-4 text-purple-600" />
                Real-Time Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>Live Google Maps integration, real-time traffic overlay, event and news briefing
                 system, plus weather and air quality data — all fused into one snapshot of your
                 driving environment.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-purple-600" />
                Smart Venue Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>Venue intelligence API with staging-area detection, closed-venue reasoning,
                 and a historical feedback loop that gets smarter the more you drive.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Vision Statement */}
      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-green-600" />
            Our Mission
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-gray-700">
          <p>
            <strong>Vecto Pilot isn't just about making more money — it's about quality of life.</strong>
          </p>
          <p>
            Every rideshare driver deserves tools that help them work smarter, not harder. We believe in:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Families getting home safer</strong> — Better planning, fewer miles, less fatigue</span>
            </li>
            <li className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Time reclaimed</strong> — Spend less time searching, more time earning</span>
            </li>
            <li className="flex items-start gap-2">
              <DollarSign className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Financial empowerment</strong> — Data-driven decisions, not guesswork</span>
            </li>
            <li className="flex items-start gap-2">
              <Users className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Community support</strong> — Continuous updates driven by real driver feedback</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* System Diagnostics */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            System Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch(API_ROUTES.DIAGNOSTIC.IDENTITY);
                const data = await res.json();
                const formatted = JSON.stringify(data, null, 2);
                const newWindow = window.open('', '_blank');
                if (newWindow) {
                  newWindow.document.write(`
                    <html>
                      <head>
                        <title>System Identity Diagnostics</title>
                        <style>
                          body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
                          pre { white-space: pre-wrap; word-wrap: break-word; background: #252526; padding: 15px; border-radius: 5px; border: 1px solid #3e3e42; }
                          h1 { color: #4ec9b0; margin-bottom: 20px; }
                        </style>
                      </head>
                      <body>
                        <h1>System Identity Diagnostics</h1>
                        <pre>${formatted}</pre>
                      </body>
                    </html>
                  `);
                }
              } catch (err: any) {
                alert('Failed to fetch diagnostics: ' + err.message);
              }
            }}
            className="w-full"
          >
            <Zap className="w-4 h-4 mr-2" />
            View System Identity
          </Button>
          <p className="text-xs text-gray-600 mt-2">
            Shows which AI systems are active, authentication status, and routing configuration
          </p>
        </CardContent>
      </Card>

      {/* Privacy Policy Link */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 text-center">
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
        <Link to="/co-pilot/policy" className="text-blue-500 hover:text-blue-600 text-sm">
          Privacy Policy
        </Link>
      </div>
<<<<<<< HEAD
=======

      {/* Footer */}
      <div className="text-center text-xs text-gray-500">
        <p>Vecto Pilot™ — Built with care for rideshare drivers worldwide</p>
        <p className="mt-1">6 months of planning · 750+ hours of development · 5 advanced AI models</p>
      </div>
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
    </div>
  );
}
