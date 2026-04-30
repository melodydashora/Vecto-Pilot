// client/src/components/co-pilot/BottomTabNavigation.tsx
// Bottom navigation tabs for Co-Pilot pages using React Router

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
<<<<<<< HEAD
  Sparkles,
  Wine,
  MessageSquare,
  Map as MapIcon,
  Heart,
  Target
=======
  Compass,
  Sparkles,
  Wine,
  MessageSquare,
  QrCode,
  Languages
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
} from 'lucide-react';

interface TabConfig {
  id: string;
  path: string;
  label: string;
  icon: typeof Sparkles;
  activeColor: string;
  activeBg: string;
  showPulse?: boolean;
}

<<<<<<< HEAD
const tabs: TabConfig[] = [
  {
    id: 'strategy',
    path: '/co-pilot/strategy',
    label: 'Strategy',
    icon: Sparkles,
=======
// 2026-04-25 (Phase A Pass 1 polish): tab order updated per browser-test feedback.
// Coach moved to position 2 (right of Strategy) — drivers reach the AI surface
// faster when they have a question while looking at strategy.
// Coach icon: Sparkles (the de-facto "AI" icon) — was MessageSquare which
// collided with Briefing's icon.
// Intel moved to hamburger menu as "Market Intel" — forecasting sub-tabs
// (surge zones, hotel occupancy, demand patterns) that warrant a hub page.
const tabs: TabConfig[] = [
  {
    // 2026-04-26: Strategy icon Sparkles → Compass to disambiguate from Coach.
    // Compass reads as real-time bearing / "next move" — fits Strategy's
    // 1–4 hour tactical-dispatch role, not long-term planning.
    // Color stays text-blue-600 / bg-blue-50 — blue remains the entry-point anchor.
    id: 'strategy',
    path: '/co-pilot/strategy',
    label: 'Strategy',
    icon: Compass,
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
    activeColor: 'text-blue-600',
    activeBg: 'bg-blue-50'
  },
  {
<<<<<<< HEAD
    id: 'bars',
    path: '/co-pilot/bars',
    label: 'Bars',
=======
    id: 'coach',
    path: '/co-pilot/coach',
    label: 'Coach',
    icon: Sparkles,
    activeColor: 'text-blue-600',
    activeBg: 'bg-blue-50',
  },
  {
    id: 'bars',
    path: '/co-pilot/bars',
    label: 'Lounges & Bars',
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
    icon: Wine,
    activeColor: 'text-purple-600',
    activeBg: 'bg-purple-50',
    showPulse: true
  },
  {
    id: 'briefing',
    path: '/co-pilot/briefing',
    label: 'Briefing',
    icon: MessageSquare,
    activeColor: 'text-indigo-600',
    activeBg: 'bg-indigo-50'
  },
<<<<<<< HEAD
  {
    id: 'map',
    path: '/co-pilot/map',
    label: 'Map',
    icon: MapIcon,
    activeColor: 'text-green-600',
    activeBg: 'bg-green-50'
  },
  {
    id: 'intel',
    path: '/co-pilot/intel',
    label: 'Intel',
    icon: Target,
    activeColor: 'text-amber-600',
    activeBg: 'bg-amber-50'
  },
  {
    id: 'about',
    path: '/co-pilot/about',
    label: 'About',
    icon: Heart,
    activeColor: 'text-rose-600',
    activeBg: 'bg-rose-50'
=======
  // 2026-04-26 PHASE B: Map tab removed. The map now lives embedded in
  // StrategyPage. Drivers navigate to /co-pilot/strategy for both strategy
  // and the map — no more duplicate render path.
  {
    // 2026-03-17: Added for FIFA World Cup real-time rider translation feature
    id: 'translate',
    path: '/co-pilot/translate',
    label: 'Translate',
    icon: Languages,
    activeColor: 'text-sky-600',
    activeBg: 'bg-sky-50'
  },
  {
    id: 'concierge',
    path: '/co-pilot/concierge',
    label: 'Concierge',
    icon: QrCode,
    activeColor: 'text-teal-600',
    activeBg: 'bg-teal-50'
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  }
];

export function BottomTabNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine active tab from current path
  const activeTab = tabs.find(tab => location.pathname === tab.path)?.id || 'strategy';

  return (
<<<<<<< HEAD
    <div
=======
    <nav
      aria-label="Main navigation"
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50"
      data-testid="bottom-tabs"
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.path)}
<<<<<<< HEAD
=======
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
                className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                  isActive
                    ? `${tab.activeColor} ${tab.activeBg}`
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <div className="relative">
                  <Icon className={`w-6 h-6 ${isActive ? tab.activeColor : 'text-gray-400'}`} />
                  {tab.showPulse && (
                    <span className="absolute -top-1 -right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  )}
                </div>
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
<<<<<<< HEAD
    </div>
=======
    </nav>
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  );
}

export default BottomTabNavigation;
