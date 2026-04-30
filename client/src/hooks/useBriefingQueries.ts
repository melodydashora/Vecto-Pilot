// client/src/hooks/useBriefingQueries.ts
<<<<<<< HEAD
// Consolidated briefing data queries for Co-Pilot
//
// SMART CACHE PATTERN: Queries fetch as soon as snapshot exists.
// If data is still generating (placeholder response), we retry every 5 seconds.
// Once real data arrives, it's cached forever (staleTime: Infinity).
// New location = new snapshotId = new fetch.
//
// SSE INTEGRATION: Subscribes to briefing_ready event to immediately invalidate
// cache when backend signals data is ready (eliminates polling delay).
=======
// Briefing data fetch for the Co-Pilot briefing tab.
//
// 2026-04-18: PHASE B REFACTOR — single aggregate query replaces six independent
// per-section queries. The prior architecture (weather, traffic, events, news,
// airport, school-closures each fetched separately) had three structural problems:
//
//   1. Six-way race — each section landed at a different time, so the tab could
//      show partial/inconsistent state while real data existed server-side.
//   2. Six independent retry counters, six different refetch intervals, six
//      different loading detectors — any one could stall and freeze the tab
//      spinner even when the others resolved.
//   3. The strategist LLM receives the briefing row as a SINGLE object; the tab
//      reconstructing it from six fetches could never be guaranteed to mirror
//      what the LLM saw (the tab's purpose per Melody: "I built this tab to
//      see what's being sent to the strategist").
//
// This refactor uses /api/briefing/snapshot/:snapshotId (aggregate endpoint)
// which returns the full briefing row in one round-trip, preserving the
// transparency-window contract. The external shape of this hook is unchanged
// so no component needs to be updated; each section's data is derived from
// the single aggregate response.
//
// Next phase (Phase A, not in this commit): server-side progressive writes
// and per-section NOTIFYs so the tab populates weather-first, then traffic,
// then events as each provider resolves.
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { getAuthHeader, subscribeBriefingReady } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';
<<<<<<< HEAD
// 2026-01-15: Centralized API routes and query keys
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';

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
=======
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';

interface BriefingQueriesOptions {
  snapshotId: string | null;
  snapshotStatus?: string;
  pipelinePhase?: PipelinePhase;
  // 2026-04-19: M3 fix — accept isAuthenticated to align the briefing query's
  // logout gating with the rest of co-pilot-context.tsx (strategy/blocks/bars
  // queries all gate on isAuthenticated). Previously this hook's only logout
  // signal was a `localStorage.AUTH_TOKEN` check inside queryFn, which fires
  // slightly later than the React state update, leaving a window where the
  // query saw a missing token and froze polling. Optional for backward compat.
  isAuthenticated?: boolean;
}

// Retry machinery (2026-04-05 hardening): exponential backoff, max 12 attempts.
// Applied at the aggregate level, not per-section — one retry budget, not six.
const MAX_RETRY_ATTEMPTS = 12;
const INITIAL_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;
function getBackoffInterval(attemptCount: number): number {
  return Math.min(INITIAL_RETRY_MS * Math.pow(2, attemptCount), MAX_RETRY_MS);
}

// Cooling-off state for snapshot-ownership errors (unchanged from prior version —
// prevents GPS-refresh loops when a stale snapshot is owned by a different user).
let isInCoolingOff = false;
let coolingOffSnapshotId: string | null = null;
let coolingOffTimeoutId: ReturnType<typeof setTimeout> | null = null;
const OWNERSHIP_ERROR_COOLDOWN_MS = 60000;
let lastOwnershipErrorTime = 0;
let lastAuthErrorTime = 0;
const AUTH_ERROR_COOLDOWN_MS = 5000;
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7

function dispatchAuthError(errorType: string) {
  const now = Date.now();
  if (now - lastAuthErrorTime < AUTH_ERROR_COOLDOWN_MS) {
    console.warn(`[BriefingQuery] 🔐 Auth error: ${errorType} - SKIPPED (cooldown active)`);
    return;
  }
  lastAuthErrorTime = now;
  console.error(`[BriefingQuery] 🔐 Auth error: ${errorType} - dispatching logout`);
<<<<<<< HEAD
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
=======
  window.dispatchEvent(new CustomEvent('vecto-auth-error', { detail: { error: errorType } }));
}

