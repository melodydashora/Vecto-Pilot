import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Newspaper, Cloud, CloudRain, Sun,
  AlertTriangle, Car, Loader, Clock, ExternalLink,
  ChevronDown, ChevronUp, BookOpen, Sparkles, FileText, Zap,
  Plane, PlaneLanding, PlaneTakeoff, CalendarSearch, MapPin
} from "lucide-react";
import { getAuthHeader } from "@/utils/co-pilot-helpers";
import EventsComponent from "./EventsComponent";

interface SchoolClosure {
  schoolName: string;
  closureStart: string;
  reopeningDate: string;
  type: 'district' | 'college';
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

interface BriefingEvent {
  title?: string;
  venue?: string;
  location?: string;
  address?: string;
  city?: string;  // For market events - shows which city the event is in
  event_date?: string;
  event_end_date?: string;  // For multi-day events
  event_time?: string;
  event_end_time?: string;
  event_type?: string;
  subtype?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  [key: string]: unknown;
}

interface AirportDelay {
  status: string;
  avgMinutes: number;
}

interface Airport {
  code: string;
  name: string;
  // Server may return either 'overallStatus' or 'status'
  overallStatus?: 'normal' | 'delays' | 'severe_delays';
  status?: 'normal' | 'delays' | 'severe_delays' | string;
  // Delay information - may be string description or structured object
  delays?: string;
  avgDelayMinutes?: number;
  arrivalDelays?: AirportDelay;
  departureDelays?: AirportDelay;
  // Busy times array (simple strings like "5-8 AM")
  busyTimes?: string[];
  weather?: string;
  groundStops?: boolean;
  tipsForDrivers?: string;
}

// BusyPeriod can be either a string or an object
type BusyPeriod = string | {
  time: string;
  airport: string;
  reason: string;
};

interface AirportConditions {
  airports?: Airport[];
  busyPeriods?: BusyPeriod[];
  recommendations?: string;
  fetchedAt?: string;
  isFallback?: boolean;
  provider?: string;
}

interface ForecastItem {
  day?: string;
  time?: string;
  high?: number;
  low?: number;
  tempF?: number;
  conditions?: string;
  conditionType?: string;
  isDaytime?: boolean;
  precipitationProbability?: number;
}

interface WeatherData {
  weather?: {
    current?: {
      tempF?: number;
      conditions?: string;
      humidity?: number;
      windDirection?: string;
      isDaytime?: boolean;
    };
    forecast?: ForecastItem[];
  };
}

interface TrafficIncident {
  title?: string;
  severity?: string;
  location?: string;
  description?: string;
}

interface TrafficData {
  traffic?: {
    summary?: string;
    briefing?: string;
    incidents?: TrafficIncident[];
    incidentsCount?: number;
    congestionLevel?: 'low' | 'medium' | 'high';
    keyIssues?: string[];
    driverImpact?: string;
  };
}

interface NewsItem {
  title?: string;
  source?: string;
  url?: string;
  link?: string;
  snippet?: string;
  summary?: string;
  impact?: 'high' | 'medium' | 'low';
  published_date?: string;
}

interface NewsData {
  news?: {
    items?: NewsItem[];
    filtered?: NewsItem[];
    reason?: string;
  };
}

interface BriefingTabProps {
  snapshotId?: string;
  timezone?: string | null;  // 2026-01-10: Required for isEventForToday calculation (NO FALLBACKS)
  weatherData?: WeatherData;
  trafficData?: TrafficData;
  newsData?: NewsData;
  eventsData?: {
    events?: BriefingEvent[];
    marketEvents?: BriefingEvent[];  // High-value events from across the market
    market_name?: string;            // Market name (e.g., "Dallas")
    reason?: string
  };
  isEventsLoading?: boolean;  // Explicit loading state for events
  schoolClosuresData?: { school_closures?: SchoolClosure[]; reason?: string };
  airportData?: { airport_conditions?: AirportConditions };
  consolidatedStrategy?: string;
}

export default function BriefingTab({
  snapshotId,
  weatherData,
  trafficData,
  newsData,
  eventsData,
  isEventsLoading,
  schoolClosuresData,
  airportData,
  consolidatedStrategy,
  timezone
}: BriefingTabProps) {
  // React Query client for cache invalidation after refresh
  const queryClient = useQueryClient();

  const [_expandedWeather, _setExpandedWeather] = useState(true);
  const [expandedTraffic, setExpandedTraffic] = useState(true);
  const [expandedIncidents, setExpandedIncidents] = useState(false); // Collapsed by default
  const [expandedNews, setExpandedNews] = useState(true);
  const [expandedClosures, setExpandedClosures] = useState(true);
  const [expandedAirport, setExpandedAirport] = useState(true);
  const [expandedMarketEvents, setExpandedMarketEvents] = useState(false); // Collapsed by default

  // Daily strategy - on-demand generation
  // Initialize with prop value if available (for returning users with cached strategy)
  const [showDailyStrategy, setShowDailyStrategy] = useState(!!consolidatedStrategy);
  const [dailyStrategy, setDailyStrategy] = useState<string | null>(consolidatedStrategy || null);
  const [isGeneratingDaily, setIsGeneratingDaily] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

  // Sync with prop when it changes (e.g., from localStorage on page load)
  // Only update if prop has value and local state is empty
  useEffect(() => {
    if (consolidatedStrategy && !dailyStrategy) {
      console.log('[BriefingTab] Syncing strategy from prop:', consolidatedStrategy.length, 'chars');
      setDailyStrategy(consolidatedStrategy);
      setShowDailyStrategy(true);
    }
  }, [consolidatedStrategy]); // Intentionally exclude dailyStrategy to avoid loops

  // Daily data refresh (events + news) - on-demand fetch
  const [isRefreshingDaily, setIsRefreshingDaily] = useState(false);
  const [dailyRefreshResult, setDailyRefreshResult] = useState<{
    events: { total: number; inserted: number; skipped: number };
    news: { count: number };
  } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Refresh daily data on-demand (events + news via all AI models)
  const refreshDailyData = useCallback(async () => {
    if (!snapshotId || isRefreshingDaily) return;

    setIsRefreshingDaily(true);
    setRefreshError(null);

    try {
      console.log('[BriefingTab] Refreshing daily data for snapshot:', snapshotId);
      const response = await fetch(`/api/briefing/refresh-daily/${snapshotId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh daily data');
      }

      if (data.ok) {
        console.log('[BriefingTab] Daily refresh complete:', {
          events: `${data.events.total_discovered} found, ${data.events.inserted} new`,
          news: `${data.news.count} items`
        });
        setDailyRefreshResult({
          events: {
            total: data.events.total_discovered,
            inserted: data.events.inserted,
            skipped: data.events.skipped
          },
          news: { count: data.news.count }
        });

        // 2026-01-05: Invalidate React Query cache so UI shows fresh data
        console.log('[BriefingTab] Invalidating query cache for fresh data...');
        queryClient.invalidateQueries({ queryKey: ['/api/briefing/rideshare-news', snapshotId] });
        queryClient.invalidateQueries({ queryKey: ['/api/briefing/events', snapshotId] });
      } else {
        throw new Error('No data returned');
      }
    } catch (err) {
      console.error('[BriefingTab] Failed to refresh daily data:', err);
      setRefreshError(err instanceof Error ? err.message : 'Failed to refresh daily data');
    } finally {
      setIsRefreshingDaily(false);
    }
  }, [snapshotId, isRefreshingDaily, queryClient]);

  // Generate daily strategy on-demand
  const generateDailyStrategy = useCallback(async () => {
    if (!snapshotId || isGeneratingDaily) return;

    setIsGeneratingDaily(true);
    setDailyError(null);

    try {
      console.log('[BriefingTab] Generating daily strategy for snapshot:', snapshotId);
      const response = await fetch(`/api/strategy/daily/${snapshotId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to generate daily strategy');
      }

      if (data.ok && data.consolidated_strategy) {
        console.log('[BriefingTab] Daily strategy generated:', data.consolidated_strategy.length, 'chars');
        setDailyStrategy(data.consolidated_strategy);
        setShowDailyStrategy(true);
      } else {
        throw new Error('No strategy returned');
      }
    } catch (err) {
      console.error('[BriefingTab] Failed to generate daily strategy:', err);
      setDailyError(err instanceof Error ? err.message : 'Failed to generate strategy');
    } finally {
      setIsGeneratingDaily(false);
    }
  }, [snapshotId, isGeneratingDaily]);

  // Log data received for debugging
  console.log('[BriefingTab] Received data:', {
    snapshotId,
    hasWeather: !!weatherData,
    hasTraffic: !!trafficData,
    hasNews: !!newsData,
    hasEvents: !!eventsData,
    hasClosures: !!schoolClosuresData,
    hasAirport: !!airportData
  });
  if (eventsData) {
    console.log('[BriefingTab] Events data:', { 
      eventsDataStructure: JSON.stringify(eventsData).substring(0, 200),
      eventsArray: eventsData.events,
      eventsArrayLength: eventsData.events?.length
    });
  }

  // Utility functions
  const _celsiusToFahrenheit = (celsius: number) => Math.round((celsius * 9/5) + 32);

  const getWeatherIcon = (conditionType?: string | null, isDaytime?: boolean | null) => {
    if (!conditionType) return <Cloud className="w-6 h-6 text-gray-500" />;
    const type = conditionType.toLowerCase();
    if (type.includes('rain') || type.includes('shower')) return <CloudRain className="w-6 h-6 text-blue-500" />;
    if (type.includes('clear') || type.includes('sunny')) {
      return isDaytime ? <Sun className="w-6 h-6 text-yellow-500" /> : <Cloud className="w-6 h-6 text-gray-400" />;
    }
    if (type.includes('partly') || type.includes('cloud')) return <Sun className="w-6 h-6 text-gray-400" />;
    return <Cloud className="w-6 h-6 text-gray-500" />;
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  const getCongestionColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-green-600';
    }
  };

  const getAirportStatusColor = (status: string) => {
    switch (status) {
      case 'severe_delays': return 'bg-red-100 text-red-700 border-red-300';
      case 'delays': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  const getAirportStatusLabel = (status: string) => {
    switch (status) {
      case 'severe_delays': return 'Severe Delays';
      case 'delays': return 'Delays';
      default: return 'On Time';
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Show closures that are currently active OR start within next 30 days
  const isClosureRelevant = (closure: SchoolClosure): boolean => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const closureStart = new Date(closure.closureStart);
      closureStart.setHours(0, 0, 0, 0);
      const reopeningDate = new Date(closure.reopeningDate);
      reopeningDate.setHours(0, 0, 0, 0);

      // Show if: closure hasn't ended yet (reopeningDate >= today)
      // This includes both active closures AND upcoming closures
      return reopeningDate >= today;
    } catch {
      return true;
    }
  };

  /**
   * Filter events for the Briefing tab:
   * 1. Must have both event_time and event_end_time
   * 2. Must be happening today (single-day OR today is within multi-day range)
   *
   * 2026-01-10: NO FALLBACKS - Uses snapshot timezone, not browser timezone
   * If timezone is missing, this is a critical data error upstream.
   */
  const isEventForToday = (event: BriefingEvent): boolean => {
    // Require both start and end times
    if (!event.event_time || !event.event_end_time) {
      return false;
    }

    // Require event_date
    if (!event.event_date) {
      return false;
    }

    // 2026-01-10: NO FALLBACKS - timezone MUST come from snapshot
    // If timezone is missing, this is a data integrity bug upstream
    if (!timezone) {
      console.error('[BriefingTab] isEventForToday: Missing timezone - this is a critical data bug');
      return false; // Fail safe: don't show events if we can't determine "today" correctly
    }

    try {
      // Calculate "today" in the snapshot's timezone (NOT browser timezone)
      // Using Intl.DateTimeFormat with 'en-CA' locale gives YYYY-MM-DD format
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(now);

      const eventStartDate = event.event_date; // YYYY-MM-DD format
      const eventEndDate = event.event_end_date || event.event_date; // If no end date, use start date

      // Check if today falls within the event date range (inclusive)
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

  // Extract data from props
  const weather = weatherData?.weather;
  const traffic = trafficData?.traffic;
  const news = newsData?.news;
  const allEvents = (eventsData?.events || []).map((event: BriefingEvent) => ({
    ...event,
    // Ensure title exists (required by EventsComponent)
    title: event.title || 'Untitled Event',
    // Map event_type to subtype for EventsComponent compatibility
    subtype: event.event_type || event.subtype,
    // Map location to venue for EventsComponent compatibility
    venue: event.venue || event.location,
  }));
  const _eventsReason = eventsData?.reason || null;
  
  const allClosures = schoolClosuresData?.school_closures || [];
  const closuresReason = schoolClosuresData?.reason || null;
  const schoolClosures = allClosures.filter(isClosureRelevant);

  // Debug: Log closures data transformation
  if (allClosures.length > 0 || schoolClosures.length > 0) {
    console.log('[BriefingTab] School closures:', {
      allClosuresCount: allClosures.length,
      filteredCount: schoolClosures.length,
      allClosures: allClosures.map(c => ({ name: c.schoolName, start: c.closureStart, end: c.reopeningDate })),
      closuresReason
    });
  }
  
  // Filter events to show only TODAY's events with valid start/end times
  // Map tab shows full 7-day window; Briefing tab shows today only
  const eventsToday = allEvents.filter(isEventForToday);

  // 2026-01-08: Market events - high-value events from across the market
  const marketName = eventsData?.market_name || null;
  const allMarketEvents = (eventsData?.marketEvents || []).map((event: BriefingEvent) => ({
    ...event,
    title: event.title || 'Untitled Event',
    subtype: event.event_type || event.subtype,
    venue: event.venue || event.location,
  }));
  const marketEventsToday = allMarketEvents.filter(isEventForToday);

  // Debug: Log event filtering
  if (allEvents.length > 0 || allMarketEvents.length > 0) {
    console.log('[BriefingTab] Events filter:', {
      total: allEvents.length,
      todayOnly: eventsToday.length,
      filtered: allEvents.length - eventsToday.length,
      marketTotal: allMarketEvents.length,
      marketTodayOnly: marketEventsToday.length,
      marketName,
      today: new Date().toISOString().split('T')[0]
    });
  }

  const newsItems = (news?.filtered || news?.items || []);
  const newsReason = news?.reason || null;

  // Extract airport data
  const airportConditions = airportData?.airport_conditions;
  const airports = airportConditions?.airports || [];
  const busyPeriods = airportConditions?.busyPeriods || [];
  const airportRecommendations = airportConditions?.recommendations;

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

      {/* Daily Strategy Overview - ON-DEMAND generation */}
      {/* State 1: No strategy yet, show generate button */}
      {!dailyStrategy && !isGeneratingDaily && !showDailyStrategy && (
        <Card
          className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          data-testid="daily-strategy-generate-button"
          onClick={generateDailyStrategy}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg group-hover:scale-105 transition-transform">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900 text-lg">Daily Strategy Report</h3>
                  <p className="text-sm text-purple-600">Generate AI-powered 8-12 hour strategic briefing</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-purple-300 text-purple-700 hover:bg-purple-100 hover:border-purple-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                Generate Report
              </Button>
            </div>
            {dailyError && (
              <p className="text-red-600 text-sm mt-3">{dailyError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* State 2: Generating strategy */}
      {isGeneratingDaily && (
        <Card
          className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300"
          data-testid="daily-strategy-loading"
        >
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg">
                <Loader className="w-6 h-6 text-white animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-purple-900 text-lg">Generating Daily Strategy...</h3>
                <p className="text-sm text-purple-600">AI is analyzing conditions for your 8-12 hour plan (30-60s)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Show error if generation failed */}
      {dailyError && !isGeneratingDaily && !dailyStrategy && (
        <Card className="bg-red-50 border-red-300" data-testid="daily-strategy-error">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-500 shadow-lg">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 text-lg">Strategy Generation Failed</h3>
                <p className="text-sm text-red-600">{dailyError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={generateDailyStrategy}
                className="bg-white border-red-300 text-red-700 hover:bg-red-100"
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 3: Strategy exists but collapsed - show reveal button */}
      {dailyStrategy && !showDailyStrategy && !isGeneratingDaily && (
        <Card
          className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          data-testid="daily-strategy-button"
          onClick={() => setShowDailyStrategy(true)}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg group-hover:scale-105 transition-transform">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900 text-lg">Daily Strategy Report</h3>
                  <p className="text-sm text-purple-600">AI-generated 8-12 hour strategic briefing</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-purple-300 text-purple-700 hover:bg-purple-100 hover:border-purple-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                View Report
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 4: Strategy exists and expanded - show full content */}
      {dailyStrategy && showDailyStrategy && (
        <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 shadow-lg" data-testid="daily-strategy-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-100">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-purple-900">Today's Strategy</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                  ✅ Complete
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDailyStrategy(false)}
                  className="text-purple-600 hover:text-purple-800 hover:bg-purple-100 text-xs h-7 px-2"
                >
                  Collapse
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{dailyStrategy}</p>
          </CardContent>
        </Card>
      )}

      {/* Refresh Daily Data Card - ON-DEMAND AI search for events + news */}
      {/* State 1: Not yet run, show refresh button */}
      {!dailyRefreshResult && !isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          data-testid="refresh-daily-button"
          onClick={refreshDailyData}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg group-hover:scale-105 transition-transform">
                  <CalendarSearch className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900 text-lg">Refresh Daily Data</h3>
                  <p className="text-sm text-emerald-600">AI-powered search for events + news (SerpAPI, GPT-5.2, Gemini, Claude...)</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                Refresh
              </Button>
            </div>
            {refreshError && (
              <p className="text-red-600 text-sm mt-3">{refreshError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* State 2: Refreshing daily data */}
      {isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300"
          data-testid="refresh-daily-loading"
        >
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                <Loader className="w-6 h-6 text-white animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-emerald-900 text-lg">Refreshing Daily Data...</h3>
                <p className="text-sm text-emerald-600">Fetching events + news across AI models (may take 30-60s)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 3: Refresh complete - show results */}
      {dailyRefreshResult && !isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300 shadow-lg"
          data-testid="refresh-daily-complete"
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                  <CalendarSearch className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900 text-lg">Daily Data Refreshed</h3>
                  <p className="text-sm text-emerald-600">
                    Events: {dailyRefreshResult.events.total} found • {dailyRefreshResult.events.inserted} new | News: {dailyRefreshResult.news.count} items
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                  ✅ Complete
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshDailyData}
                  className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Refresh Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weather Forecast Card - 6 Hour Only */}
      {weather?.forecast && weather.forecast.length > 0 && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200" data-testid="weather-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-600" />
              6-Hour Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {weather.forecast.slice(0, 6).map((hour, idx) => (
                <div key={idx} className="flex flex-col items-center min-w-[70px] text-center p-2 bg-white/50 rounded">
                  <span className="text-xs text-gray-500 font-medium">
                    {hour.time ? new Date(hour.time).toLocaleTimeString([], { hour: 'numeric' }) : `+${idx + 1}h`}
                  </span>
                  <div className="my-1">{getWeatherIcon(hour.conditionType, hour.isDaytime)}</div>
                  <span className="text-sm font-medium text-gray-800">
                    {hour.tempF || 0}°F
                  </span>
                  {hour.precipitationProbability !== null && hour.precipitationProbability > 0 && (
                    <span className="text-xs text-blue-600 font-medium">{hour.precipitationProbability}% rain</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Traffic Card */}
      <Card className="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200" data-testid="traffic-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-orange-100/50 transition-colors"
          onClick={() => setExpandedTraffic(!expandedTraffic)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {!traffic ? (
                <Loader className="w-5 h-5 animate-spin text-orange-600" />
              ) : (
                <>
                  <Car className="w-5 h-5 text-orange-600" />
                  Traffic Conditions
                  {traffic && (
                    <Badge variant="outline" className={`ml-2 ${getCongestionColor(traffic.congestionLevel)} bg-orange-100 border-orange-300`}>
                      {traffic.congestionLevel}
                    </Badge>
                  )}
                </>
              )}
            </CardTitle>
            {expandedTraffic ? (
              <ChevronUp className="w-5 h-5 text-orange-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-orange-600" />
            )}
          </div>
        </CardHeader>
        {expandedTraffic && (
          <CardContent>
            {!traffic ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-orange-600 mr-2" />
                <span className="text-gray-600">Loading traffic...</span>
              </div>
            ) : traffic ? (
              <div className="space-y-3">
                {/* Traffic Briefing (3-4 sentences) */}
                <div className="p-3 bg-white/50 rounded-lg border border-orange-100">
                  <p className="text-gray-700 font-medium leading-relaxed">
                    {traffic.briefing || traffic.summary || 'No significant traffic issues'}
                  </p>
                </div>

                {/* Key Issues - if available */}
                {traffic.keyIssues && traffic.keyIssues.length > 0 && (
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-sm font-semibold text-amber-800 mb-2">Key Issues:</p>
                    <ul className="space-y-1">
                      {traffic.keyIssues.map((issue, idx) => (
                        <li key={idx} className="text-sm text-amber-700 flex items-start gap-2">
                          <span className="text-amber-500">•</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Collapsible Active Incidents */}
                {traffic.incidents && traffic.incidents.length > 0 && (
                  <div className="border border-orange-200 rounded-lg overflow-hidden">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIncidents(!expandedIncidents);
                      }}
                      className="w-full flex items-center justify-between p-3 bg-orange-50 hover:bg-orange-100 transition-colors"
                    >
                      <span className="text-sm font-medium text-orange-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        Active Incidents ({traffic.incidentsCount || traffic.incidents.length})
                      </span>
                      {expandedIncidents ? (
                        <ChevronUp className="w-4 h-4 text-orange-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-orange-600" />
                      )}
                    </button>
                    {expandedIncidents && (
                      <div className="p-3 space-y-2 bg-white/50">
                        {traffic.incidents.map((incident, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-2 bg-white rounded border border-orange-100">
                            <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm text-gray-700">{incident.description}</p>
                              <Badge variant="outline" className="text-xs mt-1 bg-orange-100 text-orange-700 border-orange-300">
                                {incident.severity}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Driver Impact - if available */}
                {traffic.driverImpact && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <span className="font-semibold">Driver Impact:</span> {traffic.driverImpact}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Traffic data not available</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Airport / Flight Delays Card */}
      <Card className="bg-gradient-to-r from-sky-50 to-cyan-50 border-sky-200" data-testid="airport-card">
        <CardHeader
          className="pb-2 cursor-pointer hover:bg-sky-100/50 transition-colors"
          onClick={() => setExpandedAirport(!expandedAirport)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {!airportData ? (
                <Loader className="w-5 h-5 animate-spin text-sky-600" />
              ) : (
                <>
                  <Plane className="w-5 h-5 text-sky-600" />
                  Airport Conditions
                  {airports.length > 0 && (
                    <Badge variant="outline" className="bg-sky-100 text-sky-700 border-sky-300 ml-2">
                      {airports.length} {airports.length === 1 ? 'airport' : 'airports'}
                    </Badge>
                  )}
                </>
              )}
            </CardTitle>
            {expandedAirport ? (
              <ChevronUp className="w-5 h-5 text-sky-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-sky-600" />
            )}
          </div>
        </CardHeader>
        {expandedAirport && (
          <CardContent>
            {/* Show loading if: no data yet OR no airport_conditions (API hasn't returned real data) */}
            {!airportData || !airportData.airport_conditions ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-sky-600 mr-2" />
                <span className="text-gray-600">Loading airport data...</span>
              </div>
            ) : airports.length > 0 ? (
              <div className="space-y-4">
                {/* AI Recommendations */}
                {airportRecommendations && (
                  <div className="p-3 bg-gradient-to-r from-sky-100 to-cyan-100 rounded-lg border border-sky-200">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-sky-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-sky-800 font-medium">{airportRecommendations}</p>
                    </div>
                  </div>
                )}

                {/* Airport Cards */}
                {airports.map((airport, idx) => {
                  // Normalize status field (server may send 'status' or 'overallStatus')
                  const airportStatus = airport.overallStatus || airport.status || 'normal';

                  return (
                  <div
                    key={idx}
                    className="p-4 bg-white/60 rounded-lg border border-sky-100 hover:border-sky-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-sky-100">
                          <Plane className="w-5 h-5 text-sky-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{airport.code}</h4>
                          <p className="text-xs text-gray-500">{airport.name}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={getAirportStatusColor(airportStatus)}>
                        {getAirportStatusLabel(airportStatus)}
                      </Badge>
                    </div>

                    {/* Delay Description - show the AI-generated summary */}
                    {airport.delays && (
                      <div className="p-3 bg-white/50 rounded-lg border border-sky-100 mb-3">
                        <p className="text-sm text-gray-700">{airport.delays}</p>
                      </div>
                    )}

                    {/* Busy Times for this airport */}
                    {airport.busyTimes && airport.busyTimes.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <Clock className="w-4 h-4 text-sky-500" />
                        <span className="text-xs text-gray-500">Busy:</span>
                        {airport.busyTimes.map((time, tidx) => (
                          <Badge key={tidx} variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs">
                            {time}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Structured Delay Info - only show if available (FAA API format) */}
                    {(airport.arrivalDelays || airport.departureDelays) && (
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {/* Arrivals */}
                      <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-100">
                        <PlaneLanding className="w-4 h-4 text-green-600" />
                        <div>
                          <p className="text-xs text-gray-500">Arrivals</p>
                          <p className="text-sm font-medium text-gray-700">
                            {airport.arrivalDelays?.status === 'none' ? 'On Time' :
                              airport.arrivalDelays?.avgMinutes ? `~${airport.arrivalDelays.avgMinutes} min delay` :
                                airport.arrivalDelays?.status || 'Normal'}
                          </p>
                        </div>
                      </div>

                      {/* Departures */}
                      <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                        <PlaneTakeoff className="w-4 h-4 text-blue-600" />
                        <div>
                          <p className="text-xs text-gray-500">Departures</p>
                          <p className="text-sm font-medium text-gray-700">
                            {airport.departureDelays?.status === 'none' ? 'On Time' :
                              airport.departureDelays?.avgMinutes ? `~${airport.departureDelays.avgMinutes} min delay` :
                                airport.departureDelays?.status || 'Normal'}
                          </p>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Ground Stops Warning */}
                    {airport.groundStops && (
                      <div className="flex items-center gap-2 p-2 bg-red-50 rounded border border-red-200 mb-3">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <span className="text-sm font-medium text-red-700">Ground Stop in Effect</span>
                      </div>
                    )}

                    {/* Weather */}
                    {airport.weather && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <Cloud className="w-4 h-4 text-gray-400" />
                        <span>{airport.weather}</span>
                      </div>
                    )}

                    {/* Tips for Drivers */}
                    {airport.tipsForDrivers && (
                      <div className="p-2 bg-amber-50 rounded border border-amber-200">
                        <p className="text-sm text-amber-800">
                          <span className="font-medium">Tip:</span> {airport.tipsForDrivers}
                        </p>
                      </div>
                    )}
                  </div>
                  );
                })}

                {/* Busy Periods */}
                {busyPeriods.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-sky-600" />
                      Busy Pickup Periods
                    </p>
                    {busyPeriods.map((period, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-2 bg-white/50 rounded border border-sky-100">
                        {/* Handle both string format and object format */}
                        {typeof period === 'string' ? (
                          <span className="text-sm text-gray-700 flex items-center gap-2">
                            <Clock className="w-3 h-3 text-sky-500" />
                            {period}
                          </span>
                        ) : (
                          <>
                            <Badge variant="outline" className="bg-sky-100 text-sky-700 border-sky-300 font-mono text-xs">
                              {period.time}
                            </Badge>
                            <span className="text-sm text-gray-600">
                              <span className="font-medium">{period.airport}</span> - {period.reason}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                {airportConditions?.isFallback ? 'Airport data temporarily unavailable' : 'No nearby airports found'}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Rideshare News Card */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200" data-testid="rideshare-news-card">
        <CardHeader
          className="pb-2 cursor-pointer hover:bg-purple-100/50 transition-colors"
          onClick={() => setExpandedNews(!expandedNews)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {!news ? (
                <Loader className="w-5 h-5 animate-spin text-purple-600" />
              ) : (
                <>
                  <Newspaper className="w-5 h-5 text-purple-600" />
                  Rideshare News
                  {newsItems.length > 0 && (
                    <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 ml-2">
                      {newsItems.length}
                    </Badge>
                  )}
                </>
              )}
            </CardTitle>
            {expandedNews ? (
              <ChevronUp className="w-5 h-5 text-purple-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-purple-600" />
            )}
          </div>
        </CardHeader>
        {expandedNews && (
          <CardContent>
            {!news ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">Loading news...</span>
              </div>
            ) : newsItems.length > 0 ? (
              <div className="space-y-3">
                {newsItems.map((item, idx) => (
                  <article 
                    key={idx} 
                    className="p-3 bg-white/50 rounded-lg border border-purple-100 hover:border-purple-300 transition-colors"
                    data-testid={`news-item-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-800 text-sm">{item.title}</h4>
                        {item.published_date && (
                          <span className="text-xs text-gray-400">{item.published_date}</span>
                        )}
                      </div>
                      <Badge variant="outline" className={getImpactColor(item.impact)}>
                        {item.impact}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{item.summary}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{item.source}</span>
                      {item.link && (
                        <a 
                          href={item.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-purple-600 hover:text-purple-800 font-medium"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Link
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                {newsReason || 'No rideshare news today'}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* All Events - Consolidated Component */}
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

      {/* Major Events in Your Market - Collapsible, Collapsed by Default */}
      {/* 2026-01-08: Shows high-value events from across the market (stadiums, arenas, conventions) */}
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

      {/* School Closures Section - LAST */}
      <Card data-testid="school-closures-card">
        <CardHeader>
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpandedClosures(!expandedClosures)}>
            <BookOpen className="w-5 h-5 text-purple-600" />
            <CardTitle className="text-base">School Closures ({schoolClosures.length})</CardTitle>
            {expandedClosures ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardHeader>
        {expandedClosures && (
          <CardContent>
            {!schoolClosuresData ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">Loading...</span>
              </div>
            ) : schoolClosures.length > 0 ? (
              <div className="space-y-3">
                {schoolClosures.map((closure, idx) => (
                  <div
                    key={idx}
                    className="border rounded-lg p-3 bg-gradient-to-r from-purple-50 to-blue-50"
                    data-testid={`closure-${closure.type}-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900">{closure.schoolName}</p>
                          <Badge variant="outline" className="text-xs">
                            {closure.type === 'college' ? '🎓 College' : '🏫 District'}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{closure.reason}</p>
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-500" />
                            <span>Closed: {formatDate(closure.closureStart)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-green-600" />
                            <span>Reopens: {formatDate(closure.reopeningDate)}</span>
                          </div>
                        </div>
                      </div>
                      <Badge className={`${
                        closure.impact === 'high' ? 'bg-red-100 text-red-700' :
                        closure.impact === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {closure.impact} impact
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                {closuresReason || 'No school closures reported'}
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
