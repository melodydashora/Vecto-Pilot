// client/src/pages/co-pilot/DonatePage.tsx
// Donate page — development costs, investment breakdown, and donation CTA
//
// 2026-04-05: Rewritten to show unique Donate content (was duplicate of About).

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Heart,
  DollarSign,
  Users,
  ArrowRight,
} from 'lucide-react';

const DONATION_LINK = 'https://square.link/u/6PbBaNCi?src=sheet';

export default function DonatePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24 space-y-6" data-testid="donate-page">
      {/* Hero CTA */}
      <Card className="border-0 bg-gradient-to-r from-rose-50 to-pink-50 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-rose-100">
              <Heart className="w-8 h-8 text-rose-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Help Keep Vecto Pilot Alive</h1>
              <p className="text-gray-700 mb-4">
                Vecto Pilot was built from the ground up to help rideshare drivers earn more safely
                and efficiently. Every dollar supports continuous development, infrastructure, and
                our mission to help families get home safer.
              </p>
              <Button
                size="lg"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => window.open(DONATION_LINK, '_blank')}
              >
                <Heart className="w-5 h-5 mr-2" />
                Donate Now
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Investment Breakdown */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-600" />
          Development Investment
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Out-of-Pocket Costs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Out-of-Pocket Expenses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">API Keys & Services</span>
                <Badge variant="secondary">$1,200+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Claude Opus 4.6 (Strategic Analysis)</span>
                <Badge variant="secondary">$800+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Gemini 3.1 Pro (Briefing & Research)</span>
                <Badge variant="secondary">$500+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">GPT-5.4 (Tactical Consolidation)</span>
                <Badge variant="secondary">$700+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">OpenAI GPT-5.2 Realtime (Voice)</span>
                <Badge variant="secondary">$400+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Perplexity Sonar Pro (Research)</span>
                <Badge variant="secondary">$600+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Google APIs (Maps, Places, Weather)</span>
                <Badge variant="secondary">$400+</Badge>
              </div>
              <div className="border-t pt-3 flex justify-between items-center font-semibold">
                <span>Total Out-of-Pocket</span>
                <Badge className="bg-blue-600 text-white">$6,000+</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Infrastructure & Planning */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Infrastructure & Planning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Replit Hosting (Monthly)</span>
                <Badge variant="secondary">$40/mo</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">6 Months Architectural Planning</span>
                <Badge variant="secondary">~500 hrs</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Database & Postgres Optimization</span>
                <Badge variant="secondary">~100 hrs</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Production Bug Fixes & Deployment</span>
                <Badge variant="secondary">~150 hrs</Badge>
              </div>
              <div className="border-t pt-3">
                <p className="text-sm text-gray-600">
                  <strong>Monthly Hosting:</strong> $40
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Every contribution extends capability and stability
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cost Per User */}
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5 text-amber-600" />
            Investment Per Active Driver
          </CardTitle>
          <CardDescription>At current scale</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 bg-white rounded-lg border border-amber-100">
              <p className="text-4xl font-bold text-amber-600">~$125-$250</p>
              <p className="text-sm text-gray-600 mt-2">
                Per driver to build, host, and maintain the entire platform with cutting-edge AI models
              </p>
            </div>
            <p className="text-sm text-gray-700">
              Each contribution brings this cost down and enables us to:
            </p>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>Add more drivers without compromising quality</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>Expand to new markets and regions</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>Implement advanced safety and earnings features</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Final CTA */}
      <Card>
        <CardContent className="p-6 text-center">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Help?</h3>
          <p className="text-gray-600 mb-6">
            Every contribution — big or small — keeps Vecto Pilot growing and helps more drivers succeed.
          </p>
          <Button
            size="lg"
            className="bg-rose-600 hover:bg-rose-700 text-white"
            onClick={() => window.open(DONATION_LINK, '_blank')}
          >
            <Heart className="w-5 h-5 mr-2" />
            Support Vecto Pilot
          </Button>
          <p className="text-xs text-gray-500 mt-4">
            Donations via Square. Secure and fast.
          </p>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500">
        <p>Vecto Pilot™ — Built with care for rideshare drivers worldwide</p>
      </div>
    </div>
  );
}