function dispatchSnapshotOwnershipError(failedSnapshotId?: string) {
  if (isInCoolingOff) return;
  const now = Date.now();
  if (now - lastOwnershipErrorTime < OWNERSHIP_ERROR_COOLDOWN_MS) return;
  isInCoolingOff = true;
  coolingOffSnapshotId = failedSnapshotId || null;
  lastOwnershipErrorTime = now;
  console.warn(`[BriefingQuery] 🚨 Snapshot ownership error for ${failedSnapshotId?.slice(0, 8) || 'unknown'} - cooling off`);
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  coolingOffTimeoutId = setTimeout(() => {
    isInCoolingOff = false;
    coolingOffSnapshotId = null;
    coolingOffTimeoutId = null;
<<<<<<< HEAD
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
=======
  }, OWNERSHIP_ERROR_COOLDOWN_MS);
  window.dispatchEvent(new CustomEvent('snapshot-ownership-error'));
}

function exitCoolingOffForNewSnapshot(newSnapshotId: string): void {
  if (!isInCoolingOff) return;
  if (newSnapshotId === coolingOffSnapshotId) return;
  if (coolingOffTimeoutId) { clearTimeout(coolingOffTimeoutId); coolingOffTimeoutId = null; }
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  isInCoolingOff = false;
  coolingOffSnapshotId = null;
}

<<<<<<< HEAD
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

