// client/src/contexts/co-pilot-context.tsx
// Shared state and queries for all co-pilot pages

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useLocationContext } from '@/contexts/location-context-clean';
import { useAuth } from '@/contexts/auth-context';
import { useRunSetup } from '@/contexts/run-setup-context';
import type { SmartBlock, BlocksResponse, StrategyData, PipelinePhase, PreviousStrategy } from '@/types/co-pilot';
import { subscribeStrategyReady, subscribeBlocksReady, subscribePhaseChange } from '@/utils/co-pilot-helpers';
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useBarsQuery, type BarsData } from '@/hooks/useBarsQuery';
// 2026-01-09: P1-6 - Centralized storage keys (prevents magic string bugs)
// 2026-01-15: Added API_ROUTES and QUERY_KEYS for endpoint/cache consistency
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
// 2026-01-15: FAIL HARD - Critical error component for unrecoverable states
import CriticalError, { type CriticalErrorType } from '@/components/CriticalError';
import { hasStrategySourceTimes } from '@/lib/strategy-source-time';
import type StrategyMap from '@/components/strategy/StrategyMap';

export interface HistoricalStrategyMap {
  sourceSnapshotId: string;
  props: React.ComponentProps<typeof StrategyMap>;
}

// 2026-09-11: Unique only within this running module; no token in cache keys/storage.
let nextStrategySession = 0;

interface CoPilotContextValue {
  // Location (from LocationContext)
  coords: { latitude: number; longitude: number } | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;

  // Authentication failures block the dashboard. Data failures stay local to
  // Strategy so navigation and the last completed guidance remain available.
  criticalError: { type: CriticalErrorType; message?: string; details?: string } | null;
  setCriticalError: (error: { type: CriticalErrorType; message?: string; details?: string } | null) => void;

  // Snapshot lifecycle
  lastSnapshotId: string | null;
  contextSnapshotId: string | null;

  // Strategy
  strategyData: StrategyData | null;
  immediateStrategy: string | null;
  previousStrategy: PreviousStrategy | null;
  previousBlocksData: BlocksResponse | null;
  strategyError: string | null;
  historicalMap: HistoricalStrategyMap | null;
  rememberMap: (map: HistoricalStrategyMap) => void;
  isStrategyFetching: boolean;
  snapshotData: any;

  // Blocks
  blocks: SmartBlock[];
  blocksData: BlocksResponse | null;
  isBlocksLoading: boolean;
  blocksError: Error | null;
  refetchBlocks: () => void;

  // Progress
  enrichmentProgress: number;
  strategyProgress: number;
  enrichmentPhase: 'idle' | 'strategy' | 'blocks';  // High-level phase for UI progress bars
  pipelinePhase: PipelinePhase;                      // Detailed pipeline phase for messages
  timeRemainingText: string | null;

  // Pre-loaded briefing data (fetched as soon as snapshot is available)
  briefingData: ReturnType<typeof useBriefingQueries>;

  // Pre-loaded bars data (fetched as soon as location resolves)
  barsData: BarsData | null;
  isBarsLoading: boolean;
  refetchBars: () => void;
}

const CoPilotContext = createContext<CoPilotContextValue | null>(null);

export function useCoPilot() {
  const context = useContext(CoPilotContext);
  if (!context) {
    throw new Error('useCoPilot must be used within a CoPilotProvider');
  }
  return context;
}

