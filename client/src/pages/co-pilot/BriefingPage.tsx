// The provider owns the query and SSE subscription; this page forwards its
// typed section envelopes unchanged, including pending/failure metadata.
import React, { memo } from 'react';
import BriefingTab from '@/components/BriefingTab';
import { useCoPilot } from '@/contexts/co-pilot-context';

function BriefingPage() {
  const { contextSnapshotId, timezone, briefingData } = useCoPilot();
  const { isLoading } = briefingData;

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
      {(briefingData.generationError || briefingData.isRetryExhausted) && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {briefingData.generationError
            ? 'Briefing is incomplete. Collected data is preserved below. Strategy requires the complete Briefing.'
            : 'Briefing updates are unavailable. Collected data is preserved below; completion has not been confirmed.'}
        </p>
      )}
      <BriefingTab
        snapshotId={contextSnapshotId || undefined}
        timezone={timezone}
        weatherData={briefingData.weatherData}
        trafficData={briefingData.trafficData}
        newsData={briefingData.newsData}
        eventsData={briefingData.eventsData}
        schoolClosuresData={briefingData.schoolClosuresData}
        airportData={briefingData.airportData}
        isEventsLoading={isLoading.events}
        isTrafficLoading={isLoading.traffic}
        isNewsLoading={isLoading.news}
        isAirportLoading={isLoading.airport}
        isSchoolClosuresLoading={isLoading.schoolClosures}
      />
    </div>
  );
}

export default memo(BriefingPage);