export function useBriefingQueries({ snapshotId, pipelinePhase: _pipelinePhase }: BriefingQueriesOptions) {
  const queryClient = useQueryClient();

  // Enable queries as soon as we have a valid snapshotId
  // Note: 'live-snapshot' is now supported - it represents real-time location data
  // with briefing generated on-demand. Only disable for null/empty snapshotId.
  // ALSO disable during cooling-off period after ownership errors to prevent loops
  const isEnabled = !!snapshotId && !shouldDisableQueries();

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
=======
if (typeof window !== 'undefined') {
  window.addEventListener('vecto-auth-error', () => {
    isInCoolingOff = false;
    coolingOffSnapshotId = null;
    if (coolingOffTimeoutId) { clearTimeout(coolingOffTimeoutId); coolingOffTimeoutId = null; }
    lastAuthErrorTime = 0;
    lastOwnershipErrorTime = 0;
  });
}

function shouldDisableQueries(): boolean { return isInCoolingOff; }

// Aggregate response shape (matches /api/briefing/snapshot/:snapshotId).
// Each section carries a _generationFailed flag so the UI can distinguish
// "still loading" from "generation permanently failed for this section".
interface BriefingAggregate {
  snapshot_id: string;
  briefing: {
    weather: { current: any; forecast: any; _generationFailed?: boolean };
    traffic: any & { _generationFailed?: boolean };
    news: { items: any[]; reason: string | null; _generationFailed?: boolean };
    events: {
      items: any[];
      marketEvents: any[];
      market_name: string | null;
      reason: string | null;
      _generationFailed?: boolean;
    };
    school_closures: { items: any[]; reason: string | null; _generationFailed?: boolean };
    airport_conditions: any & { _generationFailed?: boolean };
  };
  created_at: string;
  updated_at: string;
  generated_at: string;
  _error?: number;
  _authError?: boolean;
  _ownershipError?: boolean;
  _exhausted?: boolean;
  _notGenerated?: boolean;
}

// Detect whether an aggregate response is "still missing its payload" and should
// trigger a retry. True if: no briefing row yet, or the response is explicitly
// flagged not-generated. False once ANY section has real data or a failure sentinel.
function isAggregateLoading(data: BriefingAggregate | undefined): boolean {
  if (!data) return true;
  if (data._authError || data._ownershipError || data._exhausted) return false;
  if (data._notGenerated) return true;
  const b = data.briefing;
  if (!b) return true;
  // If every section is simultaneously empty AND none has a _generationFailed
  // flag AND none has a reason string, the row is still a placeholder.
  const anySectionReady =
    !!(b.weather?.current) ||
    !!(b.traffic && typeof b.traffic === 'object' && Object.keys(b.traffic).some(k => k !== '_generationFailed')) ||
    (Array.isArray(b.news?.items) && b.news.items.length > 0) ||
    (Array.isArray(b.events?.items) && b.events.items.length > 0) ||
    (Array.isArray(b.events?.marketEvents) && b.events.marketEvents.length > 0) ||
    (Array.isArray(b.school_closures?.items) && b.school_closures.items.length > 0) ||
    !!(b.airport_conditions && typeof b.airport_conditions === 'object' && (b.airport_conditions.airports?.length > 0 || b.airport_conditions.recommendations)) ||
    !!b.weather?._generationFailed ||
    !!b.traffic?._generationFailed ||
    !!b.news?._generationFailed ||
    !!b.events?._generationFailed ||
    !!b.school_closures?._generationFailed ||
    !!b.airport_conditions?._generationFailed ||
    !!b.news?.reason ||
    !!b.events?.reason ||
    // 2026-04-19: H2 fix — school_closures.reason was missing from the readiness
    // check, so a "no school closures for this region" reason from the server
    // could leave the section flagged as still-loading.
    !!b.school_closures?.reason;
  return !anySectionReady;
}

export function useBriefingQueries({
  snapshotId,
  snapshotStatus: _snapshotStatus,
  pipelinePhase: _pipelinePhase,
  isAuthenticated,
}: BriefingQueriesOptions) {
  const queryClient = useQueryClient();

  // 2026-04-18: Readiness gate softened. Prior version required
  // `snapshotStatus === 'ok'`, but the /api/snapshot/:snapshotId endpoint was
  // silently omitting the `status` field until the 2026-04-18 server fix, so
  // the gate was permanently closed for every real UUID snapshot and the
  // briefing tab spinner never ended. The aggregate endpoint already returns
  // 404 (→ `_notGenerated`) while briefing is still generating, and the hook
  // retries with exponential backoff, so the extra gate is redundant.
  // 2026-04-19: M3 fix — also gate on isAuthenticated when the caller provides
  // it, matching the pattern used by strategy/blocks/bars queries. If undefined
  // (legacy callers), behave as before. False = gate is closed.
  const isEnabled =
    !!snapshotId &&
    !shouldDisableQueries() &&
    (isAuthenticated === undefined || isAuthenticated === true);

  // SSE subscription: when briefing_ready fires, refetch the single aggregate query.
  useEffect(() => {
    if (!snapshotId) return;
    const refetchAggregate = () => {
      console.log('[BriefingQuery] 📢 briefing_ready received, refetching aggregate for', snapshotId.slice(0, 8));
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_AGGREGATE(snapshotId) });
    };
    const unsubscribe = subscribeBriefingReady(snapshotId, (readySnapshotId) => {
      if (readySnapshotId === snapshotId) refetchAggregate();
    });
    return () => unsubscribe();
  }, [snapshotId, queryClient]);

  // Retry counter — single counter for the aggregate, replacing six per-section
  // counters. Reset on snapshotId change.
  const retryCountRef = useRef<{ count: number; snapshotId: string | null }>({ count: 0, snapshotId: null });
  if (retryCountRef.current.snapshotId !== snapshotId) {
    retryCountRef.current = { count: 0, snapshotId };
  }

  // Cache invalidation on snapshotId change — force fresh fetch so we don't
  // serve stale data from a previous snapshot.
  const prevSnapshotIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshotId) return;
    if (prevSnapshotIdRef.current === snapshotId) return;
    prevSnapshotIdRef.current = snapshotId;
    console.log('[BriefingQuery] 🔄 SnapshotId changed to', snapshotId.slice(0, 8), '- invalidating aggregate cache');
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_AGGREGATE(snapshotId) });
  }, [snapshotId, queryClient]);

  // Cooling-off exit when a new snapshot arrives.
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  useEffect(() => {
    const handleNewSnapshot = (event: Event) => {
      const customEvent = event as CustomEvent;
      const newSnapshotId = customEvent.detail?.snapshotId;
      if (newSnapshotId && typeof newSnapshotId === 'string') {
        exitCoolingOffForNewSnapshot(newSnapshotId);
      }
    };
<<<<<<< HEAD

=======
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
    window.addEventListener('vecto-snapshot-saved', handleNewSnapshot);
    return () => window.removeEventListener('vecto-snapshot-saved', handleNewSnapshot);
  }, []);

