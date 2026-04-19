// client/src/hooks/useBriefingQueries.ts
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

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { getAuthHeader, subscribeBriefingReady } from '@/utils/co-pilot-helpers';
import type { PipelinePhase } from '@/types/co-pilot';
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

function dispatchAuthError(errorType: string) {
  const now = Date.now();
  if (now - lastAuthErrorTime < AUTH_ERROR_COOLDOWN_MS) {
    console.warn(`[BriefingQuery] 🔐 Auth error: ${errorType} - SKIPPED (cooldown active)`);
    return;
  }
  lastAuthErrorTime = now;
  console.error(`[BriefingQuery] 🔐 Auth error: ${errorType} - dispatching logout`);
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
  coolingOffTimeoutId = setTimeout(() => {
    isInCoolingOff = false;
    coolingOffSnapshotId = null;
    coolingOffTimeoutId = null;
  }, OWNERSHIP_ERROR_COOLDOWN_MS);
  window.dispatchEvent(new CustomEvent('snapshot-ownership-error'));
}

function exitCoolingOffForNewSnapshot(newSnapshotId: string): void {
  if (!isInCoolingOff) return;
  if (newSnapshotId === coolingOffSnapshotId) return;
  if (coolingOffTimeoutId) { clearTimeout(coolingOffTimeoutId); coolingOffTimeoutId = null; }
  isInCoolingOff = false;
  coolingOffSnapshotId = null;
}

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
  };
}

/**
 * Standalone hook for fetching ONLY currently active events (happening now).
 * Used by MapPage for real-time event markers. Unchanged from prior version —
 * this is a specialized real-time view, not part of the briefing tab aggregate.
 */
export function useActiveEventsQuery(snapshotId: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.BRIEFING_EVENTS_ACTIVE(snapshotId!),
    queryFn: async () => {
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)) return { events: [] };
      if (!snapshotId) return { events: [] };
      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS_ACTIVE(snapshotId), {
        headers: getAuthHeader(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch { dispatchAuthError('unauthorized'); }
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
          } catch { /* ignore */ }
        }
        console.error('[BriefingQuery] Active events failed:', response.status);
        return { events: [] };
      }
      const data = await response.json();
      if (data?.success === false) return { events: [] };
      console.log('[BriefingQuery] ✅ Active events received:', data.events?.length || 0);
      return data;
    },
    enabled: !!snapshotId && !shouldDisableQueries(),
    staleTime: 30000,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
}
