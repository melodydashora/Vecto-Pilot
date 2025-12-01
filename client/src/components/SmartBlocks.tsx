import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Clock, DollarSign, Users, AlertTriangle, 
  RefreshCw, Loader, Car, Utensils, Wine, TrendingUp,
  Zap, Phone
} from "lucide-react";

interface Venue {
  name: string;
  type: "bar" | "restaurant" | "bar_restaurant";
  address: string;
  phone?: string | null;
  expense_level: string;
  expense_rank: number;
  is_open: boolean;
  hours_today: string;
  closing_soon: boolean;
  minutes_until_close: number | null;
  crowd_level: "low" | "medium" | "high";
  rideshare_potential: "low" | "medium" | "high";
  lat: number;
  lng: number;
}

interface VenueData {
  query_time: string;
  location: string;
  total_venues: number;
  venues: Venue[];
  last_call_venues: Venue[];
  search_sources: string[];
}

interface TrafficData {
  query_time: string;
  location: string;
  traffic_density: number;
  density_level: "low" | "medium" | "high";
  congestion_areas: { area: string; reason: string; severity: number }[];
  high_demand_zones: { zone: string; why: string; rideshare_opportunity: string }[];
  driver_advice: string;
}

interface SmartBlocksProps {
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  snapshotLat?: number;
  snapshotLng?: number;
  holiday?: string | null;
  showTrafficOnly?: boolean;
}

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SEARCH_RADIUS_MILES = 15; // 15 mile radius for venue discovery