<<<<<<< HEAD
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
    queryKey: QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId!),
    queryFn: async () => {
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
    queryKey: QUERY_KEYS.BRIEFING_EVENTS(snapshotId!),
    queryFn: async () => {
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
      console.log('[BriefingQuery] ✅ Events received:', data.events?.length || 0);
      return data;
    },
    enabled: isEnabled,
    ...baseConfig,
  });

  // School closures - usually ready quickly
  const schoolClosuresQuery = useQuery({
    queryKey: QUERY_KEYS.BRIEFING_SCHOOL_CLOSURES(snapshotId!),
    queryFn: async () => {
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
=======
  // SINGLE aggregate query replaces the six per-section queries.
  const aggregateQuery = useQuery<BriefingAggregate>({
    queryKey: QUERY_KEYS.BRIEFING_AGGREGATE(snapshotId!),
    queryFn: async (): Promise<BriefingAggregate> => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) {
        return { snapshot_id: snapshotId!, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _authError: true };
      }
      console.log('[BriefingQuery] 📦 Fetching aggregate briefing for', snapshotId?.slice(0, 8));
      if (!snapshotId) {
        return { snapshot_id: '', briefing: {} as any, created_at: '', updated_at: '', generated_at: '' };
      }
      const response = await fetch(API_ROUTES.BRIEFING.AGGREGATE(snapshotId), {
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch { dispatchAuthError('unauthorized'); }
          return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Aggregate 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _ownershipError: true };
            }
            // "Briefing not yet generated" — retry expected
            console.log('[BriefingQuery] ⏳ Briefing not yet generated for', snapshotId.slice(0, 8));
            retryCountRef.current.count++;
            if (retryCountRef.current.count >= MAX_RETRY_ATTEMPTS) {
              return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _exhausted: true };
            }
            return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _notGenerated: true };
          } catch {
            console.warn('[BriefingQuery] Aggregate 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Aggregate fetch failed:', response.status);
        return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _error: response.status };
      }
      const data = await response.json();
      console.log('[BriefingQuery] ✅ Aggregate received for', snapshotId.slice(0, 8),
        '| weather=', !!data?.briefing?.weather?.current,
        'traffic=', !!data?.briefing?.traffic && Object.keys(data.briefing.traffic).length > 1,
        'events=', data?.briefing?.events?.items?.length ?? 0,
        'news=', data?.briefing?.news?.items?.length ?? 0,
        'airport=', data?.briefing?.airport_conditions?.airports?.length ?? 0,
      );
      return data as BriefingAggregate;
    },
    enabled: isEnabled,
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) => {
      const data = query.state.data as BriefingAggregate | undefined;
      if (data?._ownershipError) return false;
      if (data?._authError) return false;
      if (data?._exhausted) return false;
      // 2026-04-18: C3 fix — 5xx errors retry with backoff (bounded) instead
      // of silently freezing the tab. Auth/ownership errors still stop immediately.
      // 4xx (other than 401/404 which are handled explicitly) stop polling since
      // they're unlikely to self-heal.
      if (data?._error && data._error >= 400 && data._error < 500) return false;
      // Poll while briefing is still being generated server-side OR while we're
      // recovering from a transient 5xx.
      const needsRetry = isAggregateLoading(data) || (data?._error && data._error >= 500);
      if (needsRetry && retryCountRef.current.count < MAX_RETRY_ATTEMPTS) {
        return getBackoffInterval(retryCountRef.current.count);
      }
      return false;
    },
  });

  // Derive per-section data and loading/unavailable flags from the aggregate.
  // Keep the same external shape as the prior six-query API.
  const b = aggregateQuery.data?.briefing;
  const stillLoading = isAggregateLoading(aggregateQuery.data);
  const exhausted = !!aggregateQuery.data?._exhausted;

  // Derived section data — wrapped to match what callers of the old hook expected.
  // 2026-04-19: H3 fix — carry _generationFailed at the outer level so WeatherCard
  // can render a "weather temporarily unavailable" state instead of silently
  // hiding when the weather provider permanently failed.
  const weatherData = b?.weather
    ? {
        weather: { current: b.weather.current, forecast: b.weather.forecast },
        _generationFailed: !!b.weather._generationFailed,
        _exhausted: exhausted,
      }
    : undefined;
  const trafficData = b?.traffic
    ? { traffic: b.traffic, _generationFailed: !!b.traffic._generationFailed, _exhausted: exhausted }
    : undefined;
  const newsData = b?.news
    ? { news: { items: b.news.items, reason: b.news.reason }, _generationFailed: !!b.news._generationFailed, _exhausted: exhausted }
    : undefined;
  const eventsData = b?.events
    ? {
        events: b.events.items,
        marketEvents: b.events.marketEvents,
        market_name: b.events.market_name,
        reason: b.events.reason,
        _generationFailed: !!b.events._generationFailed,
        _exhausted: exhausted,
      }
    : undefined;
  const schoolClosuresData = b?.school_closures
    ? { school_closures: b.school_closures.items, reason: b.school_closures.reason, _generationFailed: !!b.school_closures._generationFailed }
    : undefined;
  const airportData = b?.airport_conditions
    ? { airport_conditions: b.airport_conditions, _generationFailed: !!b.airport_conditions._generationFailed, _exhausted: exhausted }
    : undefined;

  // Per-section loading flags: a section is "loading" while the aggregate
  // is still in flight AND this section hasn't been populated yet (no data,
  // no _generationFailed marker, no reason).
  const sectionLoading = (hasData: boolean, failed: boolean | undefined) => {
    if (failed) return false;
    if (hasData) return false;
    if (exhausted) return false;
    return aggregateQuery.isLoading || stillLoading;
  };

  return {
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    isLoading: {
      weather: sectionLoading(!!b?.weather?.current, b?.weather?._generationFailed),
      traffic: sectionLoading(
        !!b?.traffic && typeof b.traffic === 'object' && Object.keys(b.traffic).some(k => k !== '_generationFailed'),
        b?.traffic?._generationFailed,
      ),
      events: sectionLoading(
        (Array.isArray(b?.events?.items) && b!.events.items.length > 0) || !!b?.events?.reason,
        b?.events?._generationFailed,
      ),
      news: sectionLoading(
        (Array.isArray(b?.news?.items) && b!.news.items.length > 0) || !!b?.news?.reason,
        b?.news?._generationFailed,
      ),
      airport: sectionLoading(
        !!b?.airport_conditions && (b!.airport_conditions.airports?.length > 0 || !!b!.airport_conditions.recommendations),
        b?.airport_conditions?._generationFailed,
      ),
      schoolClosures: sectionLoading(
        Array.isArray(b?.school_closures?.items),
        b?.school_closures?._generationFailed,
      ),
    },
    isUnavailable: {
      traffic: !!(exhausted || b?.traffic?._generationFailed),
      events: !!(exhausted || b?.events?._generationFailed),
      news: !!(exhausted || b?.news?._generationFailed),
      airport: !!(exhausted || b?.airport_conditions?._generationFailed),
    },
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
  };
}

