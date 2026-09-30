// The provider owns the query and SSE subscription; this page forwards its
// typed section envelopes unchanged, including pending/failure metadata.
import React, { memo } from 'react';
import BriefingTab from '@/components/BriefingTab';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCoPilot } from '@/contexts/co-pilot-context';

function BriefingPage() {
  const { contextSnapshotId, timezone, briefingData } = useCoPilot();
  const { isLoading } = briefingData;

  if (briefingData.isRetryExhausted) {
    return (
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
        <Card>
          <CardContent className="p-6 space-y-4">
            <p role="alert">Briefing data is temporarily unavailable. Try again to refresh it.</p>
            <Button disabled={briefingData.isFetching} onClick={() => { void briefingData.retryBriefing(); }}>
              {briefingData.isFetching ? 'Retrying briefing...' : 'Retry briefing'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="briefing-page">
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
