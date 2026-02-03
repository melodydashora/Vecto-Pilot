// client/src/pages/co-pilot/BriefingPage.tsx
// Wrapper page for the Briefing tab with weather, traffic, news, and events
// Uses pre-loaded briefing data from CoPilotContext (single source of truth)
//
// 2026-01-06: Removed excessive debug logs that caused hundreds of console entries
// per render cycle. Use React DevTools Profiler for debugging re-renders instead.
// 2026-01-14: FIX - Use briefingData from CoPilotContext instead of calling useBriefingQueries
// directly. This prevents duplicate SSE subscriptions (was causing 2+ subscribers to briefing_ready).

import React, { memo, useRef, useEffect, useMemo } from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useCoPilot } from '@/contexts/co-pilot-context';

function BriefingPage() {
  // 2026-01-14: Get ALL data from CoPilotContext (single source of truth)
  // This prevents duplicate useBriefingQueries calls which create extra SSE subscriptions
  const {
    lastSnapshotId,
    persistentStrategy,
    timezone,
    briefingData
  } = useCoPilot();

  // Destructure briefing data for easier access
  const {
    weather: weatherData,
    traffic: trafficData,
    news: newsData,
    events: eventsData,
    schoolClosures: schoolClosuresData,
    airport: airportData,
    isLoading
  } = briefingData;

  // Debug logging: Only log when snapshotId changes (not on every render)
  // 2026-01-06: Moved from inline to useEffect to prevent excessive logs
  const prevSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSnapshotId !== prevSnapshotRef.current) {
      prevSnapshotRef.current = lastSnapshotId;
      console.log('[BriefingPage] Snapshot changed:', lastSnapshotId?.slice(0, 8) || 'null');
    }
  }, [lastSnapshotId]);

  // 2026-01-14: Memoize wrapped props to prevent BriefingTab re-renders
  // Without useMemo, inline objects like { weather: weatherData } are recreated on every render
  const wrappedWeatherData = useMemo(
    () => weatherData ? { weather: weatherData } : undefined,
    [weatherData]
  );
  const wrappedTrafficData = useMemo(
    () => trafficData ? { traffic: trafficData } : undefined,
    [trafficData]
  );
  const wrappedNewsData = useMemo(
    () => newsData ? { news: newsData } : undefined,
    [newsData]
  );
  const wrappedEventsData = useMemo(
    () => eventsData ? { events: eventsData } : undefined,
    [eventsData]
  );
  const wrappedSchoolClosuresData = useMemo(
    () => schoolClosuresData ? { school_closures: schoolClosuresData } : undefined,
    [schoolClosuresData]
  );
  const wrappedAirportData = useMemo(
    () => airportData ? { airport_conditions: airportData } : undefined,
    [airportData]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
      <BriefingTab
        snapshotId={lastSnapshotId || undefined}
        timezone={timezone}
        weatherData={wrappedWeatherData}
        trafficData={wrappedTrafficData}
        newsData={wrappedNewsData}
        eventsData={wrappedEventsData}
        isEventsLoading={isLoading.events}
        schoolClosuresData={wrappedSchoolClosuresData}
        airportData={wrappedAirportData}
        consolidatedStrategy={persistentStrategy || undefined}
      />
    </div>
  );
}

// Memoize to prevent re-renders when parent re-renders but props haven't changed
export default memo(BriefingPage);
