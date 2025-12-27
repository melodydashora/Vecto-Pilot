// client/src/components/BarTab.tsx
// Independent Bar Tab - Driver utility for finding premium venues with phone numbers
// Does NOT depend on strategy pipeline - only needs location + timezone
//
// Use case: Driver helping passengers find open venues, especially on holidays
// Key features: Phone numbers, special hours, expense sorting, real-time open status

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Navigation, MapPin, Phone, Wine, Loader, AlertCircle } from "lucide-react";
import { openNavigation } from "@/utils/co-pilot-helpers";

interface BarTabProps {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;
  getAuthHeader: () => Record<string, string>;
}

interface Venue {
  name: string;
  type: 'bar' | 'nightclub' | 'wine_bar' | 'lounge';
  address: string;
  phone: string | null;
  expense_level: string;
  expense_rank: number;
  is_open: boolean;
  opens_in_minutes: number | null;
  hours_today: string;
  hours_full_week?: Record<string, string>;
  closing_soon: boolean;
  minutes_until_close: number | null;
  crowd_level: 'low' | 'medium' | 'high';
  rideshare_potential: 'low' | 'medium' | 'high';
  rating: number | null;
  lat: number;
  lng: number;
  place_id?: string;
}

interface VenueData {
  query_time: string;
  location: string;
  total_venues: number;
  venues: Venue[];
  last_call_venues: Venue[];
  search_sources?: string[];
}

// Get category color based on venue type
function getCategoryColor(type: string): string {
  switch (type) {
    case 'bar': return 'bg-amber-500';
    case 'nightclub': return 'bg-purple-500';
    case 'wine_bar': return 'bg-rose-500';
    case 'lounge': return 'bg-indigo-500';
    default: return 'bg-amber-500';
  }
}

// Get venue type display name
function getVenueTypeDisplay(type: string): string {
  switch (type) {
    case 'bar': return 'Bar';
    case 'nightclub': return 'Nightclub';
    case 'wine_bar': return 'Wine Bar';
    case 'lounge': return 'Lounge';
    default: return 'Bar';
  }
}

// Get expense tier display
function getExpenseTier(level: string): { display: string; color: string } {
  switch (level) {
    case '$$$$': return { display: '$$$$', color: 'text-amber-600 font-bold' };
    case '$$$': return { display: '$$$', color: 'text-amber-700 font-semibold' };
    case '$$': return { display: '$$', color: 'text-gray-700' };
    default: return { display: '$', color: 'text-gray-500' };
  }
}

// Open navigation (uses Apple Maps on iOS/macOS, Google Maps elsewhere)
function handleNavigation(venue: Venue) {
  openNavigation({
    lat: venue.lat,
    lng: venue.lng,
    placeId: venue.place_id,
    name: venue.name,
    address: venue.address
  });
}

// Call venue phone number
function callVenue(phone: string) {
  // Clean phone number for tel: link
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  window.open(`tel:${cleanPhone}`, "_self");
}

