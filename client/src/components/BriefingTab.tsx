import { useState, memo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Loader, MapPin, ChevronUp, ChevronDown } from "lucide-react";
import { filterTodayEvents } from '@/utils/co-pilot-helpers';
import EventsComponent from "./EventsComponent";
import { WeatherCard } from "./briefing/WeatherCard";
import { TrafficCard } from "./briefing/TrafficCard";
import { NewsCard } from "./briefing/NewsCard";
import { AirportCard } from "./briefing/AirportCard";
import { SchoolClosuresCard } from "./briefing/SchoolClosuresCard";

interface BriefingEvent {
  title?: string;
  venue?: string;
  location?: string;
  address?: string;
  city?: string;
  event_start_date?: string;
  event_end_date?: string;
  event_start_time?: string;
  event_end_time?: string;
  event_type?: string;
  subtype?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low' | null;
  [key: string]: unknown;
}

interface BriefingTabProps {
  snapshotId?: string;
  timezone?: string | null;
  weatherData?: any;
  trafficData?: any;
  newsData?: any;
  eventsData?: {
    events?: BriefingEvent[];
    marketEvents?: BriefingEvent[];
    // 2026-09-13: null-tolerant — the provider now forwards the hook's envelope unchanged.
    market_name?: string | null;
    market_status?: 'complete' | 'partial' | 'unavailable';
    unresolved_market_events?: number;
    reason?: string | null;
    // 2026-07-06 (todo #24): pending/failed/verified-empty are three states
    _pending?: boolean;
    _generationFailed?: boolean;
  };
  isEventsLoading?: boolean;
  isTrafficLoading?: boolean;
  isNewsLoading?: boolean;
  isAirportLoading?: boolean;
  isSchoolClosuresLoading?: boolean;
  schoolClosuresData?: any;
  airportData?: any;
}

const BriefingTab = memo(function BriefingTab({
  snapshotId,
  weatherData,
  trafficData,
  newsData,
  eventsData,
  isEventsLoading,
  isTrafficLoading,
  isNewsLoading,
  isAirportLoading,
  isSchoolClosuresLoading,
  schoolClosuresData,
  airportData,
  timezone
}: BriefingTabProps) {
  const [expandedMarketEvents, setExpandedMarketEvents] = useState(false);

  if (!snapshotId) {
    return (
      <Card data-testid="briefing-no-snapshot">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-12">
            <Newspaper className="w-8 h-8 text-gray-400 mb-4" />
            <p className="text-gray-500">No snapshot available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Process Events Data
  const allEvents = (eventsData?.events || []).map((event: BriefingEvent) => ({
    ...event,
    title: event.title || 'Untitled Event',
    subtype: event.event_type || event.subtype,
    venue: event.venue || event.location,
  }));

  // Process Market Events
  const marketName = eventsData?.market_name || null;
  const allMarketEvents = (eventsData?.marketEvents || []).map((event: BriefingEvent) => ({
    ...event,
    title: event.title || 'Untitled Event',
    subtype: event.event_type || event.subtype,
    venue: event.venue || event.location,
  }));
  const marketEventsToday = filterTodayEvents(allMarketEvents, timezone ?? undefined);

  return (
    <div className="space-y-6" data-testid="briefing-container">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Newspaper className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-800">Driver Briefing</h2>
        </div>
      </div>

      <WeatherCard weatherData={weatherData} timezone={timezone ?? undefined} />

      <TrafficCard 
        trafficData={trafficData} 
        isTrafficLoading={!!isTrafficLoading} 
      />

      <AirportCard 
        airportData={airportData} 
        isAirportLoading={!!isAirportLoading} 
      />

      <NewsCard 
        newsData={newsData} 
        isNewsLoading={!!isNewsLoading} 
      />

      {/* Events Sections */}
      {(isEventsLoading || eventsData?._pending) && !eventsData?._generationFailed && (
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-indigo-600 mr-2" />
              <span role="status" className="text-gray-600">{allEvents.length ? 'Still collecting events. Verified events appear below.' : 'Loading events...'}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {eventsData?._generationFailed && (
        // Failed ≠ empty: show the recorded reason, never "no events" (todo #24)
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <CardContent className="p-6">
            <div role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Events are incomplete{eventsData?.reason ? ` — ${eventsData.reason}` : ''}.
              {allEvents.length > 0 && ' Verified events collected so far are shown below.'}
            </div>
          </CardContent>
        </Card>
      )}
      {!isEventsLoading && !eventsData?._pending && !eventsData?._generationFailed && allEvents.length === 0 && eventsData?.reason && (
        // 2026-04-19: H4 fix — when events generation completed but returned
        // nothing (e.g., "No events found for this location"), surface the
        // server-provided reason instead of an empty silent card. Was previously
        // a blank EventsComponent render — users had no signal whether events
        // were still loading, broken, or genuinely empty.
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <CardContent className="p-6">
            <div className="text-sm text-gray-600">{eventsData.reason}</div>
          </CardContent>
        </Card>
      )}
      {allEvents.length > 0 && (
        <EventsComponent events={allEvents} isLoading={false} timezone={timezone ?? undefined} />
      )}

      {eventsData?.market_status === 'unavailable' && (
        <p role="status" className="text-sm text-amber-800">Additional market events are temporarily unavailable.</p>
      )}
      {eventsData?.market_status === 'partial' && (
        <p role="status" className="text-sm text-amber-800">Some market events have unconfirmed times and are not shown.</p>
      )}
      {marketEventsToday.length > 0 && (
        <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <CardHeader
            className="pb-2 cursor-pointer hover:bg-amber-100/50 transition-colors"
            onClick={() => setExpandedMarketEvents(!expandedMarketEvents)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="w-5 h-5 text-amber-600" />
                <span>Major Events in Your Market</span>
                {marketName && (
                  <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300 ml-1">
                    {marketName}
                  </Badge>
                )}
                <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                  {marketEventsToday.length} major events
                </Badge>
              </CardTitle>
              {expandedMarketEvents ? (
                <ChevronUp className="w-5 h-5 text-amber-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-amber-600" />
              )}
            </div>
          </CardHeader>
          {expandedMarketEvents && (
            <CardContent className="pt-0">
              <EventsComponent events={marketEventsToday} isLoading={false} timezone={timezone ?? undefined} />
            </CardContent>
          )}
        </Card>
      )}

      <SchoolClosuresCard schoolClosuresData={schoolClosuresData} isSchoolClosuresLoading={!!isSchoolClosuresLoading} />
    </div>
  );
});

export default BriefingTab;
