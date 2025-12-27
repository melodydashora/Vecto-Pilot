// client/src/pages/co-pilot/BarsPage.tsx
// Wrapper page for the Bars tab with premium venue listings

import React from 'react';
import { Wine } from 'lucide-react';
import BarTab from '@/components/BarTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { getAuthHeader } from '@/utils/co-pilot-helpers';

export default function BarsPage() {
  const { coords, city, state, timezone, isLocationResolved } = useCoPilot();

  // Show placeholder if no location yet
  if (!coords) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Wine className="w-12 h-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold text-gray-700">Location Required</h3>
        <p className="text-gray-500 mt-2">Enable location services to discover nearby bars and venues</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6" data-testid="bars-page">
      <BarTab
        latitude={coords.latitude}
        longitude={coords.longitude}
        city={city}
        state={state}
        timezone={timezone}
        isLocationResolved={isLocationResolved}
        getAuthHeader={getAuthHeader}
      />
    </div>
  );
}
