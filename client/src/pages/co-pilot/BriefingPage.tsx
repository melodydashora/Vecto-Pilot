// client/src/pages/co-pilot/BriefingPage.tsx
// Wrapper page for the Briefing tab with weather, traffic, news, and events

import React from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import type { PipelinePhase } from '@/types/co-pilot';

export default function BriefingPage() {
  const { lastSnapshotId, pipelinePhase, persistentStrategy } = useCoPilot();

  // Fetch briefing data using the extracted hook
  const {
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
  } = useBriefingQueries({
    snapshotId: lastSnapshotId,
    pipelinePhase: pipelinePhase as PipelinePhase
  });

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
