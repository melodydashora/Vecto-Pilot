// client/src/hooks/useBarsQuery.ts
// Pre-fetch bars/venues data when location resolves
// Data is cached so BarTab component displays instantly without loading state

import { useQuery } from '@tanstack/react-query';
import { getAuthHeader } from '@/utils/co-pilot-helpers';

export interface Venue {
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

export interface BarsData {
  query_time: string;
  location: string;
  total_venues: number;
  venues: Venue[];
  last_call_venues: Venue[];
  search_sources?: string[];
}

interface UseBarsQueryParams {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;
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
  isLocationResolved
}: UseBarsQueryParams) {
  const { data, isLoading, error, refetch } = useQuery<BarsData>({
    // CRITICAL: Must match BarTab.tsx queryKey exactly for cache sharing
    queryKey: ['bar-tab', latitude, longitude, city, state, timezone],
    queryFn: async () => {
      // 2026-01-06: P3-C - NO FALLBACKS - fail explicitly if required data missing
      // If this errors, it's a bug in LocationContext (isLocationResolved was true but data missing)
      if (!latitude || !longitude) {
        throw new Error('[useBarsQuery] BUG: Query enabled without coordinates');
      }
      if (!timezone) {
        throw new Error('[useBarsQuery] BUG: Query enabled without timezone - isLocationResolved should gate this');
      }
      if (!city) {
        throw new Error('[useBarsQuery] BUG: Query enabled without city - isLocationResolved should gate this');
      }

      const params = new URLSearchParams({
        lat: latitude.toString(),
        lng: longitude.toString(),
        city: city,  // No fallback - required
        state: state || '',  // State is optional (some countries don't have states)
        radius: '25',  // 25 mile radius for upscale bars
        timezone: timezone  // No fallback - required for accurate venue hours
      });

      console.log('[useBarsQuery] Prefetching bars data for:', { city, state, lat: latitude?.toFixed(4) });

      const response = await fetch(`/api/venues/nearby?${params}`, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      console.log('[useBarsQuery] Prefetch complete:', result.data?.total_venues, 'venues');
      return result.data;
    },
    // Only fetch when location is fully resolved with all required data
    // 2026-01-06: P3-C - explicitly require city and timezone (not just isLocationResolved)
    enabled: !!(latitude && longitude && city && timezone && isLocationResolved),
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