/**
 * Standalone hook for fetching ONLY currently active events (happening now).
<<<<<<< HEAD
 * Used by MapPage to show real-time event markers.
 *
 * Unlike the main eventsQuery which fetches all upcoming events for the briefing tab,
 * this hook uses the ?filter=active parameter to get only events whose duration
 * includes the current time.
 *
 * Refetches every 60 seconds to stay current as events start/end.
=======
 * Used by MapPage for real-time event markers. Unchanged from prior version —
 * this is a specialized real-time view, not part of the briefing tab aggregate.
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
 */
export function useActiveEventsQuery(snapshotId: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.BRIEFING_EVENTS_ACTIVE(snapshotId!),
    queryFn: async () => {
<<<<<<< HEAD
      if (!snapshotId) return { events: [] };

      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS_ACTIVE(snapshotId), {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        // 2026-01-06: Handle 401 auth errors
=======
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { events: [] };
      if (!snapshotId) return { events: [] };
      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS_ACTIVE(snapshotId), {
        headers: getAuthHeader(),
      });
      if (!response.ok) {
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
<<<<<<< HEAD
          } catch (_e) {
            dispatchAuthError('unauthorized');
          }
=======
          } catch { dispatchAuthError('unauthorized'); }
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
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
<<<<<<< HEAD
          } catch (_e) {
            console.warn('[BriefingQuery] Active events 404 - could not parse error body');
          }
=======
          } catch { /* ignore */ }
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
        }
        console.error('[BriefingQuery] Active events failed:', response.status);
        return { events: [] };
      }
<<<<<<< HEAD

      const data = await response.json();
      console.log('[BriefingQuery] ✅ Active events received:', data.events?.length || 0);
      return data;
    },
    enabled: !!snapshotId,
    staleTime: 30000, // Consider stale after 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds for real-time accuracy
=======
      const data = await response.json();
      if (data?.success === false) return { events: [] };
      console.log('[BriefingQuery] ✅ Active events received:', data.events?.length || 0);
      return data;
    },
    enabled: !!snapshotId && !shouldDisableQueries(),
    staleTime: 30000,
    refetchInterval: 60000,
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
    refetchOnWindowFocus: true,
  });
}
