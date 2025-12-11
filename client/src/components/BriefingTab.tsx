import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Newspaper, Cloud, CloudRain, Sun,
  AlertTriangle, Car, Loader, Clock, ExternalLink,
  ChevronDown, ChevronUp, BookOpen, Sparkles, FileText, Zap
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
  event_date?: string;
  event_type?: string;
  subtype?: string;
  [key: string]: unknown;
}

interface BriefingTabProps {
  snapshotId?: string;
  weatherData?: unknown;
  trafficData?: unknown;
  newsData?: unknown;
  eventsData?: { events?: BriefingEvent[]; reason?: string };
  schoolClosuresData?: { school_closures?: SchoolClosure[]; reason?: string };
  consolidatedStrategy?: string;
}

export default function BriefingTab({ 
  snapshotId, 
  weatherData, 
  trafficData, 
  newsData, 
  eventsData, 
  schoolClosuresData,
  consolidatedStrategy
}: BriefingTabProps) {
  const [_expandedWeather, _setExpandedWeather] = useState(true);
  const [expandedTraffic, setExpandedTraffic] = useState(true);
  const [expandedNews, setExpandedNews] = useState(true);
  const [expandedClosures, setExpandedClosures] = useState(true);

  // Daily strategy - on-demand generation
  const [showDailyStrategy, setShowDailyStrategy] = useState(false);
  const [dailyStrategy, setDailyStrategy] = useState<string | null>(consolidatedStrategy || null);
  const [isGeneratingDaily, setIsGeneratingDaily] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

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
    hasClosures: !!schoolClosuresData
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

  const _isEventToday = (_event: BriefingEvent): boolean => {
    // Always return true - show all events regardless of date
    // The briefing service should already filter by date
    return true;
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
  
  // Show all events and news - backend already filters by relevance/date
  const eventsToday = allEvents;
  const newsItems = (news?.filtered || news?.items || []);
  const newsReason = news?.reason || null;

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
                <p className="text-sm text-purple-600">AI is analyzing conditions for your 8-12 hour plan</p>
              </div>
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
                {/* Traffic Summary */}
                <div className="p-3 bg-white/50 rounded-lg border border-orange-100">
                  <p className="text-gray-700 font-medium">{traffic.summary || 'No significant traffic issues'}</p>
                </div>

                {/* Traffic Incidents */}
                {traffic.incidents && traffic.incidents.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Active Incidents ({traffic.incidents.length}):</p>
                    {traffic.incidents.map((incident, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-3 bg-white/50 rounded border border-orange-100">
                        <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm text-gray-700 font-medium">{incident.description}</p>
                          <Badge variant="outline" className="text-xs mt-2 bg-orange-100 text-orange-700 border-orange-300">
                            {incident.severity}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Traffic data not available</p>
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
                      <h4 className="font-medium text-gray-800 text-sm flex-1">{item.title}</h4>
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
      {!eventsData ? (
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
