// client/src/hooks/useBriefingQueries.ts
// Consolidated briefing data queries for Co-Pilot
//
// SMART CACHE PATTERN: Queries fetch as soon as snapshot exists.
// If data is still generating (placeholder response), we retry every 5 seconds.
// Once real data arrives, it's cached forever (staleTime: Infinity).
// New location = new snapshotId = new fetch.

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  pipelinePhase?: PipelinePhase;
}

// Maximum retry attempts before giving up (6 attempts × 5 seconds = 30 seconds)
const MAX_RETRY_ATTEMPTS = 6;

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
  // Enable queries as soon as we have a valid snapshotId
  const isEnabled = !!snapshotId && snapshotId !== 'live-snapshot';

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

  // Base config - cache forever once we have real data
  const baseConfig = {
    staleTime: Infinity,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
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
        console.error('[BriefingQuery] Weather failed:', response.status);
        return { weather: null };
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
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return { traffic: null };
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
    // Retry every 5 seconds if data is still loading, stop after MAX_RETRY_ATTEMPTS
    refetchInterval: (query) => {
      const stillLoading = isTrafficLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.traffic < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return 5000; // Keep polling
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
      if (!response.ok) return { news: null };
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
      const stillLoading = isNewsLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.news < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return 5000;
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
        console.error('[BriefingQuery] Events failed:', response.status);
        return { events: [] };
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
      if (!response.ok) return { school_closures: [] };
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
        console.error('[BriefingQuery] Airport failed:', response.status);
        return { airport_conditions: null };
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
      const stillLoading = isAirportLoading(query.state.data);
      const hasRetriesLeft = retryCountsRef.current.airport < MAX_RETRY_ATTEMPTS;
      if (stillLoading && hasRetriesLeft) {
        return 5000;
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
