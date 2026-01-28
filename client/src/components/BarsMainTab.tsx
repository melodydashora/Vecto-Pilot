// client/src/components/BarsMainTab.tsx
// 2026-01-09: Renamed from BarTab.tsx for disambiguation (was confused with BarsTable.tsx)
// Independent Bar Tab - Driver utility for finding premium venues with phone numbers
// Does NOT depend on strategy pipeline - only needs location + timezone
// 2026-01-09: Updated to use camelCase API response format
//
// Use case: Driver helping passengers find open venues, especially on holidays
// Key features: Phone numbers, special hours, expense sorting, real-time open status

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Navigation, MapPin, Phone, Wine, Loader, AlertCircle } from "lucide-react";
import { openNavigation } from "@/utils/co-pilot-helpers";
import { API_ROUTES } from '@/constants/apiRoutes';

interface BarTabProps {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;
  getAuthHeader: () => Record<string, string>;
}

/**
 * Venue interface - uses camelCase to match API response
 * Mirrors server/validation/response-schemas.js VenueSchema
 */
interface Venue {
  name: string;
  type: 'bar' | 'nightclub' | 'wine_bar' | 'lounge';
  address: string;
  phone: string | null;
  expenseLevel: string;
  expenseRank: number;
  // 2026-01-09: isOpen can be null when hours unavailable
  isOpen: boolean | null;
  opensInMinutes: number | null;
  // 2026-01-09: hoursToday can be null when hours unavailable
  hoursToday: string | null;
  hoursFullWeek?: Record<string, string>;
  closingSoon: boolean;
  minutesUntilClose: number | null;
  crowdLevel: 'low' | 'medium' | 'high';
  ridesharePotential: 'low' | 'medium' | 'high';
  rating: number | null;
  lat: number;
  lng: number;
  placeId?: string;
}

/**
 * VenueData interface - uses camelCase to match API response
 * Mirrors server/validation/response-schemas.js VenueDataSchema
 */
