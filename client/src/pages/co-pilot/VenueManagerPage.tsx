// client/src/pages/co-pilot/VenueManagerPage.tsx
// 2026-01-09: Renamed from BarsPage.tsx for disambiguation
// Wrapper page for the Bars tab with premium venue listings

import React from 'react';
import { Wine } from 'lucide-react';
// 2026-01-09: Renamed from BarTab for disambiguation
import BarsMainTab from '@/components/BarsMainTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { getAuthHeader } from '@/utils/co-pilot-helpers';

export default function VenueManagerPage() {
  const { coords, city, state, timezone, isLocationResolved } = useCoPilot();

  // 2026-03-18: FIX — Gate on isLocationResolved, not just coords.
  // When coords exist but city/timezone haven't resolved, the query's enabled=false
  // causes React Query v5 to return isLoading=false + data=undefined → false "No venues found".
  if (!coords || !isLocationResolved) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Wine className={`w-12 h-12 text-gray-400 mb-4 ${coords ? 'animate-pulse' : ''}`} />
        <h3 className="text-lg font-semibold text-gray-700">
          {!coords ? 'Location Required' : 'Resolving Location...'}
        </h3>
        <p className="text-gray-500 mt-2">
          {!coords
            ? 'Enable location services to discover nearby bars and venues'
            : 'Getting your city and timezone for accurate venue hours'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6" data-testid="bars-page">
      <BarsMainTab
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
