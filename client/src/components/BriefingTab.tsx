import { useState, memo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Loader, MapPin, ChevronUp, ChevronDown } from "lucide-react";
import EventsComponent from "./EventsComponent";
import { StrategyCard } from "./briefing/StrategyCard";
import { WeatherCard } from "./briefing/WeatherCard";
import { TrafficCard } from "./briefing/TrafficCard";
import { NewsCard } from "./briefing/NewsCard";
import { AirportCard } from "./briefing/AirportCard";
import { SchoolClosuresCard } from "./briefing/SchoolClosuresCard";
import { DailyRefreshCard } from "./briefing/DailyRefreshCard";

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
  impact?: 'high' | 'medium' | 'low';
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
    market_name?: string;
    reason?: string
  };
  isEventsLoading?: boolean;
  isTrafficLoading?: boolean;
  isNewsLoading?: boolean;
  isAirportLoading?: boolean;
  areCriticalBriefingsLoading?: boolean;
  schoolClosuresData?: any;
  airportData?: any;
  consolidatedStrategy?: string;
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
  areCriticalBriefingsLoading,
  schoolClosuresData,
  airportData,
  consolidatedStrategy,
  timezone
}: BriefingTabProps) {
  const [expandedMarketEvents, setExpandedMarketEvents] = useState(false);

  // Filter events for today (shared logic)
  const isEventForToday = (event: BriefingEvent): boolean => {
    if (!event.event_start_time || !event.event_start_date) return false;
    if (!timezone) {
      console.error('[BriefingTab] isEventForToday: Missing timezone');
      return false;
    }
    try {
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(now);
      const eventStartDate = event.event_start_date;
      const eventEndDate = event.event_end_date || event.event_start_date;
      return todayStr >= eventStartDate && todayStr <= eventEndDate;
    } catch (err) {
      console.error('[BriefingTab] isEventForToday: Date calculation error:', err);
      return false;
    }
  };

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
  const eventsToday = allEvents.filter(isEventForToday);

  // Process Market Events
  const marketName = eventsData?.market_name || null;
  const allMarketEvents = (eventsData?.marketEvents || []).map((event: BriefingEvent) => ({
    ...event,
    title: event.title || 'Untitled Event',
    subtype: event.event_type || event.subtype,
    venue: event.venue || event.location,
  }));
  const marketEventsToday = allMarketEvents.filter(isEventForToday);

  return (
    <div className="space-y-6" data-testid="briefing-container">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Newspaper className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-800">Driver Briefing</h2>
          {snapshotId && (
            <Badge variant="outline" className="text-xs font-mono bg-gray-100 text-gray-600">
              {snapshotId.slice(0, 8)}...
            </Badge>
          )}
        </div>
      </div>

      <StrategyCard 
        snapshotId={snapshotId}
        consolidatedStrategy={consolidatedStrategy}
        areCriticalBriefingsLoading={!!areCriticalBriefingsLoading}
      />

      <DailyRefreshCard snapshotId={snapshotId} />

      <WeatherCard weatherData={weatherData} />

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
      {isEventsLoading ? (
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-indigo-600 mr-2" />
              <span className="text-gray-600">Loading events...</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EventsComponent events={eventsToday} isLoading={false} />
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
                  {marketEventsToday.length} high-impact
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
              <EventsComponent events={marketEventsToday} isLoading={false} />
            </CardContent>
          )}
        </Card>
      )}

      <SchoolClosuresCard schoolClosuresData={schoolClosuresData} />
    </div>
  );
});

export default BriefingTab;