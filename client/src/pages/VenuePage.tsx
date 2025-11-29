/**
 * Venue Tab - Real-time Venue Intelligence
 * 
 * Displays recommended bars and restaurants with:
 * - Crowd levels and demand potential
 * - Hours and last-call alerts
 * - Phone numbers for reservations
 * - Proximity and surge opportunities
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Wine, Utensils, MapPin, Phone, Clock, Users, AlertTriangle,
  RefreshCw, Loader, TrendingUp, Zap
} from 'lucide-react';
import { useLocation } from '@/contexts/location-context-clean';

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
}

export default function VenuePage() {
  const locationContext = useLocation();
  const [venueData, setVenueData] = useState<VenueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const coords = locationContext?.overrideCoords || locationContext?.currentCoords;
  const city = locationContext?.overrideCoords?.city || '';
  const state = locationContext?.overrideCoords?.state || '';

  const fetchVenues = async () => {
    if (!coords?.latitude || !coords?.longitude) {
      setError("Location required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        lat: coords.latitude.toString(),
        lng: coords.longitude.toString(),
        city: city || "Unknown",
        state: state || "",
        radius: "15"
      });

      const response = await fetch(`/api/venues/smart-blocks?${params}`);
      const result = await response.json();

      if (result.success) {
        setVenueData(result.data.venues);
        setLastUpdated(new Date());
      } else {
        setError(result.error || "Failed to fetch venues");
      }
    } catch (err) {
      setError("Network error - please try again");
      console.error("Venue fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (coords?.latitude && coords?.longitude) {
      fetchVenues();
    }
  }, [coords?.latitude, coords?.longitude]);

  const handleRefresh = () => {
    fetchVenues();
  };

  if (!coords?.latitude || !coords?.longitude) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <Card className="max-w-2xl mx-auto">
          <CardContent className="py-12 text-center">
            <MapPin className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Location Required</h2>
            <p className="text-gray-500">Enable location services to view nearby venues</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20" data-testid="venue-page">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900" data-testid="venue-title">
                Venue Intelligence
              </h1>
              <p className="text-sm text-gray-500" data-testid="venue-location">
                {city}{state ? `, ${state}` : ''}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
              data-testid="venue-refresh"
            >
              {loading ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4">
              <p className="text-sm text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {loading && !venueData ? (
          <>
            <Card><CardContent><Skeleton className="h-24" /></CardContent></Card>
            <Card><CardContent><Skeleton className="h-24" /></CardContent></Card>
            <Card><CardContent><Skeleton className="h-24" /></CardContent></Card>
          </>
        ) : venueData && venueData.venues.length > 0 ? (
          <>
            {/* Last Call Venues - High Priority */}
            {venueData.last_call_venues && venueData.last_call_venues.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-bold text-red-600 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Last Call Alert - Premium Opportunity
                </h2>
                {venueData.last_call_venues.slice(0, 3).map((venue, i) => (
                  <VenueCard key={`last-call-${i}`} venue={venue} isLastCall={true} />
                ))}
              </div>
            )}

            {/* Regular Venues */}
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-gray-700">
                Top Venues ({venueData.total_venues} nearby)
              </h2>
              {venueData.venues.slice(0, 10).map((venue, i) => (
                <VenueCard key={`venue-${i}`} venue={venue} />
              ))}
            </div>

            {/* Stats */}
            <div className="text-center text-xs text-gray-400 pt-4">
              Updated: {lastUpdated?.toLocaleTimeString()}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Wine className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No venues found nearby</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function VenueCard({ venue, isLastCall }: { venue: Venue; isLastCall?: boolean }) {
  const getCrowdColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-red-100 text-red-700';
      case 'medium': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-green-100 text-green-700';
    }
  };

  const getPotentialColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-purple-100 text-purple-700 border-purple-300';
      case 'medium': return 'bg-blue-100 text-blue-700 border-blue-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const getExpenseBadge = (rank: number) => {
    const symbols = '$'.repeat(Math.max(1, Math.min(4, Math.ceil(rank))));
    return symbols;
  };

  return (
    <Card className={isLastCall ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-blue-500'}>
      <CardContent className="py-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {venue.type === 'bar' ? (
                <Wine className="h-4 w-4 text-amber-600 shrink-0" />
              ) : (
                <Utensils className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              <h3 className="font-semibold text-gray-900 text-sm truncate">{venue.name}</h3>
              {isLastCall && (
                <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 text-xs">
                  LAST CALL
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{venue.address}</p>
          </div>
          <div className="text-right text-xs font-medium text-gray-600 shrink-0">
            {getExpenseBadge(venue.expense_rank)}
          </div>
        </div>

        {/* Status and Metrics */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-gray-400" />
            <span className="text-gray-600">{venue.hours_today}</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className={`h-3 w-3 ${getCrowdColor(venue.crowd_level)}`} />
            <Badge variant="outline" className={`text-xs h-5 ${getCrowdColor(venue.crowd_level)}`}>
              {venue.crowd_level.toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Opportunity */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-purple-600" />
            <span className="text-xs text-purple-600 font-medium">Rideshare Potential</span>
          </div>
          <Badge variant="outline" className={`text-xs ${getPotentialColor(venue.rideshare_potential)}`}>
            {venue.rideshare_potential.toUpperCase()}
          </Badge>
        </div>

        {/* Alerts */}
        {venue.closing_soon && venue.minutes_until_close && (
          <div className="bg-orange-50 border border-orange-200 rounded p-2">
            <p className="text-xs text-orange-700 font-medium">
              ⏰ Closing in {venue.minutes_until_close} min - Act fast!
            </p>
          </div>
        )}

        {!venue.is_open && (
          <div className="bg-gray-100 border border-gray-300 rounded p-2">
            <p className="text-xs text-gray-600">Currently closed</p>
          </div>
        )}

        {/* Contact */}
        {venue.phone && (
          <a
            href={`tel:${venue.phone}`}
            className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 pt-1"
            data-testid={`venue-phone-${venue.name}`}
          >
            <Phone className="h-3 w-3" />
            {venue.phone}
          </a>
        )}
      </CardContent>
    </Card>
  );
}
