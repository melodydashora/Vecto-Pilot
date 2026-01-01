// client/src/hooks/useBriefingQueries.ts
// Consolidated briefing data queries for Co-Pilot
//
// SMART CACHE PATTERN: Queries fetch as soon as snapshot exists.
// If data is still generating (placeholder response), we retry every 5 seconds.
// Once real data arrives, it's cached forever (staleTime: Infinity).
// New location = new snapshotId = new fetch.
//
// SSE INTEGRATION: Subscribes to briefing_ready event to immediately invalidate
// cache when backend signals data is ready (eliminates polling delay).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { getAuthHeader, subscribeBriefingReady } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  pipelinePhase?: PipelinePhase;
}

// Maximum retry attempts before giving up
// LESSON LEARNED: Briefing generation can take 40-60 seconds (traffic AI analysis + event discovery).
// Need enough retries to cover the full generation time until SSE briefing_ready fires.
const MAX_RETRY_ATTEMPTS = 40; // 40 attempts × 2 seconds = 80 seconds (covers worst case)
const RETRY_INTERVAL_MS = 2000; // Poll every 2 seconds

// Special error to indicate snapshot ownership failure (different user)
// This triggers a GPS refresh to create a new snapshot for the current user
const SNAPSHOT_OWNERSHIP_ERROR = 'snapshot_ownership_error';

// Dispatch event to clear stale snapshot and request fresh GPS
function dispatchSnapshotOwnershipError() {
  console.warn('[BriefingQuery] 🚨 Snapshot ownership error - requesting new snapshot');
  window.dispatchEvent(new CustomEvent('snapshot-ownership-error'));
}

// Check if traffic data is still loading/placeholder
function isTrafficLoading(data: any): boolean {
  if (!data?.traffic) return true;
  // Server returns "Loading traffic..." as placeholder
  return data.traffic.summary === 'Loading traffic...' || data.traffic.summary === null;
}

// Check if airport data is still loading/placeholder
function isAirportLoading(data: any): boolean {
  if (!data?.airport_conditions) return true;
  return data.airport_conditions.isFallback === true;
}

// Check if news data is still loading/placeholder
function isNewsLoading(data: any): boolean {
  if (!data?.news) return true;
  // Empty news with no reason usually means still generating
  const items = data.news.items || [];
  const hasReason = data.news.reason !== null && data.news.reason !== undefined;
  return items.length === 0 && !hasReason;
}

