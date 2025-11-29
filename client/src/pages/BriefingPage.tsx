/**
 * Briefing Tab - Mission Control for Rideshare Intelligence
 * 
 * Consolidates all situational awareness data in one view:
 * - Traffic Conditions
 * - Weather & Air Quality
 * - Flight Status (Airport Delays)
 * - Local Events
 * - News Alerts
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Car, 
  Cloud, 
  Wind, 
  Plane, 
  Calendar, 
  Newspaper, 
  RefreshCw, 
  AlertTriangle,
  Thermometer,
  Droplets,
  Eye,
  MapPin,
  Clock,
  TrendingUp,
  Loader
} from 'lucide-react';
import { useLocation } from '@/contexts/location-context-clean';

interface WeatherData {
  temperature: number;
  feelsLike: number;
  conditions: string;
  description: string;
  humidity: number;
  windSpeed: number;
  visibility?: number;
  icon?: string;
}

interface AirQualityData {
  aqi: number;
  category: string;
  color: string;
  healthRecommendation?: string;
}

interface TrafficItem {
  area: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
  note?: string;
}

interface EventItem {
  name: string;
  title?: string;
  venue?: string;
  time?: string;
  summary?: string;
  impact?: string;
  type?: string;
}

interface NewsItem {
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  impact?: string;
}

interface FlightData {
  airport: string;
  code: string;
  delays: number;
  cancellations: number;
  avgDelay?: number;
  status: 'normal' | 'moderate' | 'severe';
  note?: string;
}

interface BriefingData {
  weather?: WeatherData;
  air?: AirQualityData;
  traffic?: TrafficItem[];
  events?: EventItem[];
  news?: NewsItem[];
  flights?: FlightData[];
  holiday?: string | null;
  city?: string;
  state?: string;
  lastUpdated?: string;
}

export default function BriefingPage() {
  const locationContext = useLocation();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  
  const coords = locationContext?.overrideCoords || locationContext?.currentCoords;
  const city = locationContext?.overrideCoords?.city || '';
  
  // Fetch briefing data from snapshot and strategy APIs
  const { data: briefingData, isLoading, error, refetch, isFetching } = useQuery<BriefingData>({
    queryKey: ['/api/briefing', coords?.latitude, coords?.longitude],
    queryFn: async () => {
      if (!coords?.latitude || !coords?.longitude) {
        return null;
      }
      
      // Fetch weather and air quality directly
      const [weatherRes, airRes] = await Promise.all([
        fetch(`/api/location/weather?lat=${coords.latitude}&lng=${coords.longitude}`).catch(() => null),
        fetch(`/api/location/airquality?lat=${coords.latitude}&lng=${coords.longitude}`).catch(() => null),
      ]);
      
      const weather = weatherRes?.ok ? await weatherRes.json() : null;
      const air = airRes?.ok ? await airRes.json() : null;
      
      // Get latest snapshot for strategy data
      // Try to get the most recent snapshot from local storage first
      const storedSnapshotId = localStorage.getItem('vecto_last_snapshot_id');
      let strategyData = null;
      let snapshotData = null;
      
      if (storedSnapshotId) {
        try {
          const [strategyRes, snapshotRes] = await Promise.all([
            fetch(`/api/blocks/strategy/${storedSnapshotId}`).catch(() => null),
            fetch(`/api/snapshot/${storedSnapshotId}`).catch(() => null),
          ]);
          
          if (strategyRes?.ok) {
            strategyData = await strategyRes.json();
          }
          if (snapshotRes?.ok) {
            snapshotData = await snapshotRes.json();
          }
        } catch (e) {
          console.log('[Briefing] Could not fetch strategy/snapshot data');
        }
      }
      
      // Build briefing from available data
      return {
        weather: weather?.available ? {
          temperature: weather.temperature,
          feelsLike: weather.feelsLike,
          conditions: weather.conditions,
          description: weather.description,
          humidity: weather.humidity,
          windSpeed: weather.windSpeed,
        } : null,
        air: air?.available ? {
          aqi: air.aqi,
          category: air.category,
          color: air.color,
          healthRecommendation: air.healthRecommendation,
        } : null,
        traffic: strategyData?.strategy?.briefing?.traffic || [],
        events: strategyData?.strategy?.briefing?.events || [],
        news: strategyData?.strategy?.briefing?.news || [],
        flights: snapshotData?.airport_context?.flights || generateMockFlightData(),
        holiday: snapshotData?.holiday || strategyData?.strategy?.briefing?.holidays?.[0]?.name,
        city: snapshotData?.city || city,
        state: snapshotData?.state,
        lastUpdated: new Date().toISOString(),
      };
    },
    enabled: !!coords?.latitude && !!coords?.longitude,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
  
  const handleRefresh = () => {
    setLastRefresh(new Date());
    refetch();
  };
  
  // Helper function to generate placeholder flight data when no airport data available
  function generateMockFlightData(): FlightData[] {
    // Return empty for now - will be populated when airport data is available
    return [];
  }
  
  if (!coords?.latitude || !coords?.longitude) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <Card className="max-w-2xl mx-auto">
          <CardContent className="py-12 text-center">
            <MapPin className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Location Required</h2>
            <p className="text-gray-500">Enable location services to view your briefing</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20" data-testid="briefing-page">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900" data-testid="briefing-title">
                Mission Briefing
              </h1>
              <p className="text-sm text-gray-500" data-testid="briefing-location">
                {briefingData?.city}{briefingData?.state ? `, ${briefingData.state}` : ''}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              data-testid="button-refresh-briefing"
            >
              {isFetching ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1">Refresh</span>
            </Button>
          </div>
        </div>
      </div>
      
      {/* Holiday Banner */}
      {briefingData?.holiday && (
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-3" data-testid="holiday-banner">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <span className="text-xl">🎉</span>
            <span className="font-medium">{briefingData.holiday}</span>
            <Badge className="bg-white/20 text-white border-0 ml-2">Holiday Surge Expected</Badge>
          </div>
        </div>
      )}
      
      {/* Content */}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {isLoading ? (
          <BriefingSkeleton />
        ) : error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                <span>Failed to load briefing. Tap refresh to try again.</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Weather & Air Quality Section */}
            <WeatherSection 
              weather={briefingData?.weather} 
              air={briefingData?.air} 
            />
            
            {/* Traffic Conditions Section */}
            <TrafficSection traffic={briefingData?.traffic} />
            
            {/* Flight Status Section */}
            <FlightSection flights={briefingData?.flights} />
            
            {/* Local Events Section */}
            <EventsSection events={briefingData?.events} />
            
            {/* News Alerts Section */}
            <NewsSection news={briefingData?.news} />
          </>
        )}
        
        {/* Last Updated */}
        <div className="text-center text-xs text-gray-400 pt-4" data-testid="last-updated">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

