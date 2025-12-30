// client/src/pages/co-pilot/BriefingPage.tsx
// Wrapper page for the Briefing tab with weather, traffic, news, and events
// Fetches briefing data directly from API using snapshotId from LocationContext

import React from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useLocation } from '@/contexts/location-context-clean';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useCoPilot } from '@/contexts/co-pilot-context';

export default function BriefingPage() {
  // Get snapshotId directly from LocationContext (single source of truth)
  const { lastSnapshotId } = useLocation();

  // Debug: Log snapshotId to verify it's available
  console.log('[BriefingPage] lastSnapshotId from useLocation:', lastSnapshotId?.slice(0, 8) || 'null');

  // Fetch briefing data directly from API - not through CoPilotContext
  const {
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
  } = useBriefingQueries({ snapshotId: lastSnapshotId });

  // Debug: Log what data we got back (compact format)
  console.log('[BriefingPage] 📊 Data status:', {
    traffic: trafficData?.traffic ? '✅ ' + (trafficData.traffic.summary?.slice(0, 40) + '...') : '❌ missing',
    weather: weatherData?.weather?.current ? '✅ ' + weatherData.weather.current.tempF + '°F' : '❌ missing',
    news: newsData?.news?.items ? '✅ ' + newsData.news.items.length + ' items' : '❌ missing',
    events: eventsData?.events ? '✅ ' + eventsData.events.length + ' events' : '❌ missing',
    airport: airportData?.airport_conditions?.airports ? '✅ ' + airportData.airport_conditions.airports.length + ' airports' : '❌ missing',
    school: schoolClosuresData?.school_closures ? '✅ ' + schoolClosuresData.school_closures.length + ' closures' : '❌ missing',
  });

  // Still need persistentStrategy from CoPilot context for display
  const { persistentStrategy } = useCoPilot();

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
