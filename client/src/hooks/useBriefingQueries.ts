// client/src/hooks/useBriefingQueries.ts
// Consolidated briefing data queries for Co-Pilot
//
// READINESS GATE (2026-04-17): Queries fetch once snapshotId exists AND
// snapshot.status === 'ok' (readiness gate — see Memory #111 and
// shared/schema.js:73-74: status defaults to 'pending', flips to 'ok' once
// all required snapshot fields are populated). This prevents the wasted
// "attempt N/12 success:false" retry storm where sub-queries (weather,
// traffic, news, events, school closures, airport) previously started firing
// the moment the client had a snapshot ID — before the server-side row had
// been enriched.
//
// Exception: the 'live-snapshot' sentinel bypasses the gate since it's
// generated on-demand without a persisted DB row that could reach status='ok'.
//
// SSE INTEGRATION: Subscribes to briefing_ready event to trigger refetch
// on real server-side completion (eliminates polling delay).
// Once real data arrives, it's cached (staleTime 30s — see baseConfig below).
// New location = new snapshotId = new fetch.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { getAuthHeader, subscribeBriefingReady } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';
// 2026-01-15: Centralized API routes and query keys
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
// 2026-04-10: Import storage keys for synchronous auth check in queryFn (Window 1 race fix)
import { STORAGE_KEYS } from '@/constants/storageKeys';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  // 2026-04-17: Readiness gate — queries only fire when snapshotStatus === 'ok'
  // (or when snapshotId === 'live-snapshot' sentinel). See Memory #111.
  snapshotStatus?: string;
  pipelinePhase?: PipelinePhase;
}

// 2026-04-05: Retry with exponential backoff (was fixed 2s × 40 = infinite loop when success:false)
// Backoff: 2s → 4s → 8s → 16s → 30s → 30s... Total coverage ~3 minutes with 12 attempts.
const MAX_RETRY_ATTEMPTS = 12;
const INITIAL_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;

// Calculate backoff interval: 2s, 4s, 8s, 16s, 30s, 30s, ...
function getBackoffInterval(attemptCount: number): number {
  return Math.min(INITIAL_RETRY_MS * Math.pow(2, attemptCount), MAX_RETRY_MS);
}

// Special error to indicate snapshot ownership failure (different user)
// This triggers a GPS refresh to create a new snapshot for the current user
const _SNAPSHOT_OWNERSHIP_ERROR = 'snapshot_ownership_error';

// Rate limit ownership error dispatch to prevent infinite loops
// If database/auth is broken, 404s will keep happening - don't spam refreshGPS
let lastOwnershipErrorTime = 0;
const OWNERSHIP_ERROR_COOLDOWN_MS = 60000; // 60 seconds between dispatches (was 30s)

// Track if we're in "cooling off" state after an ownership error
// During this time, ALL queries should be disabled to prevent loops
let isInCoolingOff = false;
// Track which snapshot caused the cooling off (so we can exit early when NEW snapshot arrives)
let coolingOffSnapshotId: string | null = null;
// Timeout handle for auto-exit (so we can clear it if we exit early)
let coolingOffTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Dispatch event to force logout when server returns 401 no_token
// This happens when:
// 1. Token not in localStorage (user not logged in)
// 2. Session expired server-side (2hr hard limit or 60min inactivity)
// 3. Token was cleared/corrupted
// 2026-01-06: Added to handle auth failures gracefully by redirecting to login
let lastAuthErrorTime = 0;
const AUTH_ERROR_COOLDOWN_MS = 5000; // Only dispatch once per 5 seconds

function dispatchAuthError(errorType: string) {
  const now = Date.now();
  if (now - lastAuthErrorTime < AUTH_ERROR_COOLDOWN_MS) {
    console.warn(`[BriefingQuery] 🔐 Auth error: ${errorType} - SKIPPED (cooldown active)`);
    return;
  }
  lastAuthErrorTime = now;
  console.error(`[BriefingQuery] 🔐 Auth error: ${errorType} - dispatching logout`);
  // Dispatch event that auth-context can listen to for forced logout
  window.dispatchEvent(new CustomEvent('vecto-auth-error', { detail: { error: errorType } }));
}