export default function BarTab({
  latitude,
  longitude,
  city,
  state,
  timezone,
  isLocationResolved,
  getAuthHeader
}: BarTabProps) {

  // Independent query - only needs location, no strategy dependency
  const { data: venueData, isLoading, error, refetch } = useQuery<VenueData>({
    queryKey: ['bar-tab', latitude, longitude, city, state, timezone],
    queryFn: async () => {
      if (!latitude || !longitude) throw new Error('No coordinates');

      const params = new URLSearchParams({
        lat: latitude.toString(),
        lng: longitude.toString(),
        city: city || 'Unknown',
        state: state || '',
        radius: '25',  // 25 mile radius for upscale bars
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
      });

      const response = await fetch(`/api/venues/nearby?${params}`, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      return result.data;
    },
    enabled: !!(latitude && longitude && isLocationResolved),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: false,
  });

  // Loading state
  if (isLoading) {
    return (
      <Card className="p-6 border-purple-100 bg-purple-50/50">
        <div className="flex items-center gap-3">
          <Loader className="w-5 h-5 text-purple-600 animate-spin" />
          <div>
            <p className="text-gray-800 font-semibold text-sm">Finding premium bars & lounges...</p>
            <p className="text-gray-600 text-xs">Checking hours and availability</p>
          </div>
        </div>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="p-6 border-red-100 bg-red-50/50">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <div>
            <p className="text-gray-800 font-semibold text-sm">Failed to load venues</p>
            <p className="text-gray-600 text-xs">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-2 text-xs text-purple-600 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      </Card>
    );
  }

  // No venues
  if (!venueData?.venues || venueData.venues.length === 0) {
    return (
      <Card className="p-6 border-gray-100">
        <div className="flex flex-col items-center text-center py-8">
          <Wine className="w-12 h-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">No venues found</h3>
          <p className="text-gray-500 mt-2">No bars or lounges found in your area</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Refresh
          </button>
        </div>
      </Card>
    );
  }

  // Filter out venues without business hours - they're not useful to drivers
  const venuesWithHours = venueData.venues.filter(v => {
    // Must have hours_today to be displayed
    if (!v.hours_today || v.hours_today.trim().length === 0) return false;
    // Filter out "Hours not available" or similar
    if (v.hours_today.toLowerCase().includes('not available')) return false;
    return true;
  });

  // Sort venues by strategic value for drivers:
  // 1. Open venues with latest closing times first (more time to work them)
  // 2. Then open venues closing soon (last call opportunities)
  // 3. Then opening soon venues
  // Within each group, sort by expense level (highest first = better tips)
  const sortedVenues = [...venuesWithHours].sort((a, b) => {
    // Both open
    if (a.is_open && b.is_open) {
      // Neither closing soon - sort by expense (highest first)
      if (!a.closing_soon && !b.closing_soon) {
        return (b.expense_rank || 0) - (a.expense_rank || 0);
      }
      // Put non-closing-soon venues before closing-soon (more time to work them)
      if (a.closing_soon !== b.closing_soon) {
        return a.closing_soon ? 1 : -1;
      }
      // Both closing soon - sort by minutes until close (more time first)
      if (a.closing_soon && b.closing_soon) {
        return (b.minutes_until_close || 0) - (a.minutes_until_close || 0);
      }
    }
    // Open venues before closed/opening-soon
    if (a.is_open !== b.is_open) {
      return a.is_open ? -1 : 1;
    }
    // Opening soon venues before fully closed
    const aOpeningSoon = a.opens_in_minutes && a.opens_in_minutes <= 15;
    const bOpeningSoon = b.opens_in_minutes && b.opens_in_minutes <= 15;
    if (aOpeningSoon !== bOpeningSoon) {
      return aOpeningSoon ? -1 : 1;
    }
    // Finally, sort by expense
    return (b.expense_rank || 0) - (a.expense_rank || 0);
  });

  const venues = sortedVenues;
  // Filter last_call_venues the same way
  const lastCallVenues = (venueData.last_call_venues || []).filter(v =>
    v.hours_today && v.hours_today.trim().length > 0 && !v.hours_today.toLowerCase().includes('not available')
  );
  const lateNightVenues = venues.filter(v => v.is_open && !v.closing_soon);

  // No venues after filtering
  if (venues.length === 0) {
    return (
      <Card className="p-6 border-gray-100">
        <div className="flex flex-col items-center text-center py-8">
          <Wine className="w-12 h-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">No venues with hours</h3>
          <p className="text-gray-500 mt-2">No bars with business hours found in your area</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Refresh
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wine className="w-5 h-5 text-purple-600" />
          <h2 className="text-lg font-semibold text-gray-800">Upscale Bars</h2>
          <Badge variant="outline" className="border-green-500 text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
            {venues.filter(v => v.is_open).length} open
          </Badge>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-purple-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        {/* Late Night Venues - Open with time to work */}
        {lateNightVenues.length > 0 && (
          <Card className="border-green-200 bg-green-50/50 p-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-green-600" />
              <div>
                <span className="text-sm font-medium text-green-800">
                  {lateNightVenues.length} open late
                </span>
                <p className="text-xs text-green-600">Hit these first</p>
              </div>
            </div>
          </Card>
        )}

        {/* Last Call Alert */}
        {lastCallVenues.length > 0 && (
          <Card className="border-orange-200 bg-orange-50/50 p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-600" />
              <div>
                <span className="text-sm font-medium text-orange-800">
                  {lastCallVenues.length} closing soon
                </span>
                <p className="text-xs text-orange-600">Last call pickups</p>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Venue Cards */}
      <div className="space-y-3">
        {venues.map((venue, idx) => {
          const expenseTier = getExpenseTier(venue.expense_level);
          const categoryColor = getCategoryColor(venue.type);

          return (
            <Card
              key={idx}
              className={`border transition-all hover:shadow-md ${
                venue.is_open
                  ? "border-green-200 bg-green-50/30"
                  : venue.opens_in_minutes && venue.opens_in_minutes <= 15
                  ? "border-yellow-200 bg-yellow-50/30"
                  : "border-gray-200 bg-gray-50/50 opacity-70"
              }`}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Category Color Pin */}
                  <div className="flex-shrink-0 pt-1">
                    <div className={`w-3 h-3 rounded-full ${categoryColor}`} title={venue.type} />
                  </div>

                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + Expense Tier */}
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-gray-900 truncate">{venue.name}</h4>
                      <span className={`text-lg ${expenseTier.color} flex-shrink-0`}>
                        {expenseTier.display}
                      </span>
                    </div>

                    {/* Row 2: Address */}
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-600 truncate">{venue.address}</span>
                    </div>

                    {/* Row 3: Phone Number - PROMINENT */}
                    {venue.phone && (
                      <button
                        onClick={() => callVenue(venue.phone!)}
                        className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors w-full"
                      >
                        <Phone className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-700">{venue.phone}</span>
                        <span className="text-xs text-blue-500 ml-auto">Tap to call</span>
                      </button>
                    )}

                    {/* Row 4: Hours + Status */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Today's Hours */}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-blue-500 flex-shrink-0" />
                        <span className="text-xs text-gray-700 font-mono">{venue.hours_today}</span>
                      </div>

                      {/* Status Badges */}
                      {venue.closing_soon && venue.minutes_until_close && (
                        <Badge className="bg-orange-100 text-orange-700 border-0 text-xs">
                          Closes in {venue.minutes_until_close}min
                        </Badge>
                      )}

                      {venue.opens_in_minutes && venue.opens_in_minutes <= 15 && (
                        <Badge className="bg-yellow-100 text-yellow-700 border-0 text-xs">
                          Opens in {venue.opens_in_minutes}min
                        </Badge>
                      )}

                      <Badge
                        className={`text-xs ${
                          venue.is_open
                            ? "bg-green-100 text-green-700 border-0"
                            : "bg-red-100 text-red-700 border-0"
                        }`}
                      >
                        {venue.is_open ? "Open Now" : "Closed"}
                      </Badge>

                      {/* Crowd Level */}
                      <Badge className={`text-xs border-0 ${
                        venue.crowd_level === 'high' ? 'bg-purple-100 text-purple-700' :
                        venue.crowd_level === 'medium' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {venue.crowd_level} crowd
                      </Badge>
                    </div>

                    {/* Row 5: Actions */}
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{getVenueTypeDisplay(venue.type)}</span>
                        {venue.rating && (
                          <>
                            <span>|</span>
                            <span className="text-amber-600">★ {venue.rating.toFixed(1)}</span>
                          </>
                        )}
                      </div>

                      <button
                        onClick={() => handleNavigation(venue)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                      >
                        <Navigation className="w-3 h-3" />
                        Navigate
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Data Source Footer */}
      <div className="text-xs text-gray-400 text-center pt-2">
        Updated {venueData.query_time} | {venueData.location}
      </div>
    </div>
  );
}