// Weather & Air Quality Section
function WeatherSection({ weather, air }: { weather?: WeatherData | null; air?: AirQualityData | null }) {
  if (!weather && !air) {
    return (
      <Card className="border-l-4 border-l-cyan-500" data-testid="weather-section-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Weather & Air Quality
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Weather data unavailable</p>
        </CardContent>
      </Card>
    );
  }
  
  const getAQIColor = (aqi: number) => {
    if (aqi <= 50) return 'bg-green-100 text-green-700 border-green-300';
    if (aqi <= 100) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (aqi <= 150) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };
  
  const getWeatherIcon = (conditions: string) => {
    const c = conditions?.toLowerCase() || '';
    if (c.includes('rain') || c.includes('drizzle')) return '🌧️';
    if (c.includes('cloud')) return '☁️';
    if (c.includes('sun') || c.includes('clear')) return '☀️';
    if (c.includes('snow')) return '❄️';
    if (c.includes('thunder') || c.includes('storm')) return '⛈️';
    if (c.includes('fog') || c.includes('mist')) return '🌫️';
    return '🌤️';
  };

  return (
    <Card className="border-l-4 border-l-cyan-500" data-testid="weather-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          Weather & Air Quality
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {weather && (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{getWeatherIcon(weather.conditions)}</span>
              <div>
                <div className="text-2xl font-bold text-gray-900">{Math.round(weather.temperature)}°F</div>
                <div className="text-sm text-gray-600 capitalize">{weather.description || weather.conditions}</div>
              </div>
            </div>
            <div className="text-right text-sm text-gray-500 space-y-1">
              <div className="flex items-center gap-1 justify-end">
                <Thermometer className="h-3 w-3" />
                Feels {Math.round(weather.feelsLike)}°
              </div>
              <div className="flex items-center gap-1 justify-end">
                <Droplets className="h-3 w-3" />
                {weather.humidity}%
              </div>
              <div className="flex items-center gap-1 justify-end">
                <Wind className="h-3 w-3" />
                {Math.round(weather.windSpeed)} mph
              </div>
            </div>
          </div>
        )}
        
        {air && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-700">Air Quality</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={getAQIColor(air.aqi)}>
                AQI {air.aqi}
              </Badge>
              <span className="text-sm text-gray-600">{air.category}</span>
            </div>
          </div>
        )}
        
        {air?.healthRecommendation && (
          <p className="text-xs text-gray-500 italic">{air.healthRecommendation}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Traffic Conditions Section
function TrafficSection({ traffic }: { traffic?: TrafficItem[] }) {
  if (!traffic || traffic.length === 0) {
    return (
      <Card className="border-l-4 border-l-blue-500" data-testid="traffic-section-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Car className="h-4 w-4" />
            Traffic Conditions
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              CLEAR
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No significant traffic issues reported</p>
        </CardContent>
      </Card>
    );
  }
  
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };
  
  const overallSeverity = traffic.some(t => t.severity === 'high') ? 'HIGH' :
    traffic.some(t => t.severity === 'medium') ? 'MEDIUM' : 'LOW';

  return (
    <Card className="border-l-4 border-l-blue-500" data-testid="traffic-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Car className="h-4 w-4" />
          Traffic Conditions
          <Badge variant="outline" className={getSeverityColor(overallSeverity.toLowerCase())}>
            {overallSeverity}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {traffic.slice(0, 5).map((item, i) => (
          <div 
            key={i} 
            className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg"
            data-testid={`traffic-item-${i}`}
          >
            <Badge variant="outline" className={`${getSeverityColor(item.severity)} shrink-0 mt-0.5`}>
              {item.severity?.toUpperCase()}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-gray-900">{item.area}</div>
              <p className="text-xs text-gray-600 line-clamp-2">{item.summary || item.note}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Flight Status Section
function FlightSection({ flights }: { flights?: FlightData[] }) {
  if (!flights || flights.length === 0) {
    return (
      <Card className="border-l-4 border-l-indigo-500" data-testid="flight-section-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plane className="h-4 w-4" />
            Flight Status
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No nearby airport data available</p>
          <p className="text-xs text-gray-400 mt-1">Airport surge opportunities will appear here when detected</p>
        </CardContent>
      </Card>
    );
  }
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'severe': return 'bg-red-100 text-red-700 border-red-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  return (
    <Card className="border-l-4 border-l-indigo-500" data-testid="flight-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Plane className="h-4 w-4" />
          Flight Status
          <Badge variant="secondary">{flights.length} airports</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {flights.map((flight, i) => (
          <div 
            key={i} 
            className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
            data-testid={`flight-item-${i}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-gray-900">{flight.code}</span>
              <span className="text-sm text-gray-600">{flight.airport}</span>
            </div>
            <div className="flex items-center gap-2">
              {flight.delays > 0 && (
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                  {flight.delays} delays
                </Badge>
              )}
              {flight.cancellations > 0 && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  {flight.cancellations} cancelled
                </Badge>
              )}
              <Badge variant="outline" className={getStatusColor(flight.status)}>
                {flight.status.toUpperCase()}
              </Badge>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-500 italic mt-2">
          💡 High delays = surge opportunity at airport pickup
        </p>
      </CardContent>
    </Card>
  );
}

// Local Events Section
function EventsSection({ events }: { events?: EventItem[] }) {
  if (!events || events.length === 0) {
    return (
      <Card className="border-l-4 border-l-purple-500" data-testid="events-section-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Local Events
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No major events detected nearby</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-purple-500" data-testid="events-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Local Events
          <Badge variant="secondary">{events.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {events.slice(0, 5).map((event, i) => (
          <div 
            key={i} 
            className="p-2 bg-purple-50 rounded-lg border border-purple-100"
            data-testid={`event-item-${i}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-purple-900">
                  {event.name || event.title}
                </div>
                {event.venue && (
                  <div className="text-xs text-purple-600 flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {event.venue}
                  </div>
                )}
                {event.time && (
                  <div className="text-xs text-purple-600 flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {event.time}
                  </div>
                )}
              </div>
              {event.type && (
                <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 shrink-0">
                  {event.type}
                </Badge>
              )}
            </div>
            {event.summary && (
              <p className="text-xs text-purple-700 mt-1 line-clamp-2">{event.summary}</p>
            )}
            {event.impact && (
              <p className="text-xs text-purple-600 mt-1 italic">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                {event.impact}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// News Alerts Section
function NewsSection({ news }: { news?: NewsItem[] }) {
  if (!news || news.length === 0) {
    return (
      <Card className="border-l-4 border-l-amber-500" data-testid="news-section-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            News Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No relevant news alerts at this time</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-amber-500" data-testid="news-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Newspaper className="h-4 w-4" />
          News Alerts
          <Badge variant="secondary">{news.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {news.slice(0, 5).map((item, i) => (
          <div 
            key={i} 
            className="p-2 bg-amber-50 rounded-lg border border-amber-100"
            data-testid={`news-item-${i}`}
          >
            <div className="font-medium text-sm text-amber-900">{item.title}</div>
            {item.summary && (
              <p className="text-xs text-amber-700 mt-1 line-clamp-2">{item.summary}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              {item.source && (
                <span className="text-xs text-amber-600">{item.source}</span>
              )}
              {item.impact && (
                <span className="text-xs text-amber-600 italic">
                  <TrendingUp className="h-3 w-3 inline mr-1" />
                  {item.impact}
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Loading Skeleton
function BriefingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="border-l-4 border-l-gray-200">
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
