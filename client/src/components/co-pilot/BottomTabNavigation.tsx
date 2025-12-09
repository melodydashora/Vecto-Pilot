// client/src/components/co-pilot/BottomTabNavigation.tsx
// Bottom navigation tabs for Co-Pilot page

import React from 'react';
import {
  Sparkles,
  TrendingUp,
  MessageSquare,
  Map as MapIcon,
  Heart
} from 'lucide-react';
import type { TabType } from '@/types/co-pilot';

interface BottomTabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

interface TabConfig {
  id: TabType;
  label: string;
  icon: typeof Sparkles;
  activeColor: string;
  activeBg: string;
  showPulse?: boolean;
}

const tabs: TabConfig[] = [
  {
    id: 'strategy',
    label: 'Strategy',
    icon: Sparkles,
    activeColor: 'text-blue-600',
    activeBg: 'bg-blue-50'
  },
  {
    id: 'venues',
    label: 'Venues',
    icon: TrendingUp,
    activeColor: 'text-blue-600',
    activeBg: 'bg-blue-50',
    showPulse: true
  },
  {
    id: 'briefing',
    label: 'Briefing',
    icon: MessageSquare,
    activeColor: 'text-indigo-600',
    activeBg: 'bg-indigo-50'
  },
  {
    id: 'map',
    label: 'Map',
    icon: MapIcon,
    activeColor: 'text-green-600',
    activeBg: 'bg-green-50'
  },
  {
    id: 'donation',
    label: 'About',
    icon: Heart,
    activeColor: 'text-rose-600',
    activeBg: 'bg-rose-50'
  }
];

export function BottomTabNavigation({ activeTab, onTabChange }: BottomTabNavigationProps) {
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
                onClick={() => onTabChange(tab.id)}
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
