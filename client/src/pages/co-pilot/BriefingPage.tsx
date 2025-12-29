// client/src/pages/co-pilot/BriefingPage.tsx
// Wrapper page for the Briefing tab with weather, traffic, news, and events
// Uses pre-loaded briefing data from CoPilotContext for instant display

import React from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useCoPilot } from '@/contexts/co-pilot-context';

export default function BriefingPage() {
  const { lastSnapshotId, persistentStrategy, briefingData } = useCoPilot();

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
      <BriefingTab
        snapshotId={lastSnapshotId || undefined}
        weatherData={briefingData.weather ? { weather: briefingData.weather } : undefined}
        trafficData={briefingData.traffic ? { traffic: briefingData.traffic } : undefined}
        newsData={briefingData.news ? { news: briefingData.news } : undefined}
        eventsData={briefingData.events ? { events: briefingData.events } : undefined}
        schoolClosuresData={briefingData.schoolClosures ? { school_closures: briefingData.schoolClosures } : undefined}
        airportData={briefingData.airport ? { airport_conditions: briefingData.airport } : undefined}
        consolidatedStrategy={persistentStrategy || undefined}
      />
    </div>
  );
}
