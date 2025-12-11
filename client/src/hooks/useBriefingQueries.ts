// client/src/hooks/useBriefingQueries.ts
// Consolidated briefing data queries for Co-Pilot
// IMPORTANT: Queries wait until briefing data is ready (phase >= consolidator)

import { useQuery } from '@tanstack/react-query';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  pipelinePhase?: PipelinePhase;
}

// Phases where briefing data is definitely in the database
const BRIEFING_READY_PHASES: PipelinePhase[] = ['consolidator', 'venues', 'enriching', 'complete'];

export function useBriefingQueries({ snapshotId, pipelinePhase }: BriefingQueriesOptions) {
  // Only enable queries when:
  // 1. We have a valid snapshotId
  // 2. Pipeline has reached at least 'consolidator' phase (briefing data is saved)
  const briefingReady = pipelinePhase && BRIEFING_READY_PHASES.includes(pipelinePhase);
  const isEnabled = !!snapshotId && snapshotId !== 'live-snapshot' && briefingReady;

  if (!briefingReady && snapshotId) {
    console.log(`[BriefingQuery] Waiting for briefing data (phase: ${pipelinePhase || 'unknown'})`);
  }

  const weatherQuery = useQuery({
    queryKey: ['/api/briefing/weather', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching weather for', snapshotId);
      if (!snapshotId) return { weather: null };
      const response = await fetch(`/api/briefing/weather/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Weather failed:', response.status);
        return { weather: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Weather received:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const trafficQuery = useQuery({
    queryKey: ['/api/briefing/traffic', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching traffic for', snapshotId);
      if (!snapshotId) return { traffic: null };
      const response = await fetch(`/api/briefing/traffic/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return { traffic: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Traffic received:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const newsQuery = useQuery({
    queryKey: ['/api/briefing/rideshare-news', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching news for', snapshotId);
      if (!snapshotId) return { news: null };
      const response = await fetch(`/api/briefing/rideshare-news/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return { news: null };
      const data = await response.json();
      console.log('[BriefingQuery] News received:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 45000,
  });

  const eventsQuery = useQuery({
    queryKey: ['/api/briefing/events', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching events for', snapshotId);
      if (!snapshotId) return { events: [] };
      const response = await fetch(`/api/briefing/events/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Events failed:', response.status);
        return { events: [] };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Events received:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const schoolClosuresQuery = useQuery({
    queryKey: ['/api/briefing/school-closures', snapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching school closures for', snapshotId);
      if (!snapshotId) return { school_closures: [] };
      const response = await fetch(`/api/briefing/school-closures/${snapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return { school_closures: [] };
      const data = await response.json();
      console.log('[BriefingQuery] School closures received:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 45000,
  });

  return {
    weatherData: weatherQuery.data,
    trafficData: trafficQuery.data,
    newsData: newsQuery.data,
    eventsData: eventsQuery.data,
    schoolClosuresData: schoolClosuresQuery.data,
    isLoading: {
      weather: weatherQuery.isLoading,
      traffic: trafficQuery.isLoading,
      events: eventsQuery.isLoading,
    }
  };
}
