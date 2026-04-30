/**
 * Vecto Pilot™ - Getting Started Instructions
<<<<<<< HEAD
 * 
 * User-friendly guide for each tab and how to use the app
 */

import React from 'react';
=======
 *
 * 2026-04-05: Rewritten to cover all 7 bottom tabs + 5 hamburger menu items.
 * Accurate descriptions for each feature, globally applicable (not region-specific).
 */

import React, { useState } from 'react';
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChevronDown,
  Sparkles,
<<<<<<< HEAD
  TrendingUp,
  MessageSquare,
  MapIcon,
  Wine,
  Heart,
  Zap,
  MessageCircle
} from 'lucide-react';
import { useState } from 'react';
=======
  Wine,
  MessageSquare,
  Map as MapIcon,
  Target,
  Languages,
  QrCode,
  Settings,
  Calendar,
  Info,
  Heart,
  HelpCircle,
  Zap,
} from 'lucide-react';

// ─── Tab/menu item configuration ──────────────────────────────────────────

interface GuideItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  classes: {
    inactive: string;
    active: string;
    dot: string;
    iconBg: string;
    icon: string;
    nav: string;
  };
  items: { label: string; desc: string }[];
  tip: string;
}

// Bottom navigation tabs (always visible at bottom of screen)
const BOTTOM_TABS: GuideItem[] = [
  {
    id: 'strategy',
    title: 'Strategy',
    subtitle: 'Your personalised earning recommendation',
    icon: Sparkles,
    classes: {
      inactive: 'border-blue-100 hover:border-blue-300',
      active: 'border-blue-400 bg-blue-50',
      dot: 'text-blue-600',
      iconBg: 'bg-blue-100',
      icon: 'text-blue-600',
      nav: 'border-blue-200 hover:bg-blue-50',
    },
    items: [
      { label: 'AI-Generated Strategy', desc: 'Analyses your location, weather, events, and traffic to build a strategic briefing tailored to right now' },
      { label: 'Time-Based Updates', desc: 'Your strategy refreshes as conditions change — new events, weather shifts, or traffic patterns' },
      { label: 'Smart Blocks', desc: 'Scroll down for specific venue recommendations with earnings estimates and drive times' },
      { label: 'Coach', desc: 'Tap the chat icon to ask questions about your strategy — by voice or text' },
    ],
    tip: 'Allow location access for accurate recommendations. Strategy takes 1–2 minutes on first load.',
  },
  {
    id: 'venues',
    title: 'Lounges & Bars',
    subtitle: 'High-volume venues sorted by earning potential',
    icon: Wine,
    classes: {
      inactive: 'border-purple-100 hover:border-purple-300',
      active: 'border-purple-400 bg-purple-50',
      dot: 'text-purple-600',
      iconBg: 'bg-purple-100',
      icon: 'text-purple-600',
      nav: 'border-purple-200 hover:bg-purple-50',
    },
    items: [
      { label: 'Venue List', desc: 'Bars, lounges, and restaurants near you sorted by expense level and earning potential' },
      { label: 'Last-Call Alerts', desc: 'See when venues are about to close — critical for catching the post-close rush' },
      { label: 'Operating Hours', desc: 'Know exactly when each venue opens and closes so you avoid waiting at empty spots' },
      { label: 'Thumbs Up/Down', desc: 'Rate venues to help the AI learn what works best in your market' },
    ],
    tip: 'Use this to find backup venues when your primary location gets slow.',
  },
  {
    id: 'briefing',
    title: 'Briefing',
    subtitle: 'News, events, weather, and traffic intel',
    icon: MessageSquare,
    classes: {
      inactive: 'border-indigo-100 hover:border-indigo-300',
      active: 'border-indigo-400 bg-indigo-50',
      dot: 'text-indigo-600',
      iconBg: 'bg-indigo-100',
      icon: 'text-indigo-600',
      nav: 'border-indigo-200 hover:bg-indigo-50',
    },
    items: [
      { label: 'News & Events', desc: 'Concerts, sports, festivals, and local events happening today — anything that drives ride demand' },
      { label: 'Weather Forecast', desc: 'Current conditions plus a multi-hour outlook — rain and cold increase ride requests' },
      { label: 'Traffic Conditions', desc: 'Real-time congestion in your area so you can plan routes and avoid dead zones' },
      { label: 'AI-Filtered Content', desc: 'Only shows information relevant to rideshare drivers — no noise' },
    ],
    tip: 'Check this before heading to a new area. Major events = more demand.',
  },
  {
    id: 'map',
    title: 'Map',
    subtitle: 'Visual venue map with live traffic overlay',
    icon: MapIcon,
    classes: {
      inactive: 'border-green-100 hover:border-green-300',
      active: 'border-green-400 bg-green-50',
      dot: 'text-green-600',
      iconBg: 'bg-green-100',
      icon: 'text-green-600',
      nav: 'border-green-200 hover:bg-green-50',
    },
    items: [
      { label: 'Your Location', desc: 'Blue marker showing where you are right now' },
      { label: 'Venue Pins', desc: 'Colour-coded markers showing nearby venues graded by earning potential' },
      { label: 'Live Traffic', desc: 'Real-time road conditions overlay — red means slow, green means clear' },
      { label: 'Tap for Details', desc: 'Tap any venue pin to see distance, drive time, and more info' },
    ],
    tip: 'Pinch to zoom on mobile. Venue grades update as you move around your market.',
  },
  {
    id: 'intel',
    title: 'Intel',
    subtitle: 'Market intelligence and ride analytics',
    icon: Target,
    classes: {
      inactive: 'border-amber-100 hover:border-amber-300',
      active: 'border-amber-400 bg-amber-50',
      dot: 'text-amber-600',
      iconBg: 'bg-amber-100',
      icon: 'text-amber-600',
      nav: 'border-amber-200 hover:bg-amber-50',
    },
    items: [
      { label: 'Market Insights', desc: 'Data-driven intelligence about your local rideshare market' },
      { label: 'Demand Patterns', desc: 'Understand when and where ride requests peak in your area' },
      { label: 'Driver Intel', desc: 'Actionable information gathered from venue data, events, and historical patterns' },
    ],
    tip: 'Use Intel alongside Strategy for a complete picture of your market.',
  },
  {
    id: 'translate',
    title: 'Translate',
    subtitle: 'Real-time rider translation in 15 languages',
    icon: Languages,
    classes: {
      inactive: 'border-sky-100 hover:border-sky-300',
      active: 'border-sky-400 bg-sky-50',
      dot: 'text-sky-600',
      iconBg: 'bg-sky-100',
      icon: 'text-sky-600',
      nav: 'border-sky-200 hover:bg-sky-50',
    },
    items: [
      { label: 'Split-Screen Mode', desc: 'Top half faces the rider (rotated 180\u00B0), bottom half faces you — both see translations live' },
      { label: 'Voice-to-Text', desc: 'Tap the mic to speak in English; your words appear translated on the rider\'s half instantly' },
      { label: 'Rider Mic', desc: 'Rider taps their mic to speak their language — you see and hear the English translation' },
      { label: 'Quick Phrases', desc: 'Pre-loaded rideshare phrases (greetings, route, comfort, payment, safety) for tap-to-translate' },
      { label: '15 Languages', desc: 'Spanish, French, German, Japanese, Korean, Arabic, Hindi, Mandarin, and more — buttons show native-script labels' },
    ],
    tip: 'Select the rider\'s language first. If unsure, show them the picker — buttons display each language\'s native name.',
  },
  {
    id: 'concierge',
    title: 'Concierge',
    subtitle: 'Shareable driver profile and QR code',
    icon: QrCode,
    classes: {
      inactive: 'border-teal-100 hover:border-teal-300',
      active: 'border-teal-400 bg-teal-50',
      dot: 'text-teal-600',
      iconBg: 'bg-teal-100',
      icon: 'text-teal-600',
      nav: 'border-teal-200 hover:bg-teal-50',
    },
    items: [
      { label: 'Driver Card', desc: 'A professional profile card with your name, vehicle info, and contact details' },
      { label: 'QR Code', desc: 'Generate a scannable code that riders can use to verify your identity or save your info' },
      { label: 'Shareable Link', desc: 'Get a unique URL to share with regular passengers or print on business cards' },
    ],
    tip: 'Great for building a repeat client base — riders can bookmark your profile for future rides.',
  },
];

