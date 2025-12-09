/**
 * Vecto Pilot™ - Donation/About Tab
 * 
 * Showcases the project complexity, development investment, and vision for helping
 * families and individuals achieve better quality of life through smarter earning.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Heart, 
  Code2, 
  TrendingUp, 
  Clock, 
  Zap,
  MapPin,
  Users,
  Lightbulb,
  DollarSign,
  ArrowRight,
  ChevronDown,
  HelpCircle
} from 'lucide-react';
import { InstructionsTab } from './InstructionsTab';

interface DonationTabProps {
  userId?: string;
}

export const DonationTab: React.FC<DonationTabProps> = ({ userId: _userId }) => {
  const [showInstructions, setShowInstructions] = useState(false);
  const donationLink = 'https://square.link/u/6PbBaNCi?src=sheet';

  return (
    <div className="space-y-6 pb-8">
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

      {/* Instructions Content */}
      {showInstructions && (
        <div className="bg-white rounded-lg border border-blue-200 p-6">
          <InstructionsTab />
        </div>
      )}

      {/* Hero Section */}
      <Card className="border-0 bg-gradient-to-r from-rose-50 to-pink-50 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-rose-100">
              <Heart className="w-8 h-8 text-rose-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Help Keep Vecto Pilot Alive</h1>
              <p className="text-gray-700 mb-4">
                Vecto Pilot was built from the ground up to help rideshare drivers earn more safely and efficiently. Every dollar supports continuous development, infrastructure, and our mission to help families get home safer.
              </p>
              <Button 
                size="lg"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => window.open(donationLink, '_blank')}
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
                <span className="text-gray-700">Anthropic Claude (Strategic Analysis)</span>
                <Badge variant="secondary">$800+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Perplexity Sonar Pro (Research)</span>
                <Badge variant="secondary">$600+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">OpenAI GPT-5.1 & Realtime (Voice)</span>
                <Badge variant="secondary">$900+</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Google APIs (Maps, Places, Weather)</span>
                <Badge variant="secondary">$400+</Badge>
              </div>
              <div className="border-t pt-3 flex justify-between items-center font-semibold">
                <span>Total Out-of-Pocket</span>
                <Badge className="bg-blue-600 text-white">$5,000+</Badge>
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

      {/* Architectural Complexity */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-purple-600" />
          Technical Complexity Delivered
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
              <p>✓ Claude Sonnet 4.5 (Strategic Analysis)</p>
              <p>✓ Perplexity Sonar Pro (Real-time Research)</p>
              <p>✓ GPT-5.1 (Tactical Consolidation)</p>
              <p>✓ OpenAI Realtime (Voice Chat)</p>
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
              <p>✓ Live Google Maps Integration</p>
              <p>✓ Real-time Traffic Overlay</p>
              <p>✓ Event & News Briefing System</p>
              <p>✓ Weather & Air Quality Data</p>
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
              <p>✓ Venue Intelligence API</p>
              <p>✓ Staging Area Detection</p>
              <p>✓ Closed Venue Reasoning</p>
              <p>✓ Historical Feedback Loop</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Vision Statement */}
      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-green-600" />
            Our Vision
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-gray-700">
          <p>
            <strong>Vecto Pilot isn't just about making more money—it's about quality of life.</strong>
          </p>
          <p>
            Every rideshare driver deserves tools that help them work smarter, not harder. We believe in:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Families getting home safer</strong> - Better planning, fewer miles, less fatigue</span>
            </li>
            <li className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Time reclaimed</strong> - Spend less time searching, more time earning</span>
            </li>
            <li className="flex items-start gap-2">
              <DollarSign className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Financial empowerment</strong> - Data-driven decisions, not guesswork</span>
            </li>
            <li className="flex items-start gap-2">
              <Users className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span><strong>Community support</strong> - Continuous updates and new features</span>
            </li>
          </ul>
          <p className="text-sm italic text-gray-600 mt-4">
            Your donation directly supports this mission. Thank you for believing in better tools for better lives.
          </p>
        </CardContent>
      </Card>

      {/* CTA */}
      <Card>
        <CardContent className="p-6 text-center">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Help?</h3>
          <p className="text-gray-600 mb-6">
            Every contribution—big or small—keeps Vecto Pilot growing and helps more drivers succeed.
          </p>
          <Button 
            size="lg"
            className="bg-rose-600 hover:bg-rose-700 text-white"
            onClick={() => window.open(donationLink, '_blank')}
          >
            <Heart className="w-5 h-5 mr-2" />
            Support Vecto Pilot
          </Button>
          <p className="text-xs text-gray-500 mt-4">
            Donations via Square. Secure and fast.
          </p>
        </CardContent>
      </Card>

      {/* System Diagnostics Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-blue-600" />
            System Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button 
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch('/api/diagnostic/identity');
                const data = await res.json();
                
                // Format the JSON nicely
                const formatted = JSON.stringify(data, null, 2);
                
                // Open in new window with formatted text
                const newWindow = window.open('', '_blank');
                if (newWindow) {
                  newWindow.document.write(`
                    <html>
                      <head>
                        <title>System Identity Diagnostics</title>
                        <style>
                          body { 
                            font-family: monospace; 
                            padding: 20px; 
                            background: #1e1e1e; 
                            color: #d4d4d4;
                          }
                          pre { 
                            white-space: pre-wrap; 
                            word-wrap: break-word;
                            background: #252526;
                            padding: 15px;
                            border-radius: 5px;
                            border: 1px solid #3e3e42;
                          }
                          h1 {
                            color: #4ec9b0;
                            margin-bottom: 20px;
                          }
                        </style>
                      </head>
                      <body>
                        <h1>🔍 System Identity Diagnostics</h1>
                        <pre>${formatted}</pre>
                      </body>
                    </html>
                  `);
                }
              } catch (err) {
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

      {/* Footer note */}
      <div className="text-center text-xs text-gray-500">
        <p>Vecto Pilot™ - Built with care for rideshare drivers worldwide</p>
        <p className="mt-1">6 months of planning • 750+ hours of development • 3 advanced AI models</p>
      </div>
    </div>
  );
};

export default DonationTab;
