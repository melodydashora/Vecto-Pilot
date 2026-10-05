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
// Section and verified-event writes notify this same saved-row reader as the
// providers resolve. Progress is displayable; final persistence gates Strategy.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useCallback } from 'react';
import { subscribeBriefingReady } from '@/utils/co-pilot-helpers';
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
const PROGRESS_POLL_MS = 2000;
const NO_PROGRESS_TIMEOUT_MS = 180000;
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
  window.dispatchEvent(new CustomEvent('snapshot-ownership-error', { detail: { snapshotId: failedSnapshotId } }));
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
  status?: 'pending' | 'complete' | 'error';
  briefing: {
    // 2026-07-06 (todo #24): _pending = raw briefing column still NULL
    // (generation in flight); _generationFailed = ran and failed (reason
    // recorded); neither = verified result. Three states, never collapsed.
    weather: { current: any; forecast: any; _pending?: boolean; _generationFailed?: boolean };
    traffic: any & { _pending?: boolean; _generationFailed?: boolean };
    news: { items: any[]; reason: string | null; _pending?: boolean; _generationFailed?: boolean };
    events: {
      items: any[];
      marketEvents: any[];
      market_name: string | null;
      market_status?: 'complete' | 'partial' | 'unavailable';
      unresolved_market_events?: number;
      reason: string | null;
      _pending?: boolean;
      _generationFailed?: boolean;
    };
    school_closures: { items: any[]; reason: string | null; _pending?: boolean; _generationFailed?: boolean };
    airport_conditions: any & { _pending?: boolean; _generationFailed?: boolean };
    holiday?: any & { _pending?: boolean; _generationFailed?: boolean };
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

function generationFailure(data: BriefingAggregate | undefined): string | null {
  if (!data?.briefing || data._authError || data._ownershipError) return null;
  // A failed provider must not hide sibling sections that are still arriving.
  // The owner persists a terminal status after every section has settled.
  if (data.status === 'pending') return null;
  const labels: Record<string, string> = { weather: 'Weather', traffic: 'Traffic', events: 'Events', news: 'News',
    school_closures: 'Schools', airport_conditions: 'Airport', holiday: 'Holiday' };
  const failures = Object.entries(data.briefing).filter(([, section]) => section?._generationFailed)
    .map(([key, section]) => {
      const detail = [section.reason, section.error, section.current?.reason, section.current?.error,
        section.forecast?.reason, section.forecast?.error].find(value => typeof value === 'string' && value.trim());
      return `${labels[key] ?? key}: ${detail || 'Required information could not be retrieved.'}`;
    });
  return failures.length ? failures.join(' ') : data.status === 'error' ? 'The Briefing could not be completed.' : null;
}

// Detect whether an aggregate response is "still missing its payload" and should
// trigger a retry. True if: no briefing row yet, or the response is explicitly
// flagged not-generated. Stop only when all seven sections have settled.
function isAggregateLoading(data: BriefingAggregate | undefined): boolean {
  if (!data) return true;
  if (generationFailure(data)) return false;
  if (data._authError || data._ownershipError || data._exhausted) return false;
  if (data._notGenerated) return true;
  const b = data.briefing;
  if (!b) return true;
  if (data._error && data._error >= 400 && data._error < 500) return false;
  if (data.status === 'pending') return true;
  // September 13, 2026: metadata is not readiness. Keep recovering until every
  // required section has settled, including verified-empty and failed sections.
  return [b.weather, b.traffic, b.news, b.events, b.school_closures, b.airport_conditions, b.holiday]
    .some(section => !section || (!section._generationFailed && section._pending === true));
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

  // Successful progress never spends the transport-error budget. Bound stalled
  // ownership by elapsed inactivity instead of the number of SSE notifications.
  const retryCountRef = useRef({ count: 0, snapshotId, token: null as string | null,
    lastProgressAt: Date.now(), progressStamp: '', saved: undefined as BriefingAggregate | undefined });
  if (retryCountRef.current.snapshotId !== snapshotId) {
    retryCountRef.current = { count: 0, snapshotId, token: null,
      lastProgressAt: Date.now(), progressStamp: '', saved: undefined };
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
    queryFn: async ({ signal }): Promise<BriefingAggregate> => {
      const requestToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const isCurrent = () => !signal.aborted && localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === requestToken;
      const staleResponse = (): BriefingAggregate => ({ snapshot_id: snapshotId!, briefing: {} as any,
        created_at: '', updated_at: '', generated_at: '', _authError: true });
      const attemptState = retryCountRef.current;
      if (attemptState.token !== requestToken) {
        Object.assign(attemptState, { count: 0, token: requestToken, lastProgressAt: Date.now(), progressStamp: '', saved: undefined });
      }
      const finishAttempt = (data: BriefingAggregate): BriefingAggregate => {
        if (!isCurrent()) return staleResponse();
        if (data._notGenerated || (data._error != null && data._error >= 500)) {
          attemptState.count++;
          // Keep already received context visible during a read interruption.
          // This saved value belongs only to this request token and snapshot.
          const retained = attemptState.saved ? { ...attemptState.saved, _error: data._error, _notGenerated: data._notGenerated } : data;
          return attemptState.count >= MAX_RETRY_ATTEMPTS ? { ...retained, _exhausted: true } : retained;
        } else if (!data._authError && !data._ownershipError) {
          attemptState.count = 0;
          const progressTime = Date.parse(data.updated_at);
          if (Number.isFinite(progressTime) && (!attemptState.progressStamp || progressTime > Date.parse(attemptState.progressStamp))) {
            attemptState.progressStamp = data.updated_at;
            attemptState.lastProgressAt = Date.now();
          }
          attemptState.saved = data;
          if (isAggregateLoading(data) && Date.now() - attemptState.lastProgressAt >= NO_PROGRESS_TIMEOUT_MS) {
            return { ...data, _exhausted: true };
          }
        }
        return data;
      };
      if (!requestToken) {
        return { snapshot_id: snapshotId!, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _authError: true };
      }
      console.log('[BriefingQuery] 📦 Fetching aggregate briefing for', snapshotId?.slice(0, 8));
      if (!snapshotId) {
        return { snapshot_id: '', briefing: {} as any, created_at: '', updated_at: '', generated_at: '' };
      }
      let response: Response;
      try {
        response = await fetch(API_ROUTES.BRIEFING.AGGREGATE(snapshotId), {
          headers: { Authorization: `Bearer ${requestToken}` }, signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        return finishAttempt({ snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _error: 503 });
      }
      if (signal.aborted || localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== requestToken) {
        return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _authError: true };
      }

      if (!response.ok) {
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            if (!isCurrent()) return staleResponse();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch { if (isCurrent()) dispatchAuthError('unauthorized'); }
          return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (!isCurrent()) return staleResponse();
            if (errorBody?.error === 'snapshot_not_found') {
              console.error('[BriefingQuery] Aggregate 404 - snapshot ownership error');
              dispatchSnapshotOwnershipError(snapshotId ?? undefined);
              return { snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _ownershipError: true };
            }
            // "Briefing not yet generated" — retry expected
            console.log('[BriefingQuery] ⏳ Briefing not yet generated for', snapshotId.slice(0, 8));
            return finishAttempt({ snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _notGenerated: true });
          } catch {
            console.warn('[BriefingQuery] Aggregate 404 - could not parse error body');
          }
        }
        console.error('[BriefingQuery] Aggregate fetch failed:', response.status);
        return finishAttempt({ snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _error: response.status });
      }
      let data: BriefingAggregate;
      try { data = await response.json(); }
      catch (error) {
        if (signal.aborted) throw error;
        return finishAttempt({ snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _error: 502 });
      }
      if (!isCurrent()) return staleResponse();
      if (data?.snapshot_id !== snapshotId || !data?.briefing || typeof data.briefing !== 'object') {
        return finishAttempt({ snapshot_id: snapshotId, briefing: {} as any, created_at: '', updated_at: '', generated_at: '', _error: 502 });
      }
      console.log('[BriefingQuery] ✅ Aggregate received for', snapshotId.slice(0, 8),
        '| weather=', !!data?.briefing?.weather?.current,
        'traffic=', !!data?.briefing?.traffic && Object.keys(data.briefing.traffic).length > 1,
        'events=', data?.briefing?.events?.items?.length ?? 0,
        'news=', data?.briefing?.news?.items?.length ?? 0,
        'airport=', data?.briefing?.airport_conditions?.airports?.length ?? 0,
      );
      return finishAttempt(data);
    },
    enabled: isEnabled,
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
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
        return retryCountRef.current.count ? getBackoffInterval(retryCountRef.current.count) : PROGRESS_POLL_MS;
      }
      return false;
    },
  });

  // Derive per-section data and loading/unavailable flags from the aggregate.
  // Keep the same external shape as the prior six-query API.
  const b = aggregateQuery.data?.briefing;
  const exhausted = !!aggregateQuery.data?._exhausted;
  const generationError = isEnabled && aggregateQuery.data?.snapshot_id === snapshotId
    ? generationFailure(aggregateQuery.data) : null;
  const settled = !!aggregateQuery.data && (aggregateQuery.data._exhausted ||
    (!isAggregateLoading(aggregateQuery.data) && !(aggregateQuery.data._error && aggregateQuery.data._error >= 500)));

  // Saved sources are immutable. Release the stream at success or terminal
  // failure; a different source/session gets its own subscription.
  useEffect(() => {
    if (!snapshotId || !isEnabled || settled) return;
    let active = true;
    const unsubscribe = subscribeBriefingReady(snapshotId, readySnapshotId => {
      if (active && readySnapshotId === snapshotId) {
        void queryClient.refetchQueries({ queryKey: QUERY_KEYS.BRIEFING_AGGREGATE(snapshotId), type: 'active' });
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [snapshotId, queryClient, isEnabled, settled]);
  const refetchAggregate = aggregateQuery.refetch;
  const retryBriefing = useCallback(() => {
    retryCountRef.current.count = 0;
    retryCountRef.current.lastProgressAt = Date.now();
    return refetchAggregate();
  }, [refetchAggregate]);

  // Derived section data — wrapped to match what callers of the old hook expected.
  // 2026-04-19: H3 fix — carry _generationFailed at the outer level so WeatherCard
  // can render a "weather temporarily unavailable" state instead of silently
  // hiding when the weather provider permanently failed.
  // 2026-07-06 (todo #24): _pending flows from the aggregate endpoint (raw
  // column nullness) — pending, failed, and verified-empty are THREE states
  // and must never collapse into "No X found".
  const weatherData = b?.weather
    ? {
        weather: { current: b.weather.current, forecast: b.weather.forecast },
        _pending: !!b.weather._pending,
        _generationFailed: !!b.weather._generationFailed,
        _exhausted: exhausted,
      }
    : undefined;
  const trafficData = b?.traffic
    ? { traffic: b.traffic, _pending: !!b.traffic._pending, _generationFailed: !!b.traffic._generationFailed, _exhausted: exhausted }
    : undefined;
  const newsData = b?.news
    ? { news: { items: b.news.items, reason: b.news.reason }, _pending: !!b.news._pending, _generationFailed: !!b.news._generationFailed, _exhausted: exhausted }
    : undefined;
  const eventsData = b?.events
    ? {
        events: b.events.items,
        marketEvents: b.events.marketEvents,
        market_name: b.events.market_name,
        market_status: b.events.market_status,
        unresolved_market_events: b.events.unresolved_market_events,
        reason: b.events.reason,
        _pending: !!b.events._pending,
        _generationFailed: !!b.events._generationFailed,
        _exhausted: exhausted,
      }
    : undefined;
  const schoolClosuresData = b?.school_closures
    ? { school_closures: b.school_closures.items, reason: b.school_closures.reason, _pending: !!b.school_closures._pending, _generationFailed: !!b.school_closures._generationFailed }
    : undefined;
  const airportData = b?.airport_conditions
    ? { airport_conditions: b.airport_conditions, _pending: !!b.airport_conditions._pending, _generationFailed: !!b.airport_conditions._generationFailed, _exhausted: exhausted }
    : undefined;

  // Per-section loading flags — explicit _pending from the endpoint replaces
  // the old content-shape guessing (which counted fabricated "No X for this
  // area" reasons as data, so pending sections instantly read as loaded-empty).
  const sectionLoading = (section: { _pending?: boolean; _generationFailed?: boolean } | undefined) => {
    if (generationError || section?._generationFailed || exhausted) return false;
    // Whole-Briefing polling continues until every section finishes. A remaining
    // section must not hide another section's already saved progressive result.
    if (aggregateQuery.isLoading || !section) return true;
    return !!section._pending;
  };

  return {
    generationError,
    isRetryExhausted: exhausted,
    isFetching: aggregateQuery.isFetching,
    retryBriefing,
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    isLoading: {
      weather: sectionLoading(b?.weather),
      traffic: sectionLoading(b?.traffic),
      events: sectionLoading(b?.events),
      news: sectionLoading(b?.news),
      airport: sectionLoading(b?.airport_conditions),
      schoolClosures: sectionLoading(b?.school_closures),
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
 * Used by StrategyPage for its active event count, separate from the aggregate.
 */
export function useActiveEventsQuery(snapshotId: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.BRIEFING_EVENTS_ACTIVE(snapshotId!),
    queryFn: async ({ signal }) => {
      const requestToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const isCurrent = () => !signal.aborted && localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === requestToken;
      const staleResponse = () => ({ events: [], _authError: true });
      if (!requestToken) return { events: [] };
      if (!snapshotId) return { events: [] };
      console.log('[BriefingQuery] 🎯 Fetching active events for', snapshotId.slice(0, 8));
      const response = await fetch(API_ROUTES.BRIEFING.EVENTS_ACTIVE(snapshotId), {
        headers: { Authorization: `Bearer ${requestToken}` }, signal,
      });
      if (!isCurrent()) return staleResponse();
      if (!response.ok) {
        if (response.status === 401) {
          try {
            const errorBody = await response.json();
            if (!isCurrent()) return staleResponse();
            dispatchAuthError(errorBody?.error || 'unauthorized');
          } catch { if (isCurrent()) dispatchAuthError('unauthorized'); }
          return { events: [], _authError: true };
        }
        if (response.status === 404) {
          try {
            const errorBody = await response.json();
            if (!isCurrent()) return staleResponse();
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
      if (!isCurrent()) return staleResponse();
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