export default function SmartBlocks({ lat, lng, city, state, snapshotLat, snapshotLng, holiday, showTrafficOnly }: SmartBlocksProps) {
  // Use snapshot coordinates as fallback if main coords not available
  const effectiveLat = lat || snapshotLat;
  const effectiveLng = lng || snapshotLng;
  
  console.log('[SmartBlocks] Props:', { lat, lng, snapshotLat, snapshotLng, effectiveLat, effectiveLng, city, state, holiday });
  
  const [venueData, setVenueData] = useState<VenueData | null>(null);
  const [trafficData, setTrafficData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<number>(0);

  const fetchIntelligence = useCallback(async () => {
    if (!effectiveLat || !effectiveLng) {
      setError("Location required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        lat: effectiveLat.toString(),
        lng: effectiveLng.toString(),
        city: city || "Unknown",
        state: state || "",
        radius: SEARCH_RADIUS_MILES.toString()
      });
      
      if (holiday) {
        params.append('holiday', holiday);
      }

      console.log('[SmartBlocks] Fetching venues:', `/api/venues/smart-blocks?${params}`);
      const response = await fetch(`/api/venues/smart-blocks?${params}`);
      const result = await response.json();
      console.log('[SmartBlocks] API Response:', result);

      if (result.success) {
        setVenueData(result.data.venues);
        setTrafficData(result.data.traffic);
        setLastUpdated(new Date());
        setNextRefresh(AUTO_REFRESH_INTERVAL / 1000);
      } else {
        setError(result.error || "Failed to fetch intelligence");
      }
    } catch (err) {
      setError("Network error - please try again");
      console.error("SmartBlocks fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [effectiveLat, effectiveLng, city, state]);

  useEffect(() => {
    if (effectiveLat && effectiveLng) {
      fetchIntelligence();
    }
  }, [effectiveLat, effectiveLng, city, state, fetchIntelligence]);

  useEffect(() => {
    if (!effectiveLat || !effectiveLng) return;
    
    const interval = setInterval(() => {
      fetchIntelligence();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [effectiveLat, effectiveLng, fetchIntelligence]);

  useEffect(() => {
    if (nextRefresh <= 0) return;
    
    const countdown = setInterval(() => {
      setNextRefresh(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(countdown);
  }, [nextRefresh]);

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 min ago';
    return `${minutes} mins ago`;
  };

  const getExpenseColor = (level: string) => {
    switch (level) {
      case "$$$$": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "$$$": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "$$": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  const getCrowdIcon = (level: string) => {
    switch (level) {
      case "high": return <Users className="h-4 w-4 text-red-500" />;
      case "medium": return <Users className="h-4 w-4 text-yellow-500" />;
      default: return <Users className="h-4 w-4 text-green-500" />;
    }
  };

  const getVenueIcon = (type: string) => {
    switch (type) {
      case "bar": return <Wine className="h-4 w-4" />;
      case "restaurant": return <Utensils className="h-4 w-4" />;
      default: return <Utensils className="h-4 w-4" />;
    }
  };

  const getTrafficColor = (density: number) => {
    if (density >= 7) return "text-red-600 dark:text-red-400";
    if (density >= 4) return "text-yellow-600 dark:text-yellow-400";
    return "text-green-600 dark:text-green-400";
  };

  if (!effectiveLat || !effectiveLng) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">Set your location to see nearby venues</p>
        </CardContent>
      </Card>
    );
  }

  // If showTrafficOnly, render only the Traffic Conditions card (for Briefing tab)
  if (showTrafficOnly) {
    return (
      <div className="space-y-4 pb-20" data-testid="smart-blocks-traffic-only">
        {loading && !trafficData && (
          <Card>
            <CardContent className="py-8 text-center">
              <Loader className="h-8 w-8 mx-auto animate-spin text-blue-600" />
              <p className="mt-2 text-muted-foreground">Loading traffic conditions...</p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
            <CardContent className="py-3 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              {error}
            </CardContent>
          </Card>
        )}

        {trafficData && (
          <Card className="border-l-4 border-l-blue-500" data-testid="traffic-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="h-4 w-4" />
                Traffic Conditions
                <Badge variant="outline" className={getTrafficColor(trafficData.traffic_density)}>
                  {trafficData.density_level?.toUpperCase()}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-2">{trafficData.driver_advice}</p>
              {trafficData.high_demand_zones?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {trafficData.high_demand_zones.slice(0, 3).map((zone, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {zone.zone}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20" data-testid="smart-blocks-container">
      <div className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Venue Intelligence
              <Badge className="bg-green-100 text-green-700 border-0 text-xs flex items-center gap-1">
                <Zap className="h-3 w-3" />
                Live
              </Badge>
            </h2>
            {lastUpdated && (
              <p className="text-xs text-gray-500 mt-0.5">
                Updated {formatTimeAgo(lastUpdated)} • Auto-refresh in {Math.floor(nextRefresh / 60)}:{(nextRefresh % 60).toString().padStart(2, '0')}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchIntelligence}
            disabled={loading}
            className="border-gray-300"
            data-testid="button-refresh-venues"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardContent className="py-3 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 inline mr-2" />
            {error}
          </CardContent>
        </Card>
      )}

      {loading && !venueData && (
        <Card className="border-2 border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg">
          <CardContent className="py-12 text-center">
            <div className="flex justify-center mb-4">
              <Loader className="h-12 w-12 animate-spin text-blue-600 drop-shadow-lg" />
            </div>
            <p className="text-lg font-semibold text-blue-900 mb-2">🔍 Searching for venues...</p>
            <p className="text-sm text-blue-700">Analyzing bars and restaurants with AI</p>
          </CardContent>
        </Card>
      )}

      {trafficData && (
        <Card className="border-l-4 border-l-blue-500" data-testid="traffic-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Car className="h-4 w-4" />
              Traffic Conditions
              <Badge variant="outline" className={getTrafficColor(trafficData.traffic_density)}>
                {trafficData.density_level?.toUpperCase()}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-2">{trafficData.driver_advice}</p>
            {trafficData.high_demand_zones?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {trafficData.high_demand_zones.slice(0, 3).map((zone, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {zone.zone}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {venueData?.last_call_venues && venueData.last_call_venues.length > 0 && (
        <Card className="border-l-4 border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20" data-testid="last-call-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-4 w-4" />
              Last Call Opportunities
              <Badge variant="destructive">{venueData.last_call_venues.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {venueData.last_call_venues.slice(0, 3).map((venue, i) => (
              <div 
                key={i} 
                className="flex items-center justify-between p-2 bg-white rounded-lg border border-orange-200"
                data-testid={`last-call-venue-${i}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-700">{getVenueIcon(venue.type)}</span>
                  <span className="font-medium text-sm text-slate-900">{venue.name}</span>
                  <Badge className={getExpenseColor(venue.expense_level)}>{venue.expense_level}</Badge>
                </div>
                <Badge variant="outline" className="text-orange-600 border-orange-400">
                  <Clock className="h-3 w-3 mr-1" />
                  {venue.minutes_until_close}min
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {venueData?.venues && venueData.venues.length > 0 && (
        <Card data-testid="venues-list-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Nearby Venues
              <Badge variant="secondary">{venueData.total_venues} found</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {venueData.venues.map((venue, i) => (
                <div 
                  key={i} 
                  className={`p-3 rounded-lg border ${venue.closing_soon ? 'border-orange-300 bg-orange-50' : 'bg-slate-100 border-slate-200'}`}
                  data-testid={`venue-card-${i}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-slate-700">{getVenueIcon(venue.type)}</span>
                        <span className="font-medium text-sm text-slate-900">{venue.name}</span>
                        <Badge className={getExpenseColor(venue.expense_level)}>{venue.expense_level}</Badge>
                        {holiday && (
                          <Badge className="bg-purple-100 text-purple-700 text-xs border-0">
                            🎉 Special Hrs
                          </Badge>
                        )}
                        {venue.closing_soon && (
                          <Badge variant="destructive" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            Closing soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {venue.address}
                      </p>
                      {venue.phone && (venue.type === "bar" || venue.type === "bar_restaurant") && (
                        <p className="text-xs mt-1">
                          <a 
                            href={`tel:${venue.phone.replace(/\D/g, '')}`}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                            data-testid={`call-button-${venue.name}`}
                          >
                            <Phone className="h-3 w-3" />
                            {venue.phone}
                          </a>
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {venue.hours_today}
                        </span>
                        <span className="flex items-center gap-1">
                          {getCrowdIcon(venue.crowd_level)}
                          {venue.crowd_level} crowd
                        </span>
                      </div>
                    </div>
                    <Badge 
                      variant={venue.rideshare_potential === "high" ? "default" : "outline"}
                      className={venue.rideshare_potential === "high" ? "bg-green-600 text-white" : "text-slate-700 border-slate-400"}
                    >
                      {venue.rideshare_potential} potential
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {venueData?.search_sources && venueData.search_sources.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Data from {venueData.search_sources.length} sources via Gemini Search
        </p>
      )}
    </div>
  );
}
