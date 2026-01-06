// client/src/pages/co-pilot/BriefingPage.tsx
// Wrapper page for the Briefing tab with weather, traffic, news, and events
// Fetches briefing data directly from API using snapshotId from LocationContext
//
// 2026-01-06: Removed excessive debug logs that caused hundreds of console entries
// per render cycle. Use React DevTools Profiler for debugging re-renders instead.

import React, { memo, useRef, useEffect } from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useLocation } from '@/contexts/location-context-clean';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useCoPilot } from '@/contexts/co-pilot-context';

function BriefingPage() {
  // Get snapshotId directly from LocationContext (single source of truth)
  const { lastSnapshotId } = useLocation();

  // Fetch briefing data directly from API - not through CoPilotContext
  const {
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
  } = useBriefingQueries({ snapshotId: lastSnapshotId });

  // Still need persistentStrategy from CoPilot context for display
  const { persistentStrategy } = useCoPilot();

  // Debug logging: Only log when snapshotId changes (not on every render)
  // 2026-01-06: Moved from inline to useEffect to prevent excessive logs
  const prevSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSnapshotId !== prevSnapshotRef.current) {
      prevSnapshotRef.current = lastSnapshotId;
      console.log('[BriefingPage] Snapshot changed:', lastSnapshotId?.slice(0, 8) || 'null');
    }
  }, [lastSnapshotId]);

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
      <BriefingTab
        snapshotId={lastSnapshotId || undefined}
        weatherData={weatherData}
        trafficData={trafficData}
        newsData={newsData}
        eventsData={eventsData}
        schoolClosuresData={schoolClosuresData}
        airportData={airportData}
        consolidatedStrategy={persistentStrategy || undefined}
      />
    </div>
  );
}

// Memoize to prevent re-renders when parent re-renders but props haven't changed
export default memo(BriefingPage);
