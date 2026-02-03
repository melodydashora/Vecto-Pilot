/**
 * AppSelectionChips Component
 * Allows users to select which rideshare/delivery apps they drive for
 */

import React from 'react';
import { Check } from 'lucide-react';

interface App {
  id: string;
  name: string;
  icon: string;
  color: string;
  connected?: boolean;
}

const APPS: App[] = [
  { id: 'uber', name: 'Uber', icon: 'U', color: 'bg-black' },
  { id: 'lyft', name: 'Lyft', icon: 'L', color: 'bg-pink-500' },
  { id: 'doordash', name: 'DoorDash', icon: 'DD', color: 'bg-red-500' },
  { id: 'grubhub', name: 'Grubhub', icon: 'GH', color: 'bg-orange-500' },
  { id: 'instacart', name: 'Instacart', icon: 'IC', color: 'bg-green-500' },
  { id: 'amazon_flex', name: 'Amazon Flex', icon: 'AF', color: 'bg-yellow-500' },
];

interface AppSelectionChipsProps {
  selectedApps: string[];
  connectedApps?: string[];
  onChange: (apps: string[]) => void;
  onConnect?: (appId: string) => void;
  showConnectButtons?: boolean;
}

export function AppSelectionChips({
  selectedApps,
  connectedApps = [],
  onChange,
  onConnect,
  showConnectButtons = false,
}: AppSelectionChipsProps) {
  const toggleApp = (appId: string) => {
    if (selectedApps.includes(appId)) {
      onChange(selectedApps.filter(id => id !== appId));
    } else {
      onChange([...selectedApps, appId]);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">
        Which apps do you drive for?
      </label>
      <div className="flex flex-wrap gap-2">
        {APPS.map(app => {
          const isSelected = selectedApps.includes(app.id);
          const isConnected = connectedApps.includes(app.id);

          return (
            <div key={app.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleApp(app.id)}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium
                  transition-all duration-200 border-2
                  ${isSelected
                    ? `${app.color} text-white border-transparent`
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:border-gray-300'
                  }
                `}
              >
                <span className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${isSelected ? 'bg-white/20' : app.color + ' text-white'}
                `}>
                  {app.icon}
                </span>
                <span>{app.name}</span>
                {isSelected && (
                  <Check className="w-4 h-4" />
                )}
              </button>

              {/* Connect button for OAuth-enabled apps */}
              {showConnectButtons && isSelected && (app.id === 'uber' || app.id === 'lyft') && (
                <button
                  type="button"
                  onClick={() => onConnect?.(app.id)}
                  className={`
                    px-2 py-1 text-xs rounded-md transition-colors
                    ${isConnected
                      ? 'bg-green-100 text-green-700 cursor-default'
                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }
                  `}
                  disabled={isConnected}
                >
                  {isConnected ? 'Connected' : 'Connect'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Select all platforms you actively drive for. This helps us tailor your strategy.
      </p>
    </div>
  );
}

export default AppSelectionChips;
