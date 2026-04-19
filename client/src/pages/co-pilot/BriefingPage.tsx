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
  // 2026-04-19: H3 + C2 — pull through `weatherFailed` and `schoolClosuresReason`
  // so cards can render explicit "section unavailable" / server-provided-reason
  // states. Both were previously dropped at the context unwrap step.
  const {
    weather: weatherData,
    traffic: trafficData,
    news: newsData,
    events: eventsData,
    marketEvents: marketEventsData,
    schoolClosures: schoolClosuresData,
    schoolClosuresReason,
    airport: airportData,
    weatherFailed,
    isLoading
  } = briefingData as any;

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
  // 2026-04-19: H3 — carry `_generationFailed` flag through to WeatherCard so
  // it can render an explicit "weather temporarily unavailable" state instead
  // of silently hiding when the provider permanently failed.
  const wrappedWeatherData = useMemo(
    () => weatherData ? { weather: weatherData, _generationFailed: !!weatherFailed } : undefined,
    [weatherData, weatherFailed]
  );
  const wrappedTrafficData = useMemo(
    () => trafficData ? { traffic: trafficData } : undefined,
    [trafficData]
  );
  const wrappedNewsData = useMemo(
    () => newsData ? { news: newsData } : undefined,
    [newsData]
  );
  // 2026-04-02: FIX - Re-wrap events into the object shape BriefingTab expects.
  // CoPilotContext (line 690) unwraps eventsData.events into a plain array,
  // but BriefingTab expects { events, marketEvents, market_name }.
  const wrappedEventsData = useMemo(
    () => eventsData ? { events: eventsData, marketEvents: marketEventsData || [] } : undefined,
    [eventsData, marketEventsData]
  );
  // 2026-04-19: C2 follow-through — include `reason` so SchoolClosuresCard
  // can show the server-provided message (e.g., "No data source for this region")
  // instead of always falling back to the generic "No school closures reported".
  const wrappedSchoolClosuresData = useMemo(
    () => schoolClosuresData ? { school_closures: schoolClosuresData, reason: schoolClosuresReason } : undefined,
    [schoolClosuresData, schoolClosuresReason]
  );
  const wrappedAirportData = useMemo(
    () => airportData ? { airport_conditions: airportData } : undefined,
    [airportData]
  );

  // 2026-03-28: Gate strategy card on all critical briefing data including events
  // Events now have proper polling/retry, so they participate in the loading lifecycle
  // 2026-04-19: H5 fix — include weather + schoolClosures so the strategy card
  // honors the user's contract that the briefing tab is the transparency window
  // onto what the strategist receives. Strategy should not render until ALL
  // briefing sections have either resolved or explicitly failed.
  const areCriticalBriefingsLoading =
    isLoading.weather ||
    isLoading.traffic ||
    isLoading.news ||
    isLoading.airport ||
    isLoading.events ||
    isLoading.schoolClosures;

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
        isTrafficLoading={isLoading.traffic}
        isNewsLoading={isLoading.news}
        isAirportLoading={isLoading.airport}
        isSchoolClosuresLoading={isLoading.schoolClosures}
        areCriticalBriefingsLoading={areCriticalBriefingsLoading}
        schoolClosuresData={wrappedSchoolClosuresData}
        airportData={wrappedAirportData}
        consolidatedStrategy={persistentStrategy || undefined}
      />
    </div>
  );
}

// Memoize to prevent re-renders when parent re-renders but props haven't changed
export default memo(BriefingPage);
