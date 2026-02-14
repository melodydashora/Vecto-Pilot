// client/src/components/co-pilot/BottomTabNavigation.tsx
// Bottom navigation tabs for Co-Pilot pages using React Router

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sparkles,
  Wine,
  MessageSquare,
  Map as MapIcon,
  QrCode,
  Target
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

const tabs: TabConfig[] = [
  {
    id: 'strategy',
    path: '/co-pilot/strategy',
    label: 'Strategy',
    icon: Sparkles,
    activeColor: 'text-blue-600',
    activeBg: 'bg-blue-50'
  },
  {
    id: 'bars',
    path: '/co-pilot/bars',
    label: 'Lounges & Bars',
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
    id: 'concierge',
    path: '/co-pilot/concierge',
    label: 'Concierge',
    icon: QrCode,
    activeColor: 'text-teal-600',
    activeBg: 'bg-teal-50'
  }
];

export function BottomTabNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine active tab from current path
  const activeTab = tabs.find(tab => location.pathname === tab.path)?.id || 'strategy';

  return (
    <div
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
    </div>
  );
}

export default BottomTabNavigation;