export function useBriefingQueries({ snapshotId, pipelinePhase: _pipelinePhase }: BriefingQueriesOptions) {
  const queryClient = useQueryClient();

  // Enable queries as soon as we have a valid snapshotId
  // Note: 'live-snapshot' is now supported - it represents real-time location data
  // with briefing generated on-demand. Only disable for null/empty snapshotId.
  const isEnabled = !!snapshotId;

  // Subscribe to briefing_ready SSE event to trigger immediate refetch
  // Uses singleton SSE manager - connection is shared across all components
  useEffect(() => {
    if (!snapshotId) return;

    const refetchAllBriefingQueries = () => {
      console.log('[BriefingQuery] 📢 briefing_ready received, refetching for', snapshotId.slice(0, 8));
      queryClient.refetchQueries({ queryKey: ['/api/briefing/weather', snapshotId] });
      queryClient.refetchQueries({ queryKey: ['/api/briefing/traffic', snapshotId] });
      queryClient.refetchQueries({ queryKey: ['/api/briefing/rideshare-news', snapshotId] });
      queryClient.refetchQueries({ queryKey: ['/api/briefing/events', snapshotId] });
      queryClient.refetchQueries({ queryKey: ['/api/briefing/school-closures', snapshotId] });
      queryClient.refetchQueries({ queryKey: ['/api/briefing/airport', snapshotId] });
    };

    const unsubscribe = subscribeBriefingReady((readySnapshotId) => {
      if (readySnapshotId === snapshotId) {
        refetchAllBriefingQueries();
      }
    });

    return () => unsubscribe();
  }, [snapshotId, queryClient]);

  // Track retry attempts per query type (reset when snapshotId changes)
  const retryCountsRef = useRef<{ traffic: number; news: number; airport: number; snapshotId: string | null }>({
    traffic: 0,
    news: 0,
    airport: 0,
    snapshotId: null
  });

  // Reset retry counts when snapshotId changes
  if (retryCountsRef.current.snapshotId !== snapshotId) {
    retryCountsRef.current = { traffic: 0, news: 0, airport: 0, snapshotId };
  }

  // Force refetch all queries when snapshotId changes
  // This ensures we don't serve stale data from a previous snapshot
  useEffect(() => {
    if (!snapshotId) return;

    console.log('[BriefingQuery] 🔄 SnapshotId changed to', snapshotId.slice(0, 8), '- invalidating all caches');

    // Invalidate all briefing queries for this snapshot to force fresh fetch
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/weather', snapshotId] });
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/traffic', snapshotId] });
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/rideshare-news', snapshotId] });
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/events', snapshotId] });
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/school-closures', snapshotId] });
    queryClient.invalidateQueries({ queryKey: ['/api/briefing/airport', snapshotId] });
  }, [snapshotId, queryClient]);

  // Base config - no caching, always fetch fresh data
  // For testing: fail hard, don't mask issues with stale data
  const baseConfig = {
    staleTime: 0,
    refetchOnMount: true as const,
    refetchOnWindowFocus: true as const,
    refetchOnReconnect: true as const,
  };

  // Weather - usually available immediately, no retry needed
  const weatherQuery = useQuery({
    queryKey: ['/api/briefing/weather', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] ☀️ Fetching weather for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { weather: null };
      const response = await fetch(`/api/briefing/weather/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] Weather 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { weather: null, _ownershipError: true };
        }
        console.error('[BriefingQuery] Weather failed:', response.status);
        // Return undefined to indicate "still loading" - UI will show spinner
        return undefined;
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Weather received');
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // Traffic - may need retries while briefing generates
  const trafficQuery = useQuery({
    queryKey: ['/api/briefing/traffic', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🚗 Fetching traffic for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { traffic: null };
      const response = await fetch(`/api/briefing/traffic/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] Traffic 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { traffic: null, _ownershipError: true };
        }
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return undefined;
      }
      const data = await response.json();
      const isLoading = isTrafficLoading(data);
      if (isLoading) {
        retryCountsRef.current.traffic++;
        console.log(`[BriefingQuery] ⏳ Traffic still loading... (attempt ${retryCountsRef.current.traffic}/${MAX_RETRY_ATTEMPTS})`);
      } else {
        console.log('[BriefingQuery] ✅ Traffic received');
      }
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
    // Retry every 2 seconds if data is still loading, stop after MAX_RETRY_ATTEMPTS
    // IMPORTANT: Don't retry if we got an ownership error (404)
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false; // Stop on ownership error
      const stillLoading = isTrafficLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.traffic < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return RETRY_INTERVAL_MS; // Poll faster for better UX
      }
      return false; // Stop polling, cache forever
    },
  });

  // News - may need retries while briefing generates
  const newsQuery = useQuery({
    queryKey: ['/api/briefing/rideshare-news', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 📰 Fetching news for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { news: null };
      const response = await fetch(`/api/briefing/rideshare-news/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] News 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { news: null, _ownershipError: true };
        }
        return undefined;
      }
      const data = await response.json();
      const isLoading = isNewsLoading(data);
      if (isLoading) {
        retryCountsRef.current.news++;
        console.log(`[BriefingQuery] ⏳ News still loading... (attempt ${retryCountsRef.current.news}/${MAX_RETRY_ATTEMPTS})`);
      } else {
        console.log('[BriefingQuery] ✅ News received');
      }
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false; // Stop on ownership error
      const stillLoading = isNewsLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.news < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return RETRY_INTERVAL_MS;
      }
      return false;
    },
  });

  // Events - from discovered_events table, usually ready quickly
  const eventsQuery = useQuery({
    queryKey: ['/api/briefing/events', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🎭 Fetching events for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { events: [] };
      const response = await fetch(`/api/briefing/events/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] Events 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { events: [], _ownershipError: true };
        }
        console.error('[BriefingQuery] Events failed:', response.status);
        // Return undefined to indicate "still loading" - UI will show spinner
        // Empty array would mean "fetched successfully but no events found"
        return undefined;
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Events received:', data.events?.length || 0);
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // School closures - usually ready quickly
  const schoolClosuresQuery = useQuery({
    queryKey: ['/api/briefing/school-closures', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🏫 Fetching school closures for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { school_closures: [] };
      const response = await fetch(`/api/briefing/school-closures/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] School closures 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { school_closures: [], _ownershipError: true };
        }
        // Return undefined to indicate "still loading" - UI will show spinner
        return undefined;
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ School closures received');
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // Airport - may need retries while briefing generates
  const airportQuery = useQuery({
    queryKey: ['/api/briefing/airport', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] ✈️ Fetching airport for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { airport_conditions: null };
      const response = await fetch(`/api/briefing/airport/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 404 = snapshot not found or ownership mismatch - request new snapshot
        if (response.status === 404) {
          console.error('[BriefingQuery] Airport 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { airport_conditions: null, _ownershipError: true };
        }
        console.error('[BriefingQuery] Airport failed:', response.status);
        return undefined;
      }
      const data = await response.json();
      const isLoading = isAirportLoading(data);
      if (isLoading) {
        retryCountsRef.current.airport++;
        console.log(`[BriefingQuery] ⏳ Airport still loading... (attempt ${retryCountsRef.current.airport}/${MAX_RETRY_ATTEMPTS})`);
      } else {
        console.log('[BriefingQuery] ✅ Airport received');
      }
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false; // Stop on ownership error
      const stillLoading = isAirportLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.airport < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return RETRY_INTERVAL_MS;
      }
      return false;
    },
  });

  return {
    weatherData: weatherQuery.data,
    trafficData: trafficQuery.data,
    newsData: newsQuery.data,
    eventsData: eventsQuery.data,
    schoolClosuresData: schoolClosuresQuery.data,
    airportData: airportQuery.data,
    isLoading: {
      weather: weatherQuery.isLoading,
      traffic: trafficQuery.isLoading || isTrafficLoading(trafficQuery.data),
      events: eventsQuery.isLoading,
      airport: airportQuery.isLoading || isAirportLoading(airportQuery.data),
    }
  };
}

/**
 * Standalone hook for fetching ONLY currently active events (happening now).
 * Used by MapPage to show real-time event markers.
 *
 * Unlike the main eventsQuery which fetches all upcoming events for the briefing tab,
 * this hook uses the ?filter=active parameter to get only events whose duration
 * includes the current time.
 *
 * Refetches every 60 seconds to stay current as events start/end.
 */
export function useActiveEventsQuery(snapshotId: string | null) {
  return useQuery({
    queryKey: ['/api/briefing/events', snapshotId, 'active'],
    queryFn: async () => {
      if (!snapshotId) return { events: [] };

      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(`/api/briefing/events/${snapshotId}?filter=active`, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.error('[BriefingQuery] Active events 404 - snapshot ownership error');
          dispatchSnapshotOwnershipError();
          return { events: [], _ownershipError: true };
        }
        console.error('[BriefingQuery] Active events failed:', response.status);
        return { events: [] };
      }

      const data = await response.json();
      console.log('[BriefingQuery] ✅ Active events received:', data.events?.length || 0);
      return data;
    },
    enabled: !!snapshotId,
    staleTime: 30000, // Consider stale after 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds for real-time accuracy
    refetchOnWindowFocus: true,
  });
}
