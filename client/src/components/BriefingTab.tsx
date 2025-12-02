import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Newspaper, Cloud, CloudRain, Sun, CloudSun, Thermometer, Wind, Droplets,
  AlertTriangle, Car, RefreshCw, Loader, Clock, ExternalLink, TrendingUp,
  ChevronDown, ChevronUp, BookOpen
} from "lucide-react";

interface NewsItem {
  title: string;
  summary: string;
  impact: "high" | "medium" | "low";
  source: string;
  link?: string;
}

interface WeatherCurrent {
  temperature: { degrees: number; unit: string } | null;
  feelsLike: { degrees: number; unit: string } | null;
  conditions: string | null;
  conditionType: string | null;
  humidity: number | null;
  windSpeed: { value: number; unit: string } | null;
  windDirection: string | null;
  uvIndex: number | null;
  precipitation: { value: number; unit: string } | null;
  visibility: { value: number; unit: string } | null;
  isDaytime: boolean | null;
  observedAt: string | null;
}

interface WeatherForecast {
  time: string;
  temperature: { degrees: number; unit: string } | null;
  conditions: string | null;
  conditionType: string | null;
  precipitationProbability: number | null;
  windSpeed: { value: number; unit: string } | null;
  isDaytime: boolean | null;
}

interface TrafficConditions {
  summary: string | null;
  incidents: { description: string; severity: string }[];
  congestionLevel: "low" | "medium" | "high";
  fetchedAt: string;
}

