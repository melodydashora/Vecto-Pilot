/**
 * Vecto Pilot™ - Getting Started Instructions
 * 
 * User-friendly guide for each tab and how to use the app
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronDown,
  Sparkles,
  TrendingUp,
  MessageSquare,
  MapIcon,
  Wine,
  Heart,
  MapPin,
  Clock,
  DollarSign,
  Zap,
  MessageCircle
} from 'lucide-react';
import { useState } from 'react';

export const InstructionsTab: React.FC = () => {
  const [expandedTab, setExpandedTab] = useState<string | null>(null);

  const toggleTab = (tabName: string) => {
    setExpandedTab(expandedTab === tabName ? null : tabName);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Hero Section */}
      <Card className="border-0 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm">
        <CardContent className="p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">How to Use Vecto Pilot</h1>
          <p className="text-gray-700 mb-4">
            Vecto Pilot helps you make smarter rideshare decisions in real-time. Start by enabling location, then watch as AI-powered recommendations appear across 5 easy-to-use tabs.
          </p>
          <div className="bg-white rounded-lg p-4 border border-blue-100">
            <p className="text-sm text-gray-600">
              <strong>✨ Quick Start:</strong> Allow location access → Get a strategy recommendation → Explore venues, briefings, and the interactive map
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <button
          onClick={() => toggleTab('strategy')}
          className="p-3 rounded-lg border border-blue-200 hover:bg-blue-50 transition text-center"
        >
          <Sparkles className="w-5 h-5 text-blue-600 mx-auto mb-1" />
          <p className="text-xs font-semibold text-gray-800">Strategy</p>
        </button>
        <button
          onClick={() => toggleTab('venues')}
          className="p-3 rounded-lg border border-purple-200 hover:bg-purple-50 transition text-center"
        >
          <TrendingUp className="w-5 h-5 text-purple-600 mx-auto mb-1" />
          <p className="text-xs font-semibold text-gray-800">Venues</p>
        </button>
        <button
          onClick={() => toggleTab('briefing')}
          className="p-3 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition text-center"
        >
          <MessageSquare className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
          <p className="text-xs font-semibold text-gray-800">Briefing</p>
        </button>
        <button
          onClick={() => toggleTab('map')}
          className="p-3 rounded-lg border border-green-200 hover:bg-green-50 transition text-center"
        >
          <MapIcon className="w-5 h-5 text-green-600 mx-auto mb-1" />
          <p className="text-xs font-semibold text-gray-800">Map</p>
        </button>
        <button
          onClick={() => toggleTab('about')}
          className="p-3 rounded-lg border border-rose-200 hover:bg-rose-50 transition text-center"
        >
          <Heart className="w-5 h-5 text-rose-600 mx-auto mb-1" />
          <p className="text-xs font-semibold text-gray-800">About</p>
        </button>
      </div>

      {/* Tab Guides */}
      <div className="space-y-3">
        {/* Strategy Tab */}
        <Card
          className={`cursor-pointer transition border-2 ${
            expandedTab === 'strategy'
              ? 'border-blue-400 bg-blue-50'
              : 'border-blue-100 hover:border-blue-300'
          }`}
          onClick={() => toggleTab('strategy')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Tab 1: Strategy</CardTitle>
                  <CardDescription>Your personalized earning recommendation</CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 transition-transform ${
                  expandedTab === 'strategy' ? 'rotate-180' : ''
                }`}
              />
            </div>
          </CardHeader>
          {expandedTab === 'strategy' && (
            <CardContent className="space-y-4 pt-0">
              <div className="bg-white rounded-lg p-4 space-y-3">
                <p className="font-semibold text-gray-900">What you'll see:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>AI-Generated Strategy</strong> - Claude Sonnet 4.5 analyzes your location, weather, events, and traffic to give you a strategic briefing</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Time-Based Insights</strong> - Recommendations update every time you move to a new location</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>Live Status</strong> - Watch the progress bar as AI models generate your recommendations (usually 1-2 minutes)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span><strong>AI Coach Chat</strong> - Talk to the AI coach (voice or text) to ask questions about your strategy</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-600 italic pt-2">
                  💡 <strong>Pro tip:</strong> Scroll down to see Smart Blocks (specific venue recommendations) below the strategy
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Venues Tab */}
        <Card
          className={`cursor-pointer transition border-2 ${
            expandedTab === 'venues'
              ? 'border-purple-400 bg-purple-50'
              : 'border-purple-100 hover:border-purple-300'
          }`}
          onClick={() => toggleTab('venues')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100">
                  <Wine className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Tab 2: Venues</CardTitle>
                  <CardDescription>Bars & high-volume restaurants near you</CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 transition-transform ${
                  expandedTab === 'venues' ? 'rotate-180' : ''
                }`}
              />
            </div>
          </CardHeader>
          {expandedTab === 'venues' && (
            <CardContent className="space-y-4 pt-0">
              <div className="bg-white rounded-lg p-4 space-y-3">
                <p className="font-semibold text-gray-900">What you'll see:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-600 font-bold">•</span>
                    <span><strong>Bars & Restaurants</strong> - Real-time venue data sorted by expense level ($$$$→$)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-600 font-bold">•</span>
                    <span><strong>Last-Call Alerts</strong> - See when venues are about to close (critical for late-night surge)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-600 font-bold">•</span>
                    <span><strong>Operating Hours</strong> - Know exactly when each venue closes so you don't waste time</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-600 font-bold">•</span>
                    <span><strong>Thumbs Up/Down</strong> - Rate venues to help the AI learn what works best for you</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-600 italic pt-2">
                  💡 <strong>Pro tip:</strong> Use this tab to find backup venues when your primary location gets slow
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Briefing Tab */}
        <Card
          className={`cursor-pointer transition border-2 ${
            expandedTab === 'briefing'
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-indigo-100 hover:border-indigo-300'
          }`}
          onClick={() => toggleTab('briefing')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-100">
                  <MessageSquare className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Tab 3: Briefing</CardTitle>
                  <CardDescription>News, weather, and traffic intel</CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 transition-transform ${
                  expandedTab === 'briefing' ? 'rotate-180' : ''
                }`}
              />
            </div>
          </CardHeader>
          {expandedTab === 'briefing' && (
            <CardContent className="space-y-4 pt-0">
              <div className="bg-white rounded-lg p-4 space-y-3">
                <p className="font-semibold text-gray-900">What you'll see:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span>
                    <span><strong>News & Events</strong> - Concerts, games, parades, watch parties happening today/tonight</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span>
                    <span><strong>Weather Forecast</strong> - Current conditions + 6-hour outlook (impacts driver behavior)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span>
                    <span><strong>Traffic Conditions</strong> - Real-time congestion levels in your area</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span>
                    <span><strong>AI-Filtered Content</strong> - Only shows events and info relevant to rideshare drivers</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-600 italic pt-2">
                  💡 <strong>Pro tip:</strong> Check this before moving to a new area—major events = more demand
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Map Tab */}
        <Card
          className={`cursor-pointer transition border-2 ${
            expandedTab === 'map'
              ? 'border-green-400 bg-green-50'
              : 'border-green-100 hover:border-green-300'
          }`}
          onClick={() => toggleTab('map')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <MapIcon className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Tab 4: Map</CardTitle>
                  <CardDescription>Visual venue map with live traffic</CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 transition-transform ${
                  expandedTab === 'map' ? 'rotate-180' : ''
                }`}
              />
            </div>
          </CardHeader>
          {expandedTab === 'map' && (
            <CardContent className="space-y-4 pt-0">
              <div className="bg-white rounded-lg p-4 space-y-3">
                <p className="font-semibold text-gray-900">What you'll see:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Your Location</strong> - Blue marker showing where you are right now</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Venue Pins</strong> - Color-coded: 🔴 Grade A (best) → 🟠 Grade B → 🟡 Grade C+</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Live Traffic</strong> - Real-time road conditions (red = slow, green = fast)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Click to Details</strong> - Tap any pin to see distance, drive time, and earnings estimate</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Pinch to Zoom</strong> - Use two fingers to zoom in/out (or scroll on desktop)</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-600 italic pt-2">
                  💡 <strong>Pro tip:</strong> Watch the map as you move to see venue grades change based on drive time and earnings
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* About Tab */}
        <Card
          className={`cursor-pointer transition border-2 ${
            expandedTab === 'about'
              ? 'border-rose-400 bg-rose-50'
              : 'border-rose-100 hover:border-rose-300'
          }`}
          onClick={() => toggleTab('about')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-100">
                  <Heart className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Tab 5: About</CardTitle>
                  <CardDescription>Support the app and learn more</CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 transition-transform ${
                  expandedTab === 'about' ? 'rotate-180' : ''
                }`}
              />
            </div>
          </CardHeader>
          {expandedTab === 'about' && (
            <CardContent className="space-y-4 pt-0">
              <div className="bg-white rounded-lg p-4 space-y-3">
                <p className="font-semibold text-gray-900">What you'll find:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 font-bold">•</span>
                    <span><strong>Project Impact</strong> - See the $5k+ investment and 750+ hours of development that went into this</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 font-bold">•</span>
                    <span><strong>Donation Link</strong> - Support ongoing development, hosting, and new features</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 font-bold">•</span>
                    <span><strong>Our Mission</strong> - Help families get home safer by enabling smarter driver earnings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 font-bold">•</span>
                    <span><strong>Technical Details</strong> - Learn about the AI models and complexity behind the scenes</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-600 italic pt-2">
                  💡 <strong>Why it matters:</strong> Your donation helps expand to more drivers and adds new safety features
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Getting Started Steps */}
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-600" />
            5-Minute Getting Started Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { step: 1, title: 'Enable Location', desc: 'Click "Allow" when the app asks for your location. This is required for all features.' },
            { step: 2, title: 'Check the Strategy Tab', desc: 'Watch the progress bar (1-2 min) as Claude, Perplexity, and GPT-5.1 generate your personalized recommendation.' },
            { step: 3, title: 'Explore Smart Blocks', desc: 'Scroll down to see specific venues with earnings estimates, drive times, and ratings.' },
            { step: 4, title: 'Use the Map', desc: 'Switch to the Map tab to see all venues at a glance with live traffic overlays.' },
            { step: 5, title: 'Read the Briefing', desc: 'Check news/events and weather to understand what\'s driving demand in your area.' },
          ].map((item) => (
            <div key={item.step} className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-sm">
                {item.step}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{item.title}</p>
                <p className="text-sm text-gray-600 mt-1">{item.desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Feedback Section */}
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            <p className="text-gray-700">Questions? Use the thumbs up/down on venues to send feedback</p>
          </div>
          <p className="text-xs text-gray-500">
            Every rating helps train the AI to get better at recommendations
          </p>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500">
        <p>Ready to earn smarter? Start by allowing location access.</p>
        <p className="mt-1">Questions? Check the About tab for more details.</p>
      </div>
    </div>
  );
};

export default InstructionsTab;
