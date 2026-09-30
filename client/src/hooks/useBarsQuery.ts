// client/src/hooks/useBarsQuery.ts
// Pre-fetch bars/venues data when location resolves
// Data is cached so BarTab component displays instantly without loading state
// 2026-01-09: Updated types to camelCase to match API response transformation

import { useQuery } from '@tanstack/react-query';
import { getAuthHeader as defaultAuthHeader } from '@/utils/co-pilot-helpers';
import { normalizeCoordinates } from '@shared/coordinates.js';
import { API_ROUTES } from '@/constants/apiRoutes';
// 2026-04-27 (Commit 4 of CLEAR_CONSOLE_WORKFLOW spec): gate prefetch logs.
import { DEBUG_VENUES_ENABLED } from '@/constants/featureFlags';

/**
 * Venue type - matches server/validation/response-schemas.js VenueSchema
 * Uses camelCase to match API response format
 */
export interface Venue {
  name: string;
  type: 'bar' | 'nightclub' | 'wine_bar' | 'lounge';
  address: string;
  phone: string | null;
  expenseLevel: string | null;
  expenseRank: number | null;
  // 2026-01-09: isOpen can be null when hours unavailable (per server calculateOpenStatus)
  isOpen: boolean | null;
  opensInMinutes: number | null;
  // 2026-01-09: hoursToday can be null when hours unavailable
  hoursToday: string | null;
  hoursFullWeek?: Record<string, string>;
  closingSoon: boolean;
  minutesUntilClose: number | null;
  crowdLevel: 'low' | 'medium' | 'high' | null;
  ridesharePotential: 'low' | 'medium' | 'high' | null;
  rating: number | null;
  lat: number;
  lng: number;
  placeId?: string;
  // 2026-01-14: Closed Go Anyway feature - high-value venues worth staging near even when closed
  closedGoAnyway?: boolean;      // Flag for high-value closed venues
  closedReason?: string | null;  // Reason to visit anyway (e.g., "Opens in 30 min")
  // 2026-03-18: Added to match BarsMainTab and server toApiVenue() output
  hoursUnknown?: boolean;
  venueQualityTier?: 'premium' | 'standard' | null;
}

/**
 * BarsData - matches server/validation/response-schemas.js VenueDataSchema
 * Uses camelCase to match API response format
 */
export interface BarsData {
  queryTime: string;
  location: string;
  totalVenues: number;
  venues: Venue[];
  lastCallVenues: Venue[];
  searchSources?: string[];
}

interface UseBarsQueryParams {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;
  getAuthHeader?: () => Record<string, string>;
}

/**
 * Pre-fetches bars/venues data when location is resolved.
 * Uses the same query key as BarTab component, so data is shared via React Query cache.
 * This ensures the Bars tab loads instantly without a loading state.
 */
export function useBarsQuery({
  latitude,
  longitude,
  city,
  state,
  timezone,
  isLocationResolved,
  getAuthHeader = defaultAuthHeader
}: UseBarsQueryParams) {
  const { data, isLoading, error, refetch } = useQuery<BarsData>({
    // CRITICAL: Must match BarTab.tsx queryKey exactly for cache sharing
    queryKey: ['bar-tab', latitude, longitude, city, state, timezone],
    queryFn: async ({ signal }) => {
      if (!normalizeCoordinates(latitude, longitude) || !timezone || !city) {
        throw new Error('Location is not ready for nearby venues');
      }

      const params = new URLSearchParams({
        lat: String(latitude),
        lng: String(longitude),
        city: city,  // No fallback - required
        state: state || '',  // State is optional (some countries don't have states)
        radius: '25',  // 25 mile radius for upscale bars
        timezone: timezone  // No fallback - required for accurate venue hours
      });

      // 2026-01-10: Use 6-decimal precision per CLAUDE.md ABSOLUTE PRECISION rule (D-017 fix)
      if (DEBUG_VENUES_ENABLED) console.log('[useBarsQuery] Prefetching bars data for:', { city, state, lat: latitude?.toFixed(6) });

      const response = await fetch(API_ROUTES.VENUES.NEARBY_WITH_PARAMS(params), {
        headers: getAuthHeader(), signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      if (DEBUG_VENUES_ENABLED) console.log('[useBarsQuery] Prefetch complete:', result.data?.totalVenues, 'venues');
      if (result.success !== true || !Array.isArray(result.data?.venues)) throw new Error('Venue discovery is unavailable');
      return result.data;
    },
    // Only fetch when location is fully resolved with all required data
    // 2026-01-06: P3-C - explicitly require city and timezone (not just isLocationResolved)
    enabled: !!normalizeCoordinates(latitude, longitude) && !!city && !!timezone && isLocationResolved,
    // Cache for 5 minutes (bars don't change frequently)
    staleTime: 5 * 60 * 1000,
    // Keep in cache for 10 minutes
    gcTime: 10 * 60 * 1000,
    // Don't refetch on window focus (venues don't change that fast)
    refetchOnWindowFocus: false,
  });

  return {
    barsData: data || null,
    isBarsLoading: isLoading,
    barsError: error,
    refetchBars: refetch
  };
}
