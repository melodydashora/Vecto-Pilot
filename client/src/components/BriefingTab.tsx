import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Newspaper, Cloud, CloudRain, Sun, Wind, Droplets,
  AlertTriangle, Car, RefreshCw, Loader, Clock, ExternalLink,
  ChevronDown, ChevronUp, BookOpen
} from "lucide-react";
import EventsComponent from "./EventsComponent";

interface SchoolClosure {
  schoolName: string;
  closureStart: string;
  reopeningDate: string;
  type: 'district' | 'college';
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

interface BriefingTabProps {
  snapshotId?: string;
}

export default function BriefingTab({ snapshotId }: BriefingTabProps) {
  const [expandedWeather, setExpandedWeather] = useState(true);
  const [expandedTraffic, setExpandedTraffic] = useState(true);
  const [expandedNews, setExpandedNews] = useState(true);
  const [expandedClosures, setExpandedClosures] = useState(true);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  // Component-level queries - each loads independently
  const weatherQuery = useQuery({
    queryKey: ['/api/briefing/weather', snapshotId],
    queryFn: async () => {
      if (!snapshotId || !token) return { weather: null };
      try {
        const response = await fetch(`/api/briefing/weather/${snapshotId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return { weather: null };
        return response.json();
      } catch (error) {
        console.log('Weather fetch error:', error);
        return { weather: null };
      }
    },
    enabled: !!snapshotId,
    staleTime: 30000,
  });

  const trafficQuery = useQuery({
    queryKey: ['/api/briefing/traffic', snapshotId],
    queryFn: async () => {
      if (!snapshotId || !token) return { traffic: null };
      try {
        const response = await fetch(`/api/briefing/traffic/${snapshotId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return { traffic: null };
        return response.json();
      } catch (error) {
        console.log('Traffic fetch error:', error);
        return { traffic: null };
      }
    },
    enabled: !!snapshotId,
    staleTime: 30000,
  });

  const rideshareNewsQuery = useQuery({
    queryKey: ['/api/briefing/rideshare-news', snapshotId],
    queryFn: async () => {
      if (!snapshotId || !token) return { news: null };
      try {
        const response = await fetch(`/api/briefing/rideshare-news/${snapshotId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return { news: null };
        return response.json();
      } catch (error) {
        console.log('News fetch error:', error);
        return { news: null };
      }
    },
    enabled: !!snapshotId,
    staleTime: 45000,
  });

  // Single events query that fetches all events (local events + live music + concerts) with Places API resolution
  const eventsQuery = useQuery({
    queryKey: ['/api/briefing/events', snapshotId],
    queryFn: async () => {
      if (!snapshotId || !token) return { events: [] };
      try {
        const response = await fetch(`/api/briefing/events/${snapshotId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return { events: [] };
        return response.json();
      } catch (error) {
        console.log('Events fetch error:', error);
        return { events: [] };
      }
    },
    enabled: !!snapshotId,
    staleTime: 45000,
  });

  const schoolClosuresQuery = useQuery({
    queryKey: ['/api/briefing/school-closures', snapshotId],
    queryFn: async () => {
      if (!snapshotId || !token) return { school_closures: [] };
      try {
        const response = await fetch(`/api/briefing/school-closures/${snapshotId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return { school_closures: [] };
        return response.json();
      } catch (error) {
        console.log('School closures fetch error:', error);
        return { school_closures: [] };
      }
    },
    enabled: !!snapshotId,
    staleTime: 45000,
  });

  // Utility functions
  const celsiusToFahrenheit = (celsius: number) => Math.round((celsius * 9/5) + 32);

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

  const isClosureActive = (closure: SchoolClosure): boolean => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const closureStart = new Date(closure.closureStart);
      closureStart.setHours(0, 0, 0, 0);
      const reopeningDate = new Date(closure.reopeningDate);
      reopeningDate.setHours(0, 0, 0, 0);
      return today >= closureStart && today <= reopeningDate;
    } catch {
      return true;
    }
  };

  const isEventToday = (event: any): boolean => {
    try {
      if (!event.event_date) return true; // Show all events if no date
      const eventDate = new Date(event.event_date);
      const today = new Date();
      return eventDate.toDateString() === today.toDateString();
    } catch {
      return true;
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

  // Extract data from queries
  const weather = weatherQuery.data?.weather;
  const traffic = trafficQuery.data?.traffic;
  const news = rideshareNewsQuery.data?.news;
  const allEvents = eventsQuery.data?.events || [];
  const allClosures = schoolClosuresQuery.data?.school_closures || [];
  const schoolClosures = allClosures.filter(isClosureActive);
  
  // Filter events by date
  const eventsToday = allEvents.filter(isEventToday);
  const newsItems = (news?.filtered || news?.items || []).filter(isEventToday);

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
        <div className="flex gap-2 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => weatherQuery.refetch()}
            disabled={weatherQuery.isPending}
            data-testid="refresh-weather"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">Weather</span>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => trafficQuery.refetch()}
            disabled={trafficQuery.isPending}
            data-testid="refresh-traffic"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">Traffic</span>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => rideshareNewsQuery.refetch()}
            disabled={rideshareNewsQuery.isPending}
            data-testid="refresh-news"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">News</span>
          </Button>
        </div>
      </div>

      {/* Weather Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200" data-testid="weather-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-blue-100/50 transition-colors"
          onClick={() => setExpandedWeather(!expandedWeather)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {weatherQuery.isLoading ? (
                <Loader className="w-5 h-5 animate-spin text-blue-600" />
              ) : (
                <>
                  {weather?.current && getWeatherIcon(weather.current.conditionType, weather.current.isDaytime)}
                  Current Weather
                  {weather?.current?.temperature && (
                    <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 ml-2">
                      {celsiusToFahrenheit(weather.current.temperature.degrees)}°F
                    </Badge>
                  )}
                </>
              )}
            </CardTitle>
            {expandedWeather ? (
              <ChevronUp className="w-5 h-5 text-blue-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-blue-600" />
            )}
          </div>
        </CardHeader>
        {expandedWeather && (
          <CardContent>
            {weatherQuery.isLoading || !weather?.current ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-blue-600 mr-2" />
                <span className="text-gray-600">Loading weather...</span>
              </div>
            ) : weather?.current ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-bold text-gray-800">
                      {celsiusToFahrenheit(weather.current.temperature?.degrees || 0)}°
                      <span className="text-lg font-normal text-gray-500">F</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-gray-700 font-medium truncate">{weather.current.conditions}</p>
                      {weather.current.feelsLike && (
                        <p className="text-sm text-gray-500 truncate">
                          Feels like {celsiusToFahrenheit(weather.current.feelsLike.degrees)}°F
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm text-gray-600">
                    {weather.current.humidity !== null && (
                      <div className="flex items-center gap-1">
                        <Droplets className="w-4 h-4 text-blue-400" />
                        <div className="text-center">
                          <div className="font-medium">{weather.current.humidity}%</div>
                          <div className="text-xs">Humidity</div>
                        </div>
                      </div>
                    )}
                    {weather.current.windSpeed && (
                      <div className="flex items-center gap-1">
                        <Wind className="w-4 h-4 text-gray-400" />
                        <div className="text-center">
                          <div className="font-medium">{weather.current.windSpeed.value}</div>
                          <div className="text-xs">{weather.current.windDirection}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {weather.forecast && weather.forecast.length > 0 && (
                  <div className="pt-3 border-t border-blue-200">
                    <p className="text-sm font-medium text-gray-700 mb-2">6-Hour Forecast</p>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {weather.forecast.slice(0, 6).map((hour, idx) => (
                        <div key={idx} className="flex flex-col items-center min-w-[70px] text-center p-2 bg-white/50 rounded">
                          <span className="text-xs text-gray-500 font-medium">
                            {hour.time ? new Date(hour.time).toLocaleTimeString([], { hour: 'numeric' }) : `+${idx + 1}h`}
                          </span>
                          <div className="my-1">{getWeatherIcon(hour.conditionType, hour.isDaytime)}</div>
                          <span className="text-sm font-medium text-gray-800">
                            {celsiusToFahrenheit(hour.temperature?.degrees || 0)}°F
                          </span>
                          {hour.precipitationProbability !== null && hour.precipitationProbability > 0 && (
                            <span className="text-xs text-blue-600 font-medium">{hour.precipitationProbability}% rain</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Weather data not available</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Traffic Card */}
      <Card className="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200" data-testid="traffic-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-orange-100/50 transition-colors"
          onClick={() => setExpandedTraffic(!expandedTraffic)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {trafficQuery.isLoading ? (
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
            {trafficQuery.isLoading || !traffic ? (
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
              {rideshareNewsQuery.isLoading ? (
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
            {rideshareNewsQuery.isLoading || !rideshareNewsQuery.data ? (
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
              <p className="text-gray-500 text-sm text-center py-4">No rideshare news today</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* All Events - Consolidated Component */}
      {eventsQuery.isLoading || !eventsQuery.data ? (
        <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-indigo-600 mr-2" />
              <span className="text-gray-600">Loading events...</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EventsComponent events={eventsToday} isLoading={eventsQuery.isLoading} />
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
            {schoolClosuresQuery.isLoading || !schoolClosuresQuery.data ? (
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
              <p className="text-gray-500 text-sm text-center py-4">No school closures reported</p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
