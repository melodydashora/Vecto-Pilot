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
      if (!latitude || !longitude) throw new Error('No coordinates');

      // NO FALLBACK - timezone required for accurate venue hours
      // If timezone is missing, use browser's timezone as last resort
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const params = new URLSearchParams({
        lat: latitude.toString(),
        lng: longitude.toString(),
        city: city || 'Unknown',
        state: state || '',
        radius: '25',  // 25 mile radius for upscale bars
        timezone: tz
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
    // Only fetch when location is fully resolved
    enabled: !!(latitude && longitude && isLocationResolved),
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