interface SchoolClosure {
  schoolName: string;
  closureStart: string;
  reopeningDate: string;
  type: 'district' | 'college';
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

interface BriefingData {
  snapshot_id: string;
  location: {
    city: string;
    state: string;
    lat: number;
    lng: number;
  };
  briefing: {
    news: {
      items: NewsItem[];
      filtered: NewsItem[];
      fetchedAt: string;
      error?: string;
    } | null;
    weather: {
      current: WeatherCurrent | null;
      forecast: WeatherForecast[] | null;
    };
    traffic: TrafficConditions | null;
    events: unknown[] | null;
    school_closures: SchoolClosure[] | null;
  };
  created_at: string;
  updated_at: string;
}

interface BriefingTabProps {
  snapshotId?: string;
  persistedData?: BriefingData | null;
  persistedLoading?: boolean;
}

export default function BriefingTab({ snapshotId, persistedData, persistedLoading }: BriefingTabProps) {
  const [data, setData] = useState<BriefingData | null>(persistedData || null);
  const [loading, setLoading] = useState(persistedLoading || false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedWeather, setExpandedWeather] = useState(true);
  const [expandedTraffic, setExpandedTraffic] = useState(true);
  const [expandedNews, setExpandedNews] = useState(true);

  const fetchBriefing = useCallback(async (forceRefresh = false) => {
    console.log('[BriefingTab] fetchBriefing called:', { snapshotId, forceRefresh });
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const endpoint = forceRefresh 
        ? '/api/briefing/refresh'
        : snapshotId 
          ? `/api/briefing/snapshot/${snapshotId}`
          : '/api/briefing/current';
      
      const options = forceRefresh 
        ? { method: 'POST' }
        : { method: 'GET' };
      
      console.log('[BriefingTab] Fetching from:', endpoint);
      const response = await fetch(endpoint, options);
      const result = await response.json();
      
      console.log('[BriefingTab] Response:', { status: response.status, ok: response.ok, result });

      if (response.ok) {
        if (forceRefresh && result.briefing) {
          setData({
            snapshot_id: result.snapshot_id || snapshotId || '',
            location: result.location || { city: '', state: '', lat: 0, lng: 0 },
            briefing: result.briefing,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        } else {
          console.log('[BriefingTab] Setting data:', result);
          setData(result);
        }
      } else {
        setError(result.error || "Failed to fetch briefing");
      }
    } catch (err) {
      setError("Network error - please try again");
      console.error("BriefingTab fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshotId]);

  // Fetch real-time traffic data separately for always-fresh conditions
  const fetchRealtimeTraffic = useCallback(async () => {
    if (!data?.location) return;
    
    try {
      const params = new URLSearchParams({
        lat: data.location.lat.toString(),
        lng: data.location.lng.toString(),
        city: data.location.city || 'Unknown',
        state: data.location.state || ''
      });

      const response = await fetch(`/api/briefing/traffic/realtime?${params}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && data) {
          setData({
            ...data,
            briefing: {
              ...data.briefing,
              traffic: result.traffic
            },
            updated_at: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.error("Traffic realtime fetch error:", err);
    }
  }, [data]);

  // Fetch real-time weather data separately for always-fresh conditions
  const fetchRealtimeWeather = useCallback(async () => {
    if (!data?.location) return;
    
    try {
      const params = new URLSearchParams({
        lat: data.location.lat.toString(),
        lng: data.location.lng.toString()
      });

      const response = await fetch(`/api/briefing/weather/realtime?${params}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && data) {
          setData({
            ...data,
            briefing: {
              ...data.briefing,
              weather: result.weather
            },
            updated_at: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.error("Weather realtime fetch error:", err);
    }
  }, [data]);

  // Use persisted data from parent when available, fetch independently only on tab switch if needed
  useEffect(() => {
    if (persistedData) {
      console.log('[BriefingTab] Using persisted data from parent');
      setData(persistedData);
      setLoading(false);
    } else if (snapshotId) {
      console.log('[BriefingTab] useEffect triggered with no persisted data:', { snapshotId });
      fetchBriefing();
    }
  }, [snapshotId, persistedData, fetchBriefing]);

  const celsiusToFahrenheit = (celsius: number) => {
    return Math.round((celsius * 9/5) + 32);
  };

  const getWeatherIcon = (conditionType?: string | null, isDaytime?: boolean | null) => {
    if (!conditionType) return <Cloud className="w-6 h-6 text-gray-500" />;
    const type = conditionType.toLowerCase();
    if (type.includes('rain') || type.includes('shower')) return <CloudRain className="w-6 h-6 text-blue-500" />;
    if (type.includes('clear') || type.includes('sunny')) {
      return isDaytime ? <Sun className="w-6 h-6 text-yellow-500" /> : <Cloud className="w-6 h-6 text-gray-400" />;
    }
    if (type.includes('partly') || type.includes('cloud')) return <CloudSun className="w-6 h-6 text-gray-400" />;
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

  if (loading) {
    return (
      <Card data-testid="briefing-loading">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-indigo-600 mb-4" />
            <p className="text-gray-600">Loading briefing data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="briefing-error">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="w-8 h-8 text-red-500 mb-4" />
            <p className="text-red-600 mb-4">{error}</p>
            <Button onClick={() => fetchBriefing()} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="briefing-no-data">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-12">
            <Newspaper className="w-8 h-8 text-gray-400 mb-4" />
            <p className="text-gray-500">No briefing data available</p>
            <p className="text-sm text-gray-400 mt-2">Create a new snapshot to generate a briefing</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { briefing, location, updated_at } = data;
  const newsItems = briefing?.news?.filtered || briefing?.news?.items || [];
  const weather = briefing?.weather;
  const traffic = briefing?.traffic;
  const schoolClosures = (briefing?.school_closures as SchoolClosure[]) || [];

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6" data-testid="briefing-container">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Newspaper className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-800">Driver Briefing</h2>
          {location?.city && (
            <Badge variant="outline" className="ml-2">
              {location.city}, {location.state}
            </Badge>
          )}
          {data?.snapshot_id && (
            <Badge variant="outline" className="text-xs font-mono bg-gray-100 text-gray-600">
              Snapshot: {data.snapshot_id.slice(0, 8)}...
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fetchRealtimeWeather()}
            disabled={refreshing}
            data-testid="refresh-weather"
            title="Refresh weather conditions"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">Weather</span>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fetchRealtimeTraffic()}
            disabled={refreshing}
            data-testid="refresh-traffic"
            title="Refresh traffic conditions"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="ml-2 hidden sm:inline">Traffic</span>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fetchBriefing(true)}
            disabled={refreshing}
            data-testid="refresh-briefing"
          >
            {refreshing ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-2 hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </Button>
        </div>
      </div>

      {updated_at && data?.snapshot_id && (
        <p className="text-xs text-gray-500 flex items-center gap-2">
          <Clock className="w-3 h-3" />
          <span>Last updated: {new Date(updated_at).toLocaleTimeString()}</span>
          <span className="text-gray-400">• Snapshot ID: {data.snapshot_id}</span>
        </p>
      )}
      {updated_at && !data?.snapshot_id && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last updated: {new Date(updated_at).toLocaleTimeString()}
        </p>
      )}

      {/* School Closures Section */}
      {schoolClosures.length > 0 && (
        <Card data-testid="school-closures-card">
          <CardHeader>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpandedNews(!expandedNews)}>
              <BookOpen className="w-5 h-5 text-purple-600" />
              <CardTitle className="text-base">School Closures ({schoolClosures.length})</CardTitle>
              {expandedNews ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </CardHeader>
          {expandedNews && (
            <CardContent className="space-y-3">
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
                  <p className="text-xs text-gray-600 mt-2 italic">
                    💡 Campus parking, pickup zones, and shuttle services may be unavailable during closures.
                  </p>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Weather Card - Collapsible */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200" data-testid="weather-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-blue-100/50 transition-colors"
          onClick={() => setExpandedWeather(!expandedWeather)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {weather?.current && getWeatherIcon(weather.current.conditionType, weather.current.isDaytime)}
              Current Weather
              {weather?.current?.temperature && (
                <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 ml-2">
                  {celsiusToFahrenheit(weather.current.temperature.degrees)}°F
                </Badge>
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
            {weather?.current ? (
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
                          <div className="my-1">
                            {getWeatherIcon(hour.conditionType, hour.isDaytime)}
                          </div>
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

      {/* Traffic Card - Collapsible */}
      <Card className="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200" data-testid="traffic-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-orange-100/50 transition-colors"
          onClick={() => setExpandedTraffic(!expandedTraffic)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="w-5 h-5 text-orange-600" />
              Traffic Conditions
              {traffic && (
                <Badge variant="outline" className={`ml-2 ${getCongestionColor(traffic.congestionLevel).replace('text-', 'text-')} bg-orange-100 border-orange-300`}>
                  {traffic.congestionLevel}
                </Badge>
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
            {traffic ? (
              <div className="space-y-3">
                <div className="p-3 bg-white/50 rounded-lg">
                  <p className="text-gray-700 font-medium">{traffic.summary || 'No significant traffic issues'}</p>
                </div>
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

      {/* News Card - Collapsible */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200" data-testid="news-card">
        <CardHeader 
          className="pb-2 cursor-pointer hover:bg-purple-100/50 transition-colors"
          onClick={() => setExpandedNews(!expandedNews)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-purple-600" />
              Rideshare News
              {newsItems.length > 0 && (
                <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 ml-2">
                  {newsItems.length}
                </Badge>
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
            {newsItems.length > 0 ? (
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
            ) : briefing?.news?.error ? (
              <div className="text-center py-4">
                <AlertTriangle className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Unable to fetch news</p>
                <p className="text-xs text-gray-400 mt-1">{briefing.news.error}</p>
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                No rideshare-related news in the past 48 hours
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