// Hamburger menu items (top-right corner)
const MENU_GUIDES: GuideItem[] = [
  {
    id: 'preferences',
    title: 'Preferences',
    subtitle: 'Customise your app experience',
    icon: Settings,
    classes: {
      inactive: 'border-gray-100 hover:border-gray-300',
      active: 'border-gray-400 bg-gray-50',
      dot: 'text-gray-600',
      iconBg: 'bg-gray-100',
      icon: 'text-gray-600',
      nav: 'border-gray-200 hover:bg-gray-50',
    },
    items: [
      { label: 'Notifications', desc: 'Control which alerts you receive and how they appear' },
      { label: 'Display', desc: 'Adjust theme, layout, and visual preferences' },
      { label: 'Location', desc: 'Manage location permissions and update frequency' },
    ],
    tip: 'Open the hamburger menu (top-right corner) to access this page.',
  },
  {
    id: 'schedule',
    title: 'Schedule',
    subtitle: 'Plan your weekly driving shifts',
    icon: Calendar,
    classes: {
      inactive: 'border-violet-100 hover:border-violet-300',
      active: 'border-violet-400 bg-violet-50',
      dot: 'text-violet-600',
      iconBg: 'bg-violet-100',
      icon: 'text-violet-600',
      nav: 'border-violet-200 hover:bg-violet-50',
    },
    items: [
      { label: 'Weekly Calendar', desc: 'Set which days and hours you plan to drive with a visual grid' },
      { label: 'Shift Preferences', desc: 'Mark preferred times: morning, afternoon, evening, or late night' },
      { label: 'AI Recommendations', desc: 'Get suggested optimal driving windows based on your market\'s demand patterns' },
    ],
    tip: 'Your schedule saves automatically. Access it anytime from the menu.',
  },
  {
    id: 'about',
    title: 'About',
    subtitle: 'Learn about the project and mission',
    icon: Info,
    classes: {
      inactive: 'border-slate-100 hover:border-slate-300',
      active: 'border-slate-400 bg-slate-50',
      dot: 'text-slate-600',
      iconBg: 'bg-slate-100',
      icon: 'text-slate-600',
      nav: 'border-slate-200 hover:bg-slate-50',
    },
    items: [
      { label: 'Our Mission', desc: 'Why Vecto Pilot exists — helping drivers work smarter, not harder' },
      { label: 'Technical Details', desc: 'The AI models and infrastructure behind every recommendation' },
      { label: 'System Diagnostics', desc: 'View which AI systems are active and their current status' },
    ],
    tip: 'Found in the hamburger menu.',
  },
  {
    id: 'donate',
    title: 'Donate',
    subtitle: 'Support ongoing development',
    icon: Heart,
    classes: {
      inactive: 'border-rose-100 hover:border-rose-300',
      active: 'border-rose-400 bg-rose-50',
      dot: 'text-rose-600',
      iconBg: 'bg-rose-100',
      icon: 'text-rose-600',
      nav: 'border-rose-200 hover:bg-rose-50',
    },
    items: [
      { label: 'Development Costs', desc: 'See the real investment — AI APIs, hosting, and hundreds of hours of development' },
      { label: 'Secure Donations', desc: 'Contribute via Square — every donation keeps the platform running and features coming' },
    ],
    tip: 'Every contribution — big or small — directly supports new features and keeps hosting alive.',
  },
  {
    id: 'help',
    title: 'Help',
    subtitle: 'This guide — how to use every feature',
    icon: HelpCircle,
    classes: {
      inactive: 'border-cyan-100 hover:border-cyan-300',
      active: 'border-cyan-400 bg-cyan-50',
      dot: 'text-cyan-600',
      iconBg: 'bg-cyan-100',
      icon: 'text-cyan-600',
      nav: 'border-cyan-200 hover:bg-cyan-50',
    },
    items: [
      { label: 'Feature Guides', desc: 'Detailed walkthrough for every tab and menu item in the app' },
      { label: 'Getting Started', desc: 'Step-by-step instructions for first-time setup' },
    ],
    tip: 'You\'re reading it right now!',
  },
];