// Dispatch event to clear stale snapshot and request fresh GPS
function dispatchSnapshotOwnershipError(failedSnapshotId?: string) {
  // If already cooling off, skip entirely
  if (isInCoolingOff) {
    console.warn('[BriefingQuery] 🚨 Snapshot ownership error - SKIPPED (cooling off)');
    return;
  }

  const now = Date.now();
  if (now - lastOwnershipErrorTime < OWNERSHIP_ERROR_COOLDOWN_MS) {
    console.warn('[BriefingQuery] 🚨 Snapshot ownership error - SKIPPED (cooldown active)');
    return;
  }

  // Enter cooling off state
  isInCoolingOff = true;
  coolingOffSnapshotId = failedSnapshotId || null;
  lastOwnershipErrorTime = now;
  console.warn(`[BriefingQuery] 🚨 Snapshot ownership error for ${failedSnapshotId?.slice(0, 8) || 'unknown'} - entering cooling off state`);

  // Exit cooling off after the cooldown period (unless exited early)
  coolingOffTimeoutId = setTimeout(() => {
    isInCoolingOff = false;
    coolingOffSnapshotId = null;
    coolingOffTimeoutId = null;
    console.log('[BriefingQuery] ✅ Cooling off period ended (timeout)');
  }, OWNERSHIP_ERROR_COOLDOWN_MS);

  // Dispatch the event
  window.dispatchEvent(new CustomEvent('snapshot-ownership-error'));
}

// Exit cooling off early when a new (different) snapshot is received
// This allows queries to resume immediately after GPS refresh creates new snapshot
// 2026-01-06: Critical fix for briefing data appearing blank after ownership errors
function exitCoolingOffForNewSnapshot(newSnapshotId: string): void {
  if (!isInCoolingOff) return; // Not in cooling off, nothing to do

  // Only exit if this is a DIFFERENT snapshot than the one that caused the error
  if (newSnapshotId === coolingOffSnapshotId) {
    console.log(`[BriefingQuery] 🚫 Not exiting cooling off - same snapshot ${newSnapshotId.slice(0, 8)}`);
    return;
  }

  console.log(`[BriefingQuery] ✅ Exiting cooling off early - new snapshot ${newSnapshotId.slice(0, 8)} (was ${coolingOffSnapshotId?.slice(0, 8) || 'unknown'})`);

  // Clear the timeout
  if (coolingOffTimeoutId) {
    clearTimeout(coolingOffTimeoutId);
    coolingOffTimeoutId = null;
  }

  // Reset state
  isInCoolingOff = false;
  coolingOffSnapshotId = null;
}

// 2026-04-10: Reset module-level state on logout (Fix 4)
// Prevents stale cooldowns from persisting across logout/login cycles.
// Listens to vecto-auth-error (dispatched by dispatchAuthError above and by auth-context).
if (typeof window !== 'undefined') {
  window.addEventListener('vecto-auth-error', () => {
    isInCoolingOff = false;
    coolingOffSnapshotId = null;
    if (coolingOffTimeoutId) {
      clearTimeout(coolingOffTimeoutId);
      coolingOffTimeoutId = null;
    }
    lastAuthErrorTime = 0;
    lastOwnershipErrorTime = 0;
  });
}

