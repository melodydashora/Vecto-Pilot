// client/src/hooks/useBriefingQueries.ts
// Consolidated briefing data queries for Co-Pilot
//
// FETCH-ONCE PATTERN: Like location-context, briefing data is fetched exactly ONCE
// per snapshot when the pipeline reaches 'immediate' phase (briefing data saved), then cached forever.
// New location = new snapshotId = new fetch. No polling, no refetching.

import { useQuery } from '@tanstack/react-query';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  pipelinePhase?: PipelinePhase;
}

// Phases where briefing data is definitely in the database (after 'analyzing' completes)
const BRIEFING_READY_PHASES: PipelinePhase[] = ['immediate', 'venues', 'enriching', 'complete'];

export function useBriefingQueries({ snapshotId, pipelinePhase }: BriefingQueriesOptions) {
  // Only enable queries when:
  // 1. We have a valid snapshotId
  // 2. Pipeline has reached at least 'immediate' phase (briefing data is saved)
  const briefingReady = pipelinePhase && BRIEFING_READY_PHASES.includes(pipelinePhase);
  const isEnabled = !!snapshotId && snapshotId !== 'live-snapshot' && briefingReady;

  // FETCH-ONCE config: staleTime=Infinity means data never goes stale
  // refetchOnMount/WindowFocus=false prevents re-fetching on component remount
  // Data is cached by snapshotId - new snapshot = new fetch
  const fetchOnceConfig = {
    staleTime: Infinity,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
  };

  const weatherQuery = useQuery({
    queryKey: ['/api/briefing/weather', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] ☀️ Fetching weather (once) for', snapshotId?.slice(0, 8));
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
    ...fetchOnceConfig,
  });

  const trafficQuery = useQuery({
    queryKey: ['/api/briefing/traffic', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🚗 Fetching traffic (once) for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { traffic: null };
      const response = await fetch(`/api/briefing/traffic/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return { traffic: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Traffic received');
      return data;
    },
    enabled: isEnabled,
    ...fetchOnceConfig,
  });

  const newsQuery = useQuery({
    queryKey: ['/api/briefing/rideshare-news', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 📰 Fetching news (once) for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { news: null };
      const response = await fetch(`/api/briefing/rideshare-news/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return { news: null };
      const data = await response.json();
      console.log('[BriefingQuery] ✅ News received');
      return data;
    },
    enabled: isEnabled,
    ...fetchOnceConfig,
  });

  const eventsQuery = useQuery({
    queryKey: ['/api/briefing/events', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🎭 Fetching events (once) for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { events: [] };
      const response = await fetch(`/api/briefing/events/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Events failed:', response.status);
        return { events: [] };
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Events received');
      return data;
    },
    enabled: isEnabled,
    ...fetchOnceConfig,
  });

  const schoolClosuresQuery = useQuery({
    queryKey: ['/api/briefing/school-closures', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] 🏫 Fetching school closures (once) for', snapshotId?.slice(0, 8));
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
    ...fetchOnceConfig,
  });

  const airportQuery = useQuery({
    queryKey: ['/api/briefing/airport', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] ✈️ Fetching airport conditions (once) for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { airport_conditions: null };
      const response = await fetch(`/api/briefing/airport/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Airport failed:', response.status);
        return { airport_conditions: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Airport conditions received:', data?.airport_conditions?.airports?.length || 0, 'airports');
      return data;
    },
    enabled: isEnabled,
    ...fetchOnceConfig,
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
      traffic: trafficQuery.isLoading,
      events: eventsQuery.isLoading,
      airport: airportQuery.isLoading,
    }
  };
}