// ─── Component ──────────────────────────────────────────────────────────
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7

export const InstructionsTab: React.FC = () => {
  const [expandedTab, setExpandedTab] = useState<string | null>(null);

<<<<<<< HEAD
  const toggleTab = (tabName: string) => {
    setExpandedTab(expandedTab === tabName ? null : tabName);
=======
  const toggleTab = (id: string) => {
    setExpandedTab(expandedTab === id ? null : id);
  };

  /** Reusable expandable guide card */
  const renderGuide = (tab: GuideItem) => {
    const isExpanded = expandedTab === tab.id;
    const Icon = tab.icon;
    return (
      <Card
        key={tab.id}
        className={`cursor-pointer transition border-2 ${isExpanded ? tab.classes.active : tab.classes.inactive}`}
        onClick={() => toggleTab(tab.id)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${tab.classes.iconBg}`}>
                <Icon className={`w-5 h-5 ${tab.classes.icon}`} />
              </div>
              <div>
                <CardTitle className="text-base">{tab.title}</CardTitle>
                <CardDescription>{tab.subtitle}</CardDescription>
              </div>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-gray-600 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </div>
        </CardHeader>
        {isExpanded && (
          <CardContent className="space-y-4 pt-0">
            <div className="bg-white rounded-lg p-4 space-y-3">
              <ul className="space-y-2 text-sm text-gray-700">
                {tab.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`${tab.classes.dot} font-bold shrink-0`}>{'\u2022'}</span>
                    <span><strong>{item.label}</strong> — {item.desc}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-600 italic pt-2">
                Tip: {tab.tip}
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    );
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Hero Section */}
      <Card className="border-0 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm">
        <CardContent className="p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">How to Use Vecto Pilot</h1>
          <p className="text-gray-700 mb-4">
<<<<<<< HEAD
            Vecto Pilot helps you make smarter rideshare decisions in real-time. Start by enabling location, then watch as AI-powered recommendations appear across 5 easy-to-use tabs.
          </p>
          <div className="bg-white rounded-lg p-4 border border-blue-100">
            <p className="text-sm text-gray-600">
              <strong>✨ Quick Start:</strong> Allow location access → Get a strategy recommendation → Explore venues, briefings, and the interactive map
=======
            Vecto Pilot helps you make smarter rideshare decisions in real time. Start by enabling
            location, then explore AI-powered recommendations across 7 tabs — plus scheduling,
            preferences, and more in the menu.
          </p>
          <div className="bg-white rounded-lg p-4 border border-blue-100">
            <p className="text-sm text-gray-600">
              <strong>Quick Start:</strong> Allow location access &rarr; Get a strategy
              recommendation &rarr; Explore venues, briefings, and the interactive map
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
            </p>
          </div>
        </CardContent>
      </Card>

<<<<<<< HEAD
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
=======
      {/* Quick Navigation — Bottom Tabs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
          Bottom Tabs
        </h2>
        <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
          {BOTTOM_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => toggleTab(tab.id)}
                className={`p-3 rounded-lg border ${tab.classes.nav} transition text-center`}
              >
                <Icon className={`w-5 h-5 ${tab.classes.icon} mx-auto mb-1`} />
                <p className="text-[11px] font-semibold text-gray-800 leading-tight">{tab.title}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Tab Guides */}
      <div className="space-y-3">
        {BOTTOM_TABS.map(renderGuide)}
      </div>

      {/* Menu Items Section */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Menu (top-right corner)
        </h2>
        <div className="space-y-3">
          {MENU_GUIDES.map(renderGuide)}
        </div>
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
      </div>

      {/* Getting Started Steps */}
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-600" />
<<<<<<< HEAD
            5-Minute Getting Started Guide
=======
            Getting Started
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
<<<<<<< HEAD
            { step: 1, title: 'Enable Location', desc: 'Click "Allow" when the app asks for your location. This is required for all features.' },
            { step: 2, title: 'Check the Strategy Tab', desc: 'Watch the progress bar (1-2 min) as Claude, Perplexity, and GPT-5.2 generate your personalized recommendation.' },
            { step: 3, title: 'Explore Smart Blocks', desc: 'Scroll down to see specific venues with earnings estimates, drive times, and ratings.' },
            { step: 4, title: 'Use the Map', desc: 'Switch to the Map tab to see all venues at a glance with live traffic overlays.' },
            { step: 5, title: 'Read the Briefing', desc: 'Check news/events and weather to understand what\'s driving demand in your area.' },
          ].map((item) => (
=======
            { step: 1, title: 'Enable Location', desc: 'Tap "Allow" when prompted. Location is required for all AI recommendations.' },
            { step: 2, title: 'Check the Strategy Tab', desc: 'Your personalised strategy generates automatically (1\u20132 minutes). Multiple AI models analyse your market in real time.' },
            { step: 3, title: 'Explore Venues & Map', desc: 'Browse the Lounges & Bars tab for venue details, or switch to the Map for a visual overview with live traffic.' },
            { step: 4, title: 'Read the Briefing', desc: 'Check news, events, and weather to understand what\u2019s driving demand in your area right now.' },
            { step: 5, title: 'Set Up Your Schedule', desc: 'Open the menu and tap Schedule to plan your weekly driving shifts and get AI-optimised time recommendations.' },
          ].map(item => (
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
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

<<<<<<< HEAD
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
=======
      {/* Footer */}
      <div className="text-center text-xs text-gray-500">
        <p>Vecto Pilot — built for rideshare drivers worldwide.</p>
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
      </div>
    </div>
  );
};

export default InstructionsTab;