interface VenueData {
  queryTime: string;
  location: string;
  totalVenues: number;
  venues: Venue[];
  lastCallVenues: Venue[];
  searchSources?: string[];
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
    placeId: venue.placeId,
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
  // 2026-01-09: P3-C - NO FALLBACKS - match useBarsQuery.ts rules
  const { data: venueData, isLoading, error, refetch } = useQuery<VenueData>({
    queryKey: ['bar-tab', latitude, longitude, city, state, timezone],
    queryFn: async () => {
      // 2026-01-09: NO FALLBACKS - fail explicitly if required data missing
      if (latitude == null || longitude == null) {
        throw new Error('[BarTab] BUG: Query enabled without coordinates');
      }
      if (!timezone) {
        throw new Error('[BarTab] BUG: Query enabled without timezone - isLocationResolved should gate this');
      }
      if (!city) {
        throw new Error('[BarTab] BUG: Query enabled without city - isLocationResolved should gate this');
      }

      const params = new URLSearchParams({
        lat: latitude.toString(),
        lng: longitude.toString(),
        city: city,  // No fallback - required
        state: state || '',  // State is optional (some countries don't have states)
        radius: '25',  // 25 mile radius for upscale bars
        timezone: timezone  // No fallback - required for accurate venue hours
      });

      const response = await fetch(API_ROUTES.VENUES.NEARBY_WITH_PARAMS(params), {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      return result.data;
    },
    // 2026-01-09: Explicitly require city and timezone (not just isLocationResolved)
    enabled: latitude != null && longitude != null && !!city && !!timezone && isLocationResolved,
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
  // 2026-01-09: Using camelCase hoursToday field
  const venuesWithHours = venueData.venues.filter(v => {
    // Must have hoursToday to be displayed
    if (!v.hoursToday || v.hoursToday.trim().length === 0) return false;
    // Filter out "Hours not available" or similar
    if (v.hoursToday.toLowerCase().includes('not available')) return false;
    return true;
  });

  // Sort venues by strategic value for drivers:
  // 1. Open venues with latest closing times first (more time to work them)
  // 2. Then open venues closing soon (last call opportunities)
  // 3. Then "unknown" status venues (might be open - worth checking)
  // 4. Then opening soon venues
  // 5. Then closed venues
  // Within each group, sort by expense level (highest first = better tips)
  //
  // 2026-01-09: Updated to handle isOpen: null (unknown) explicitly
  // null means Google didn't return hours - venue might still be open
  const sortedVenues = [...venuesWithHours].sort((a, b) => {
    // Helper to get sort priority: open=0, unknown=1, closed=2
    const getPriority = (v: Venue) => {
      if (v.isOpen === true) return 0;
      if (v.isOpen === null) return 1;  // Unknown - might be open
      return 2;  // Closed
    };

    const aPriority = getPriority(a);
    const bPriority = getPriority(b);

    // Different status groups - sort by priority
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Both open - sort by closing time strategy
    if (a.isOpen === true && b.isOpen === true) {
      // Neither closing soon - sort by expense (highest first)
      if (!a.closingSoon && !b.closingSoon) {
        return (b.expenseRank || 0) - (a.expenseRank || 0);
      }
      // Put non-closing-soon venues before closing-soon (more time to work them)
      if (a.closingSoon !== b.closingSoon) {
        return a.closingSoon ? 1 : -1;
      }
      // Both closing soon - sort by minutes until close (more time first)
      if (a.closingSoon && b.closingSoon) {
        return (b.minutesUntilClose || 0) - (a.minutesUntilClose || 0);
      }
    }

    // Both unknown or both closed - check opening soon
    const aOpeningSoon = a.opensInMinutes && a.opensInMinutes <= 15;
    const bOpeningSoon = b.opensInMinutes && b.opensInMinutes <= 15;
    if (aOpeningSoon !== bOpeningSoon) {
      return aOpeningSoon ? -1 : 1;
    }

    // Finally, sort by expense
    return (b.expenseRank || 0) - (a.expenseRank || 0);
  });

  const venues = sortedVenues;
  // Filter lastCallVenues the same way (using camelCase)
  const lastCallVenues = (venueData.lastCallVenues || []).filter(v =>
    v.hoursToday && v.hoursToday.trim().length > 0 && !v.hoursToday.toLowerCase().includes('not available')
  );
  const lateNightVenues = venues.filter(v => v.isOpen && !v.closingSoon);

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
            {venues.filter(v => v.isOpen).length} open
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
          const expenseTier = getExpenseTier(venue.expenseLevel);
          const categoryColor = getCategoryColor(venue.type);

          return (
            <Card
              key={idx}
              className={`border transition-all hover:shadow-md ${
                venue.isOpen
                  ? "border-green-200 bg-green-50/30"
                  : venue.opensInMinutes && venue.opensInMinutes <= 15
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
                        <span className="text-xs text-gray-700 font-mono">{venue.hoursToday}</span>
                      </div>

                      {/* Status Badges */}
                      {venue.closingSoon && venue.minutesUntilClose && (
                        <Badge className="bg-orange-100 text-orange-700 border-0 text-xs">
                          Closes in {venue.minutesUntilClose}min
                        </Badge>
                      )}

                      {venue.opensInMinutes && venue.opensInMinutes <= 15 && (
                        <Badge className="bg-yellow-100 text-yellow-700 border-0 text-xs">
                          Opens in {venue.opensInMinutes}min
                        </Badge>
                      )}

                      <Badge
                        className={`text-xs ${
                          venue.isOpen === true
                            ? "bg-green-100 text-green-700 border-0"
                            : venue.isOpen === false
                            ? "bg-red-100 text-red-700 border-0"
                            : "bg-gray-100 text-gray-600 border-0"
                        }`}
                      >
                        {venue.isOpen === true ? "Open Now" : venue.isOpen === false ? "Closed" : "Hours Unknown"}
                      </Badge>

                      {/* Crowd Level */}
                      <Badge className={`text-xs border-0 ${
                        venue.crowdLevel === 'high' ? 'bg-purple-100 text-purple-700' :
                        venue.crowdLevel === 'medium' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {venue.crowdLevel} crowd
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

      {/* Data Source Footer - using camelCase fields */}
      <div className="text-xs text-gray-400 text-center pt-2">
        Updated {venueData.queryTime} | {venueData.location}
      </div>
    </div>
  );
}