// Check if queries should be disabled (cooling off from ownership error)
function shouldDisableQueries(): boolean {
  return isInCoolingOff;
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

// 2026-03-28: Check if events data is still loading/placeholder
// Events are "loaded" if we have events OR a reason for having none
function isEventsLoading(data: any): boolean {
  if (!data) return true;
  const events = data.events || [];
  const hasReason = data.reason !== null && data.reason !== undefined;
  return events.length === 0 && !hasReason;
}

export function useBriefingQueries({ snapshotId, snapshotStatus, pipelinePhase: _pipelinePhase }: BriefingQueriesOptions) {
  const queryClient = useQueryClient();

  // 2026-04-17: Readiness gate — honor the server-side snapshot.status === 'ok'
  // check before firing sub-queries. Previously we fired on snapshotId existence
  // alone, which caused the "attempt 1/12, 2/12 ... success:false" retry storm
  // during cold load while the server was still enriching the snapshot row.
  // The 'live-snapshot' sentinel bypasses the gate since it's generated on-demand
  // without a persisted row that could reach status='ok'.
  // Also disabled during cooling-off period after ownership errors to prevent loops.
  const isEnabled = !!snapshotId && (snapshotId === 'live-snapshot' || snapshotStatus === 'ok') && !shouldDisableQueries();

  // Subscribe to briefing_ready SSE event to trigger immediate refetch
  // Uses singleton SSE manager - connection is shared across all components
  useEffect(() => {
    if (!snapshotId) return;

    const refetchAllBriefingQueries = () => {
      console.log('[BriefingQuery] 📢 briefing_ready received, refetching for', snapshotId.slice(0, 8));
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_WEATHER(snapshotId) });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_TRAFFIC(snapshotId) });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId) });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_EVENTS(snapshotId) });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId) });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_AIRPORT(snapshotId) });
    };

    const unsubscribe = subscribeBriefingReady((readySnapshotId) => {
      if (readySnapshotId === snapshotId) {
        refetchAllBriefingQueries();
      }
    });

    return () => unsubscribe();
  }, [snapshotId, queryClient]);

  // Track retry attempts per query type (reset when snapshotId changes)
  const retryCountsRef = useRef<{ traffic: number; news: number; airport: number; events: number; snapshotId: string | null }>({
    traffic: 0,
    news: 0,
    airport: 0,
    events: 0,
    snapshotId: null
  });

  // Reset retry counts when snapshotId changes
  if (retryCountsRef.current.snapshotId !== snapshotId) {
    retryCountsRef.current = { traffic: 0, news: 0, airport: 0, events: 0, snapshotId };
  }

  // Force refetch all queries when snapshotId changes
  // This ensures we don't serve stale data from a previous snapshot
  // NOTE: Using ref to track previous snapshotId to prevent unnecessary invalidations
  const prevSnapshotIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshotId) return;

    // Only invalidate if snapshotId actually changed (not just on re-renders)
    if (prevSnapshotIdRef.current === snapshotId) {
      return;
    }
    prevSnapshotIdRef.current = snapshotId;

    console.log('[BriefingQuery] 🔄 SnapshotId changed to', snapshotId.slice(0, 8), '- invalidating all caches');

    // Invalidate all briefing queries for this snapshot to force fresh fetch
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_WEATHER(snapshotId) });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_TRAFFIC(snapshotId) });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId) });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_EVENTS(snapshotId) });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId) });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_AIRPORT(snapshotId) });
  }, [snapshotId, queryClient]);

  // 2026-01-06: Listen for new snapshots to exit cooling off early
  // When GPS refresh creates a new snapshot, we should immediately resume queries
  // rather than waiting for the full 60-second cooling off period
  useEffect(() => {
    const handleNewSnapshot = (event: Event) => {
      const customEvent = event as CustomEvent;
      const newSnapshotId = customEvent.detail?.snapshotId;
      if (newSnapshotId && typeof newSnapshotId === 'string') {
        exitCoolingOffForNewSnapshot(newSnapshotId);
      }
    };

    window.addEventListener('vecto-snapshot-saved', handleNewSnapshot);
    return () => window.removeEventListener('vecto-snapshot-saved', handleNewSnapshot);
  }, []);

  // Base config - conservative settings to prevent infinite loops
  // Issue: staleTime: 0 was causing refetch storms when queries returned errors
  const baseConfig = {
    staleTime: 30000, // 30 seconds - prevent constant refetching
    refetchOnMount: false as const, // Don't refetch on every mount
    refetchOnWindowFocus: false as const, // Don't refetch on focus
    refetchOnReconnect: false as const, // Don't refetch on reconnect
  };

  // Weather - usually available immediately, no retry needed
  const weatherQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_WEATHER(snapshotId!),
    queryFn: async () => {
      // 2026-04-10: Synchronous auth guard — prevents stale refetchInterval closures from firing after logout
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { weather: null };
      console.log('[BriefingQuery] ☀️ Fetching weather for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { weather: null };
      const response = await fetch(API_ROUTES.BRIEFING.WEATHER(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors - force logout and redirect to login
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { weather: null, _authError: true };
        }
        // Only treat 404 with specific error message as ownership error
        // Other 404s (or errors during briefing generation) should just retry
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            // Only dispatch ownership error if server explicitly says snapshot not found
            // (which could mean doesn't exist OR user mismatch)
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Weather 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { weather: null, _ownershipError: true };
            }
          } catch (_e) {
            // If we can't parse the response, don't treat as ownership error
            console.warn('[BriefingQuery] Weather 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Weather failed:', response.status);
        // 2026-01-06: Return null instead of undefined - React Query throws on undefined
        return { weather: null, _error: response.status };
      }
      const data = await response.json();
      // 2026-04-04: Guard against success:false responses — treat as loading/retry state
      if (data?.success === false) {
        console.warn('[BriefingQuery] Weather returned success:false');
        return { weather: null };
      }
      console.log('[BriefingQuery] ✅ Weather received');
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // Traffic - may need retries while briefing generates
  const trafficQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_TRAFFIC(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { traffic: null };
      console.log('[BriefingQuery] 🚗 Fetching traffic for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { traffic: null };
      const response = await fetch(API_ROUTES.BRIEFING.TRAFFIC(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { traffic: null, _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Traffic 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { traffic: null, _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] Traffic 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return { traffic: null, _error: response.status };
      }
      const data = await response.json();
      // 2026-04-04: Guard against success:false responses
      // 2026-04-05: FIX — must increment retry count here too, otherwise refetchInterval loops forever
      if (data?.success === false) {
        retryCountsRef.current.traffic++;
        const attempt = retryCountsRef.current.traffic;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          console.error(`[BriefingQuery] Max retries reached for traffic — stopping (${attempt}/${MAX_RETRY_ATTEMPTS})`);
          return { traffic: null, _exhausted: true, _generationFailed: data._generationFailed };
        }
        console.warn(`[BriefingQuery] Traffic returned success:false (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        return { traffic: null, _generationFailed: data._generationFailed };
      }
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
    // 2026-04-05: Exponential backoff, stop on exhaustion/ownership/permanent failure
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false;
      if (query.state.data?._exhausted) return false;
      if (query.state.data?._generationFailed) return false; // Server says generation permanently failed
      const stillLoading = isTrafficLoading(query.state.data);
      const attempts = retryCountsRef.current.traffic;
      if (stillLoading && attempts < MAX_RETRY_ATTEMPTS) {
        return getBackoffInterval(attempts);
      }
      return false;
    },
  });

  // News - may need retries while briefing generates
  const newsQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { news: null };
      console.log('[BriefingQuery] 📰 Fetching news for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { news: null };
      const response = await fetch(API_ROUTES.BRIEFING.RIDESHARE_NEWS(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { news: null, _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] News 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { news: null, _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] News 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] News failed:', response.status);
        return { news: null, _error: response.status };
      }
      const data = await response.json();
      // 2026-04-04: Guard against success:false (null news → crash in components)
      // 2026-04-05: FIX — must increment retry count here too
      if (data?.success === false) {
        retryCountsRef.current.news++;
        const attempt = retryCountsRef.current.news;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          console.error(`[BriefingQuery] Max retries reached for news — stopping (${attempt}/${MAX_RETRY_ATTEMPTS})`);
          return { news: null, _exhausted: true, _generationFailed: data._generationFailed };
        }
        console.warn(`[BriefingQuery] News returned success:false (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        return { news: null, _generationFailed: data._generationFailed };
      }
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
    // 2026-04-05: Exponential backoff
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false;
      if (query.state.data?._exhausted) return false;
      if (query.state.data?._generationFailed) return false;
      const stillLoading = isNewsLoading(query.state.data);
      const attempts = retryCountsRef.current.news;
      if (stillLoading && attempts < MAX_RETRY_ATTEMPTS) {
        return getBackoffInterval(attempts);
      }
      return false;
    },
  });

  // Events - from discovered_events table, usually ready quickly
  const eventsQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_EVENTS(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { events: [] };
      console.log('[BriefingQuery] 🎭 Fetching events for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { events: [] };
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { events: [], _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Events 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { events: [], _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] Events 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Events failed:', response.status);
        // 2026-01-06: Return empty events with error flag - React Query throws on undefined
        return { events: [], _error: response.status };
      }
      const data = await response.json();
      // 2026-04-05: FIX — increment retry on success:false (was missing → infinite loop)
      if (data?.success === false) {
        retryCountsRef.current.events++;
        const attempt = retryCountsRef.current.events;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          console.error(`[BriefingQuery] Max retries reached for events — stopping (${attempt}/${MAX_RETRY_ATTEMPTS})`);
          return { events: [], _exhausted: true, _generationFailed: data._generationFailed };
        }
        console.warn(`[BriefingQuery] Events returned success:false (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        return { events: [], _generationFailed: data._generationFailed };
      }
      const loading = isEventsLoading(data);
      if (loading) {
        retryCountsRef.current.events++;
        console.log(`[BriefingQuery] ⏳ Events still loading... (attempt ${retryCountsRef.current.events}/${MAX_RETRY_ATTEMPTS})`);
      } else {
        console.log('[BriefingQuery] ✅ Events received:', data.events?.length || 0);
      }
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
    // 2026-04-05: Exponential backoff
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false;
      if (query.state.data?._exhausted) return false;
      if (query.state.data?._generationFailed) return false;
      const stillLoading = isEventsLoading(query.state.data);
      const attempts = retryCountsRef.current.events;
      if (stillLoading && attempts < MAX_RETRY_ATTEMPTS) {
        return getBackoffInterval(attempts);
      }
      return false;
    },
  });

  // School closures - usually ready quickly
  const schoolClosuresQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { school_closures: [] };
      console.log('[BriefingQuery] 🏫 Fetching school closures for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { school_closures: [] };
      const response = await fetch(API_ROUTES.BRIEFING.SCHOOL_CLOSURES(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { school_closures: [], _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] School closures 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { school_closures: [], _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] School closures 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] School closures failed:', response.status);
        return { school_closures: [], _error: response.status };
      }
      const data = await response.json();
      // 2026-04-04: Guard against success:false responses
      if (data?.success === false) {
        console.warn('[BriefingQuery] School closures returned success:false');
        return { school_closures: [] };
      }
      console.log('[BriefingQuery] ✅ School closures received');
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // Airport - may need retries while briefing generates
  const airportQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_AIRPORT(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { airport_conditions: null };
      console.log('[BriefingQuery] ✈️ Fetching airport for', snapshotId?.slice(0, 8));
      if (!snapshotId) return { airport_conditions: null };
      const response = await fetch(API_ROUTES.BRIEFING.AIRPORT(snapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { airport_conditions: null, _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Airport 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { airport_conditions: null, _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] Airport 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Airport failed:', response.status);
        return { airport_conditions: null, _error: response.status };
      }
      const data = await response.json();
      // 2026-04-05: FIX — increment retry on success:false (was missing → infinite loop)
      if (data?.success === false) {
        retryCountsRef.current.airport++;
        const attempt = retryCountsRef.current.airport;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          console.error(`[BriefingQuery] Max retries reached for airport — stopping (${attempt}/${MAX_RETRY_ATTEMPTS})`);
          return { airport_conditions: null, _exhausted: true, _generationFailed: data._generationFailed };
        }
        console.warn(`[BriefingQuery] Airport returned success:false (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        return { airport_conditions: null, _generationFailed: data._generationFailed };
      }
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
    // 2026-04-05: Exponential backoff
    refetchInterval: (query) => {
      if (query.state.data?._ownershipError) return false;
      if (query.state.data?._exhausted) return false;
      if (query.state.data?._generationFailed) return false;
      const stillLoading = isAirportLoading(query.state.data);
      const attempts = retryCountsRef.current.airport;
      if (stillLoading && attempts < MAX_RETRY_ATTEMPTS) {
        return getBackoffInterval(attempts);
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
    // 2026-02-18: FIX - Added news + schoolClosures (were missing → undefined → no loading spinners)
    // 2026-04-05: Stop showing loading once retries exhausted (_exhausted flag)
    isLoading: {
      weather: weatherQuery.isLoading,
      traffic: trafficQuery.isLoading || (isTrafficLoading(trafficQuery.data) && !trafficQuery.data?._exhausted && !trafficQuery.data?._generationFailed),
      events: eventsQuery.isLoading || (isEventsLoading(eventsQuery.data) && !eventsQuery.data?._exhausted && !eventsQuery.data?._generationFailed),
      news: newsQuery.isLoading || (isNewsLoading(newsQuery.data) && !newsQuery.data?._exhausted && !newsQuery.data?._generationFailed),
      airport: airportQuery.isLoading || (isAirportLoading(airportQuery.data) && !airportQuery.data?._exhausted && !airportQuery.data?._generationFailed),
      schoolClosures: schoolClosuresQuery.isLoading,
    },
    // 2026-04-05: Expose "gave up" state so UI can show "Briefing data unavailable"
    isUnavailable: {
      traffic: !!(trafficQuery.data?._exhausted || trafficQuery.data?._generationFailed),
      events: !!(eventsQuery.data?._exhausted || eventsQuery.data?._generationFailed),
      news: !!(newsQuery.data?._exhausted || newsQuery.data?._generationFailed),
      airport: !!(airportQuery.data?._exhausted || airportQuery.data?._generationFailed),
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
    queryKey: QUERY_KEYS.BRIEFING_EVENTS_ACTIVE(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { events: [] };
      if (!snapshotId) return { events: [] };

      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS_ACTIVE(snapshotId), {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
          return { events: [], _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Active events 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { events: [], _ownershipError: true };
            }
          } catch (_e) {
            console.warn('[BriefingQuery] Active events 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Active events failed:', response.status);
        return { events: [] };
      }

      const data = await response.json();
      // 2026-04-04: Guard against success:false responses
      if (data?.success === false) {
        return { events: [] };
      }
      console.log('[BriefingQuery] ✅ Active events received:', data.events?.length || 0);
      return data;
    },
    // 2026-04-10: Added shouldDisableQueries() check (was missing — race condition on logout)
    enabled: !!snapshotId && !shouldDisableQueries(),
    staleTime: 30000, // Consider stale after 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds for real-time accuracy
    refetchOnWindowFocus: true,
  });
}