export function CoPilotProvider({ children, allowPartialCoach = false, allowPartialBriefing = false }: {
  children: React.ReactNode; allowPartialCoach?: boolean; allowPartialBriefing?: boolean;
}) {
  const { run, setup } = useRunSetup();
  const runRef = useRef(run);
  runRef.current = run;
  const locationContext = useLocationContext();
  const queryClient = useQueryClient();
  // 2026-04-05: Gate all queries on auth state — stop polling after logout
  const { isAuthenticated, user, token, sessionId } = useAuth();
  const ownerId = user?.userId ?? null;
  const authScope = useMemo(() => isAuthenticated && ownerId && token
    ? { ownerId, token, revision: ++nextStrategySession }
    : null, [isAuthenticated, ownerId, token]);
  const authScopeRef = useRef(authScope);
  authScopeRef.current = authScope;
  const [completedStrategy, setCompletedStrategy] = useState<{
    scope: NonNullable<typeof authScope>; record: PreviousStrategy;
  } | null>(null);
  const completedStrategyRef = useRef(completedStrategy);
  completedStrategyRef.current = completedStrategy;
  // Render-time comparison closes the frame before auth cleanup effects run.
  const previousStrategy = authScope && completedStrategy?.scope === authScope
    ? completedStrategy.record : null;
  const [mapHistory, setMapHistory] = useState<{ scope: typeof authScope; map: HistoricalStrategyMap } | null>(null);
  const historicalMap = authScope && mapHistory?.scope === authScope ? mapHistory.map : null;
  const rememberMap = React.useCallback((map: HistoricalStrategyMap) => {
    const scope = authScopeRef.current;
    if (!scope) return;
    setMapHistory(previous => previous?.scope === scope && JSON.stringify(previous.map) === JSON.stringify(map)
      ? previous : { scope, map });
  }, []);

  // Retain scoped failure details for Strategy; only auth failures unmount it.
  const [criticalErrorState, setCriticalErrorState] = useState<{
    scope: typeof authScope; error: CoPilotContextValue['criticalError'];
  } | null>(null);
  // Error details are also account/session data: hide them before cleanup effects.
  const savedCriticalError = authScope && criticalErrorState?.scope === authScope ? criticalErrorState.error : null;
  const setCriticalError = React.useCallback((error: CoPilotContextValue['criticalError']) => {
    setCriticalErrorState(error ? { scope: authScopeRef.current, error } : null);
  }, []);

  // An admitted snapshot is the downstream identity. Newly captured upstream
  // context may refresh Briefing/Bars without replacing the driver's Strategy.
  const lastSnapshotId = authScope && run?.snapshotId ? run.snapshotId : null;
  const contextSnapshotId = authScope ? locationContext.lastSnapshotId : null;
  const briefingQueries = useBriefingQueries({
    snapshotId: contextSnapshotId,
    isAuthenticated,
  });
  const generationError = briefingQueries.generationError;
  const criticalError = useMemo(() => savedCriticalError?.type === 'auth_failed' ? savedCriticalError
    : generationError ? { type: 'briefing_failed' as const, details: generationError } : savedCriticalError,
  [savedCriticalError, generationError]);
  useEffect(() => {
    if (!authScope || !contextSnapshotId || !generationError) return;
    window.dispatchEvent(new CustomEvent('vecto-briefing-failed', { detail: {
      snapshotId: contextSnapshotId, ownerId: authScope.ownerId, sessionId: sessionId ?? setup?.sessionId ?? null,
      message: generationError,
    } }));
  }, [authScope, contextSnapshotId, generationError, sessionId, setup?.sessionId]);
  const [completedVenues, setCompletedVenues] = useState<{
    scope: NonNullable<typeof authScope>; snapshotId: string; data: BlocksResponse;
  } | null>(null);
  const [generationFailure, setGenerationFailure] = useState<{
    scope: typeof authScope; runId: string; message: string;
  } | null>(null);
  const strategyError = authScope && generationFailure?.scope === authScope && generationFailure.runId === run?.runId
    ? generationFailure.message : criticalError?.details ?? criticalError?.message ?? null;

  // Enriched reasonings for closed venues
  const [enrichedReasonings, _setEnrichedReasonings] = useState<Map<string, string>>(new Map());

  // Ref to track polling status
  const _lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');

  // DEDUPLICATION: Track which snapshot IDs have already triggered /api/blocks-fast
  // Prevents duplicate pipeline runs when both useEffect AND event handler fire
  const waterfallTriggeredRef = useRef<Set<string>>(new Set());

  // 2026-04-10: AbortController for in-flight waterfall POST — aborted on logout (Window 3 race fix)
  const waterfallAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    waterfallAbortRef.current?.abort();
    setGenerationFailure(null);
    setCriticalError(null);
  }, [run?.runId, setCriticalError]);

  const prevAuthRef = useRef(authScope);
  useEffect(() => {
    if (prevAuthRef.current !== authScope) {
      setCriticalError(null);
      setCompletedStrategy(null);
      setCompletedVenues(null);
      setMapHistory(null);
      setGenerationFailure(null);
      waterfallTriggeredRef.current.clear();
      waterfallAbortRef.current?.abort();
      waterfallAbortRef.current = null;
    }
    prevAuthRef.current = authScope;
    return () => { waterfallAbortRef.current?.abort(); };
  }, [authScope, setCriticalError]);

  // Get coords from location context
  const gpsCoords = locationContext?.currentCoords;
  const overrideCoords = locationContext?.overrideCoords;
  const coords = overrideCoords || gpsCoords;

  // Admission hydration and location events are read-only. Only a confirmed
  // explicit action emits this event and starts Strategy plus venue generation.
  useEffect(() => {
    const handleStart = async (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const admitted = runRef.current;
      const scope = authScopeRef.current;
      if (!scope || !admitted || detail?.runId !== admitted.runId || detail?.snapshotId !== admitted.snapshotId) return;
      const snapshotId = admitted.snapshotId;
      if (!snapshotId || waterfallTriggeredRef.current.has(snapshotId)) return;
      waterfallTriggeredRef.current.add(snapshotId);
      waterfallAbortRef.current?.abort();
      const controller = new AbortController();
      waterfallAbortRef.current = controller;
      const current = () => !controller.signal.aborted && authScopeRef.current === scope && runRef.current?.runId === admitted.runId;
      try {
        const response = await fetch(API_ROUTES.BLOCKS.FAST, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${scope.token}` },
          body: JSON.stringify({ snapshotId, runId: admitted.runId }), signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!current()) return;
        if (!response.ok) {
          setGenerationFailure({ scope, runId: admitted.runId,
            message: body.message || 'Strategy could not be refreshed. Your previous strategy is still available.' });
        }
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(snapshotId), type: 'active' });
      } catch (error) {
        if (!current()) return;
        setGenerationFailure({ scope, runId: admitted.runId,
          message: error instanceof Error ? error.message : 'Strategy refresh was not confirmed. Please retry.' });
      }
    };
    window.addEventListener('vecto-strategy-started', handleStart);
    return () => window.removeEventListener('vecto-strategy-started', handleStart);
  }, [queryClient]);

  // Subscribe to SSE strategy_ready events
  // LESSON LEARNED (Dec 2025): Use refetchQueries instead of invalidateQueries!
  // invalidateQueries clears cache immediately → isLoading=true → UI shows loading state → FLASH
  // refetchQueries fetches in background → isFetching=true but isLoading stays false → smooth transition
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    // 2026-04-18 (F2): Pass lastSnapshotId so the server emits an initial `state`
    // event on connect (NOTIFY_LOSS_RECON_2026-04-18.md handshake fix).
    const unsubscribe = subscribeStrategyReady(lastSnapshotId, (readySnapshotId) => {
      if (readySnapshotId === lastSnapshotId) {
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId), type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE blocks_ready events
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    // 2026-04-18 (F2): Pass lastSnapshotId for the initial-state handshake.
    const unsubscribe = subscribeBlocksReady(lastSnapshotId, (data) => {
      if (data.snapshot_id === lastSnapshotId) {
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId), type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE phase_change events for real-time progress bar updates
  // LESSON LEARNED: Without this, progress bar only updates via 3-second polling,
  // which is too slow to track rapid phase transitions (the bar "jumps" or "sticks")
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribePhaseChange(lastSnapshotId, (data) => {
      if (data.snapshot_id === lastSnapshotId) {
        // Use refetchQueries to get fresh phase/timing data without clearing cache (prevents flash)
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId), type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Fetch snapshot data
  // 2026-01-15: Using centralized API_ROUTES and QUERY_KEYS for consistency
  // 2026-01-15: FAIL HARD - Set critical error if snapshot fetch fails with 4xx/5xx
  const { data: snapshotData, error: snapshotError } = useQuery({
    queryKey: [...QUERY_KEYS.SNAPSHOT(lastSnapshotId), authScope?.ownerId, authScope?.revision],
    queryFn: async ({ signal }) => {
      if (!authScope || !lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      const response = await fetch(API_ROUTES.SNAPSHOT.GET(lastSnapshotId), {
        headers: { Authorization: `Bearer ${authScope.token}` }, signal,
      });
      if (signal.aborted || authScopeRef.current !== authScope) return null;
      if (!response.ok) {
        // 2026-01-15: FAIL HARD - Don't silently return null, throw so react-query catches it
        const errorData = await response.json().catch(() => ({}));
        if (signal.aborted || authScopeRef.current !== authScope) return null;
        const error = new Error(errorData.error || `Snapshot fetch failed: ${response.status}`);
        (error as any).code = errorData.error;
        (error as any).details = errorData.message;
        throw error;
      }
      const data = await response.json();
      if (signal.aborted || authScopeRef.current !== authScope) return null;
      // 2026-01-15: FAIL HARD - Validate critical fields exist
      if (!data.city || !data.timezone) {
        const error = new Error('Snapshot data incomplete: missing city or timezone');
        (error as any).code = 'SNAPSHOT_INCOMPLETE';
        throw error;
      }
      return data;
    },
    // 2026-04-05: Gate on isAuthenticated to prevent polling after logout
    enabled: !!authScope && !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: (failureCount, error: any) => {
      // Don't retry on 4xx errors (client-side issues)
      if (error?.code === 'SNAPSHOT_NOT_FOUND' || error?.code === 'SNAPSHOT_INCOMPLETE') {
        return false;
      }
      return failureCount < 2;
    },
  });

  // 2026-01-15: FAIL HARD - Detect snapshot errors and trigger critical error
  useEffect(() => {
    if (snapshotError && lastSnapshotId && lastSnapshotId !== 'live-snapshot') {
      const err = snapshotError as any;
      console.error('[CoPilotContext] ❌ CRITICAL: Snapshot fetch failed:', err.message);
      setCriticalError({
        type: err.code === 'SNAPSHOT_INCOMPLETE' ? 'snapshot_incomplete' : 'snapshot_missing',
        message: err.message,
        details: `Snapshot ID: ${lastSnapshotId.slice(0, 8)}... | ${err.details || ''}`
      });
    }
  }, [snapshotError, lastSnapshotId]);

  // Fetch strategy
  // 2026-01-15: Using centralized API_ROUTES and QUERY_KEYS for consistency
  const { data: strategyResponse, isFetching: isStrategyFetching, error: strategyQueryError, refetch: refetchBlocks } = useQuery({
    queryKey: [...QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId), authScope?.ownerId, authScope?.revision],
    queryFn: async ({ signal }) => {
      if (!authScope || !lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      const response = await fetch(API_ROUTES.BLOCKS.STRATEGY(lastSnapshotId), {
        headers: { Authorization: `Bearer ${authScope.token}` }, signal,
      });
      if (signal.aborted || authScopeRef.current !== authScope) return null;
      if (!response.ok) throw new Error('Your saved Strategy could not be loaded. Please retry.');
      const data = await response.json();
      if (signal.aborted || authScopeRef.current !== authScope) return null;
      const choices = queryClient.getQueryData<{
        snapshotId?: string; rankingId?: string; blocks?: SmartBlock[]; venueFeedbackRevision?: number;
      }>([...QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId), authScope.ownerId, authScope.revision]);
      const confirmedChoices = choices?.snapshotId === data.snapshotId && choices?.rankingId === data.rankingId &&
        (choices?.venueFeedbackRevision ?? 0) > 0;
      const serverRevision = Number.isInteger(data.scope_revision) ? data.scope_revision : null;
      const keepConfirmedChoices = confirmedChoices && (serverRevision === null || serverRevision < choices!.venueFeedbackRevision!);
      return { ...data, ...(keepConfirmedChoices ? { blocks: choices!.blocks, venueFeedbackRevision: choices!.venueFeedbackRevision }
        : serverRevision !== null ? { venueFeedbackRevision: serverRevision } : {}),
        _snapshotId: lastSnapshotId, _sessionRevision: authScope.revision };
    },
    // 2026-04-05: Gate on isAuthenticated — this is the 3-second poller that spams after logout
    enabled: !!authScope && !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'error') return false;
      if (status === 'ok' && query.state.data?.briefingStatus === 'complete' &&
        query.state.data?.strategyFresh !== false && query.state.data?.snapshotId === lastSnapshotId &&
        hasStrategySourceTimes(query.state.data)) return false;
      return 3000;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // 2026-09-11: A query key identifies a request, not the server's response.
  // Require both snapshot IDs and the private session revision before using text.
  const responseMatches = !!authScope && !!lastSnapshotId &&
    strategyResponse?._sessionRevision === authScope.revision &&
    strategyResponse?._snapshotId === lastSnapshotId && strategyResponse?.snapshotId === lastSnapshotId;
  const strategyReady = responseMatches && hasStrategySourceTimes(strategyResponse) && strategyResponse?.briefingStatus === 'complete' &&
    strategyResponse?.strategyFresh !== false &&
    (strategyResponse?.status === 'ok' || strategyResponse?.status === 'pending_blocks');
  const immediateStrategy = strategyReady && typeof strategyResponse?.strategy?.strategyForNow === 'string' &&
    strategyResponse.strategy.strategyForNow.trim() ? strategyResponse.strategy.strategyForNow : null;
  // Progress/failure metadata remains current; retained server text cannot leak
  // through another consumer while its Briefing is pending or known stale.
  const strategyData = useMemo(() => responseMatches
    ? (strategyReady ? strategyResponse : { ...strategyResponse, strategy: undefined })
    : null, [responseMatches, strategyReady, strategyResponse]);

  useEffect(() => {
    if (strategyReady && strategyData?.status === 'ok') {
      setGenerationFailure(null);
      setCriticalError(null);
    }
    if (strategyData?.status === 'error') {
      setCriticalError({
        type: strategyData.error === 'briefing_failed' ? 'briefing_failed' : 'unknown',
        details: strategyData.message || 'Strategy generation failed. Please retry.',
      });
    }
  }, [strategyReady, strategyData]);

  useEffect(() => {
    if (!authScope || !lastSnapshotId || !immediateStrategy || strategyData?.status !== 'ok') return;
    setCompletedStrategy(previous => {
      const city = typeof snapshotData?.city === 'string' ? snapshotData.city : null;
      const timezone = typeof snapshotData?.timezone === 'string' ? snapshotData.timezone : null;
      const sourceUpdatedAt = strategyData.strategyUpdatedAt ?? null;
      const snapshotCreatedAt = strategyData.snapshotCreatedAt ?? null;
      if (previous?.scope === authScope && previous.record.sourceSnapshotId === lastSnapshotId &&
        previous.record.text === immediateStrategy) {
        // The owned snapshot GET may finish after Strategy. Fill absent metadata
        // from that same snapshot, preserving receipt time and known source fields.
        if ((previous.record.city !== null || city === null) &&
          (previous.record.timezone !== null || timezone === null) &&
          previous.record.sourceUpdatedAt === sourceUpdatedAt && previous.record.snapshotCreatedAt === snapshotCreatedAt) return previous;
        return { scope: authScope, record: {
          ...previous.record, city: previous.record.city ?? city, timezone: previous.record.timezone ?? timezone,
          sourceUpdatedAt, snapshotCreatedAt,
        } };
      }
      return { scope: authScope, record: {
        ownerId: authScope.ownerId, sourceSnapshotId: lastSnapshotId, text: immediateStrategy,
        receivedAt: new Date().toISOString(),
        sourceUpdatedAt, snapshotCreatedAt,
        city, timezone,
      } };
    });
  }, [authScope, lastSnapshotId, immediateStrategy, strategyData?.status, strategyData?.strategyUpdatedAt, strategyData?.snapshotCreatedAt, snapshotData?.city, snapshotData?.timezone]);

  // Polling returns the saved ranking. GET blocks-fast can generate missing
  // venues, so it must not be called by remount, focus or background polling.
  const blocksData: BlocksResponse | null = useMemo(() => {
    if (!strategyReady || !strategyResponse) return null;
    const savedBlocks = Array.isArray(strategyResponse.blocks) ? strategyResponse.blocks : [];
    if (savedBlocks.length && !strategyResponse.rankingId) return null;
    return {
      now: strategyResponse.strategyUpdatedAt,
      timezone: snapshotData?.timezone ?? null,
      strategy: immediateStrategy ?? undefined,
      blocks: savedBlocks,
      rankingId: strategyResponse.rankingId,
      isBlocksGenerating: strategyResponse.status === 'pending_blocks',
    };
  }, [strategyReady, strategyResponse, snapshotData?.timezone, immediateStrategy]);
  const blocksError = useMemo(() => strategyQueryError ?? (strategyReady && strategyResponse?.blocks?.length && !strategyResponse.rankingId
    ? Object.assign(new Error('Saved venues are missing their ranking identifier.'), { code: 'RANKING_ID_MISSING' }) : null),
  [strategyQueryError, strategyReady, strategyResponse]);
  const isBlocksLoading = !!lastSnapshotId && !strategyError && strategyResponse?.status !== 'error' &&
    (!strategyReady || strategyResponse?.status === 'pending_blocks');
  useEffect(() => {
    if (!authScope || !lastSnapshotId || strategyData?.status !== 'ok' || !blocksData || blocksError) return;
    setCompletedVenues(previous => previous?.scope === authScope && previous.snapshotId === lastSnapshotId &&
      JSON.stringify(previous.data) === JSON.stringify(blocksData) ? previous : { scope: authScope, snapshotId: lastSnapshotId, data: blocksData });
  }, [authScope, lastSnapshotId, strategyData?.status, blocksData, blocksError]);

  // A mobile browser can remount while a replacement is still pending. The
  // server identifies prior completed work in this live session; read it back
  // without recapturing location or giving it current generation authority.
  const priorRun = setup?.previousRun;
  const currentCompleteRef = useRef(false);
  currentCompleteRef.current = strategyReady && strategyData?.status === 'ok';
  useEffect(() => {
    if (!authScope || !priorRun?.snapshotId || priorRun.sessionId !== setup?.sessionId ||
        priorRun.snapshotId === lastSnapshotId || currentCompleteRef.current || completedStrategy?.scope === authScope) return;
    const scope = authScope;
    const snapshotId = priorRun.snapshotId;
    const currentRunId = run?.runId ?? null;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && authScopeRef.current === scope &&
      (runRef.current?.runId ?? null) === currentRunId && !currentCompleteRef.current &&
      completedStrategyRef.current?.scope !== scope;
    const restore = async () => {
      try {
        const options = { headers: { Authorization: `Bearer ${scope.token}` }, signal: controller.signal, cache: 'no-store' as const };
        const [strategyResponse, snapshotResponse] = await Promise.all([
          fetch(API_ROUTES.BLOCKS.STRATEGY(snapshotId), options),
          fetch(API_ROUTES.SNAPSHOT.GET(snapshotId), options),
        ]);
        if (!current() || !strategyResponse.ok || !snapshotResponse.ok) return;
        const [history, snapshot] = await Promise.all([strategyResponse.json(), snapshotResponse.json()]);
        if (!current() || history.snapshotId !== snapshotId || snapshot.snapshot_id !== snapshotId ||
            history.status !== 'ok' || history.briefingStatus !== 'complete' || history.strategyFresh === false ||
            !hasStrategySourceTimes(history) || snapshot.status !== 'ok' ||
            typeof history.strategy?.strategyForNow !== 'string' || !history.strategy.strategyForNow.trim() ||
            !Number.isFinite(snapshot.lat) || Math.abs(snapshot.lat) > 90 || !Number.isFinite(snapshot.lng) || Math.abs(snapshot.lng) > 180 ||
            typeof snapshot.city !== 'string' || !snapshot.city || typeof snapshot.timezone !== 'string' || !snapshot.timezone ||
            Date.parse(snapshot.created_at) !== Date.parse(history.snapshotCreatedAt) || !Array.isArray(history.blocks) ||
            (history.blocks.length && !history.rankingId) || history.blocks.some((block: SmartBlock) =>
              typeof block.name !== 'string' || !Number.isFinite(block.coordinates?.lat) || Math.abs(block.coordinates.lat) > 90 ||
              !Number.isFinite(block.coordinates?.lng) || Math.abs(block.coordinates.lng) > 180)) return;
        setCompletedStrategy(previous => previous?.scope === scope ? previous : { scope, record: {
          ownerId: scope.ownerId, sourceSnapshotId: snapshotId, text: history.strategy.strategyForNow,
          // This is the new read receipt, never the source's generation time.
          receivedAt: new Date().toISOString(), sourceUpdatedAt: history.strategyUpdatedAt,
          snapshotCreatedAt: history.snapshotCreatedAt, city: snapshot.city, timezone: snapshot.timezone,
        } });
        setCompletedVenues(previous => previous?.scope === scope ? previous : { scope, snapshotId, data: {
          now: history.strategyUpdatedAt, timezone: snapshot.timezone, strategy: history.strategy.strategyForNow,
          blocks: history.blocks, rankingId: history.rankingId, isBlocksGenerating: false,
        } });
        setMapHistory(previous => previous?.scope === scope ? previous : { scope, map: { sourceSnapshotId: snapshotId, props: {
          driverLat: snapshot.lat, driverLng: snapshot.lng,
          venues: history.blocks.map((block: SmartBlock, index: number) => ({
            id: block.placeId || `${index}`, name: block.name, lat: block.coordinates.lat, lng: block.coordinates.lng,
            distance_miles: block.estimatedDistanceMiles, drive_time_min: block.driveTimeMinutes,
            est_earnings_per_ride: block.estimatedEarningsPerRide ?? block.estimatedEarnings ?? undefined,
            rank: index + 1, value_grade: block.valueGrade,
          })), bars: [], events: [], incidents: [], snapshotId, timezone: snapshot.timezone, isLoading: false,
        } } });
      } catch { /* A failed history read never restarts the waterfall. */ }
    };
    void restore();
    return () => controller.abort();
  }, [authScope, priorRun?.snapshotId, priorRun?.sessionId, setup?.sessionId, lastSnapshotId, run?.runId, completedStrategy?.scope]);
  const previousBlocksData = authScope && completedVenues?.scope === authScope &&
    (!strategyReady || completedVenues.snapshotId !== lastSnapshotId) ? completedVenues.data : null;

  // 2026-01-15: FAIL HARD - Detect blocks errors and trigger critical error
  useEffect(() => {
    if (strategyReady && blocksError) {
      const err = blocksError as any;
      // Only trigger critical error for specific error codes
      if (err.code === 'RANKING_ID_MISSING') {
        console.error('[CoPilotContext] ❌ CRITICAL: Blocks returned without ranking_id');
        setCriticalError({
          type: 'unknown', // No specific type for this yet
          message: 'Venue data is corrupted: missing ranking identifier.',
          details: err.message
        });
      }
      // Other block errors (timeout, network) should show toast, not critical error
    }
  }, [strategyReady, blocksError, setCriticalError]);

  // 2026-01-06: CRITICAL FIX - Memoize blocks to prevent infinite re-render loop
  // Without useMemo, .map() creates a new array reference on every render.
  // Since `blocks` is in the context useMemo deps, this caused:
  // render → new blocks array → useMemo recalc → new context → consumer re-render → infinite loop
  // 2026-01-14: Server uses toApiBlock (camelCase) - simplified check
  const blocks = useMemo(() => {
    return (blocksData?.blocks || []).map(block => {
      // 2026-01-14: toApiBlock outputs camelCase only - no snake_case fallback needed
      if (block.isOpen === false && !block.closedVenueReasoning) {
        const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
        const reasoning = enrichedReasonings.get(key);
        if (reasoning) {
          // Always return camelCase to match types
          return { ...block, closedVenueReasoning: reasoning };
        }
      }
      return block;
    });
  }, [blocksData?.blocks, enrichedReasonings]);

  // Enrichment progress
  const hasBlocks = blocks.length > 0;
  // 2026-01-07: FIX - Pass coords directly instead of creating new object
  // Creating { latitude: coords.latitude, longitude: coords.longitude } inline
  // causes new object reference on every render → infinite loop in useEnrichmentProgress
  const { progress: enrichmentProgress, strategyProgress, phase: enrichmentPhase, pipelinePhase, timeRemainingText } = useEnrichmentProgress({
    coords,
    strategyData: strategyData as StrategyData | null,
    lastSnapshotId,
    hasBlocks
  });

  // Pre-load briefing data as soon as snapshot is available
  // This ensures briefing tab has data before user navigates there
  const {
    isRetryExhausted,
    isFetching: isBriefingFetching,
    retryBriefing,
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    isLoading: briefingIsLoading,
    isUnavailable: briefingIsUnavailable
  } = briefingQueries;

  // Pre-load bars data as soon as location resolves (no snapshot needed)
  // This ensures bars tab has data before user navigates there
  const {
    barsData,
    isBarsLoading,
    refetchBars
  } = useBarsQuery({
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    city: locationContext?.city || null,
    state: locationContext?.state || null,
    timezone: locationContext?.timeZone || null,
    isLocationResolved: locationContext?.isLocationResolved || false
  });

  // LESSON LEARNED (Dec 2025): Context value MUST be memoized to prevent re-render cascade.
  // Without useMemo, every render creates a new object → all children re-render → flashing UI.
  // NOTE: refetchBlocks and refetchBars are STABLE refs from useQuery, so they're NOT in deps.
  // 2026-01-15: FAIL HARD - Callback to clear critical error (for retry functionality)
  const handleClearError = React.useCallback(async () => {
    setCriticalError(null);
    // Also clear related state to allow fresh retry
    queryClient.resetQueries({ queryKey: QUERY_KEYS.SNAPSHOT(lastSnapshotId) });
    if (criticalError?.type === 'briefing_failed') {
      try {
        await locationContext.refreshGPS();
      } catch {
        if (authScopeRef.current !== authScope) return;
        setCriticalError({ type: 'location_failed', details: 'Could not refresh location for a new Briefing. Please retry.' });
      }
    }
  }, [authScope, lastSnapshotId, queryClient, criticalError?.type, locationContext.refreshGPS, setCriticalError]);

  const value: CoPilotContextValue = useMemo(() => ({
    // Location
    coords,
    city: locationContext?.city || null,
    state: locationContext?.state || null,
    timezone: locationContext?.timeZone || null,
    isLocationResolved: locationContext?.isLocationResolved || false,

    // 2026-01-15: FAIL HARD - Critical error state
    criticalError,
    setCriticalError,

    // Snapshot
    lastSnapshotId,
    contextSnapshotId,

    // Strategy
    strategyData: strategyData as StrategyData | null,
    immediateStrategy,
    previousStrategy,
    previousBlocksData,
    strategyError,
    historicalMap,
    rememberMap,
    isStrategyFetching,
    snapshotData,

    // Blocks
    blocks,
    blocksData: blocksData || null,
    isBlocksLoading,
    blocksError: blocksError as Error | null,
    refetchBlocks,

    // Progress
    enrichmentProgress,
    strategyProgress,
    enrichmentPhase,
    pipelinePhase: pipelinePhase as PipelinePhase,
    timeRemainingText,

    // Keep the hook's section envelopes intact so pending/failure flags and
    // provider reasons reach the cards without another mapping contract.
    briefingData: {
      generationError,
      isRetryExhausted,
      isFetching: isBriefingFetching,
      retryBriefing,
      weatherData,
      trafficData,
      newsData,
      eventsData,
      schoolClosuresData,
      airportData,
      isLoading: briefingIsLoading,
      isUnavailable: briefingIsUnavailable,
    },

    // Pre-loaded bars data
    barsData,
    isBarsLoading,
    refetchBars,
  }), [
    // Primitive/object deps only - NO function refs (they're stable from useQuery)
    coords,
    locationContext?.city,
    locationContext?.state,
    locationContext?.timeZone,
    locationContext?.isLocationResolved,
    // 2026-01-15: FAIL HARD - Critical error state
    criticalError,
    // setCriticalError is stable (useState setter), no need in deps
    lastSnapshotId,
    contextSnapshotId,
    strategyData,
    immediateStrategy,
    previousStrategy,
    previousBlocksData,
    strategyError,
    historicalMap,
    rememberMap,
    isStrategyFetching,
    snapshotData,
    blocks,
    blocksData,
    isBlocksLoading,
    blocksError,
    enrichmentProgress,
    strategyProgress,
    enrichmentPhase,
    pipelinePhase,
    timeRemainingText,
    isRetryExhausted,
    generationError,
    isBriefingFetching,
    retryBriefing,
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    briefingIsLoading,
    briefingIsUnavailable,
    barsData,
    isBarsLoading,
    // refetchBlocks and refetchBars are EXCLUDED - they're stable refs from useQuery
  ]);

  // A first failed Briefing is terminal before a Strategy can be admitted.
  // Preserve completed guidance and allow inspection of collected Briefing data.
  if (criticalError?.type === 'auth_failed' ||
      (criticalError?.type === 'briefing_failed' && !previousStrategy && !allowPartialCoach && !allowPartialBriefing)) {
    return (
      <CoPilotContext.Provider value={value}>
        <CriticalError
          type={criticalError.type}
          message={criticalError.message}
          details={criticalError.details}
          onRetry={handleClearError}
        />
      </CoPilotContext.Provider>
    );
  }

  return (
    <CoPilotContext.Provider value={value}>
      {children}
    </CoPilotContext.Provider>
  );
}
