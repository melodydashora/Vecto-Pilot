// client/src/contexts/co-pilot-context.tsx
// Shared state and queries for all co-pilot pages

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useLocationContext } from '@/contexts/location-context-clean';
import { useAuth } from '@/contexts/auth-context';
import type { SmartBlock, BlocksResponse, StrategyData, PipelinePhase } from '@/types/co-pilot';
import { getAuthHeader, subscribeStrategyReady, subscribeBlocksReady, subscribePhaseChange } from '@/utils/co-pilot-helpers';
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useBarsQuery, type BarsData } from '@/hooks/useBarsQuery';
// 2026-01-09: P1-6 - Centralized storage keys (prevents magic string bugs)
// 2026-01-15: Added API_ROUTES and QUERY_KEYS for endpoint/cache consistency
import { STORAGE_KEYS, SESSION_KEYS } from '@/constants';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
// 2026-01-15: FAIL HARD - Critical error component for unrecoverable states
import CriticalError, { type CriticalErrorType } from '@/components/CriticalError';

interface CoPilotContextValue {
  // Location (from LocationContext)
  coords: { latitude: number; longitude: number } | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;

  // 2026-01-15: FAIL HARD - Critical error state
  // When set, the dashboard should be unmounted and CriticalError shown
  criticalError: { type: CriticalErrorType; message?: string; details?: string } | null;
  setCriticalError: (error: { type: CriticalErrorType; message?: string; details?: string } | null) => void;

  // Snapshot lifecycle
  lastSnapshotId: string | null;

  // Strategy
  strategyData: StrategyData | null;
  immediateStrategy: string | null;
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
  briefingData: {
    weather: any;
    traffic: any;
    news: any;
    events: any;
    marketEvents: any;
    schoolClosures: any;
    airport: any;
    isLoading: {
      weather: boolean;
      traffic: boolean;
      events: boolean;
      news: boolean;
      airport: boolean;
      schoolClosures: boolean;
    };
    // 2026-04-05: Retries exhausted — data permanently unavailable for this snapshot
    isUnavailable?: {
      traffic: boolean;
      events: boolean;
      news: boolean;
      airport: boolean;
    };
  };

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

export function CoPilotProvider({ children }: { children: React.ReactNode }) {
  const locationContext = useLocationContext();
  const queryClient = useQueryClient();
  // 2026-04-05: Gate all queries on auth state — stop polling after logout
  const { isAuthenticated } = useAuth();

  // 2026-01-15: FAIL HARD - Critical error state
  // When set, the entire dashboard unmounts and CriticalError is shown
  const [criticalError, setCriticalError] = useState<{
    type: CriticalErrorType;
    message?: string;
    details?: string;
  } | null>(null);

  // Snapshot state
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  // Track which snapshot the current strategy belongs to (for future refresh optimization)
  const [_strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);

  const [immediateStrategy, setImmediateStrategy] = useState<string | null>(null);

  // Enriched reasonings for closed venues
  const [enrichedReasonings, _setEnrichedReasonings] = useState<Map<string, string>>(new Map());

  // Ref to track polling status
  const _lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');

  // DEDUPLICATION: Track which snapshot IDs have already triggered /api/blocks-fast
  // Prevents duplicate pipeline runs when both useEffect AND event handler fire
  const waterfallTriggeredRef = useRef<Set<string>>(new Set());

  // 2026-04-10: AbortController for in-flight waterfall POST — aborted on logout (Window 3 race fix)
  const waterfallAbortRef = useRef<AbortController | null>(null);

  // 2026-01-07: Flag to prevent race condition during manual refresh
  // When refresh clicked, we clear lastSnapshotId, but locationContext still has old value
  // Without this flag, useEffect would immediately restore the old snapshotId
  const manualRefreshInProgressRef = useRef<boolean>(false);

  // 2026-04-14: Phase 4 — Snapshot hard-fail block. Set to the failed snapshotId when
  // server returns 503 (snapshot_incomplete after MAX retries). Cleared when a NEW
  // snapshot_id arrives or the user triggers manual refresh. Prevents endless retries
  // against a snapshot we already know to be unrecoverable.
  const snapshotHardFailRef = useRef<string | null>(null);

  // 2026-04-05: Clear snapshot on logout so all queries stop (refetchInterval included)
  // Without this, strategy query keeps polling with refetchInterval: 3000 after logout
  // because lastSnapshotId is still set and `enabled` is true.
  const prevAuthRef = useRef(isAuthenticated);
  useEffect(() => {
    if (prevAuthRef.current && !isAuthenticated) {
      // User just logged out
      console.log('[CoPilotContext] Auth lost — clearing snapshot and stopping queries');
      setLastSnapshotId(null);
      // 2026-04-27: setPersistentStrategy removed — state was deleted in a prior
      // refactor but the setter call sites were missed, causing a ReferenceError
      // that the (now instrumented) ErrorBoundary surfaced. localStorage cleanup
      // for the persistent-strategy slot still happens via STORAGE_KEYS.
      setImmediateStrategy(null);
      waterfallTriggeredRef.current.clear();
      // 2026-04-10: Abort any in-flight waterfall POST (Window 3 race fix)
      if (waterfallAbortRef.current) {
        waterfallAbortRef.current.abort();
        waterfallAbortRef.current = null;
      }
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Get coords from location context
  const gpsCoords = locationContext?.currentCoords;
  const overrideCoords = locationContext?.overrideCoords;
  const coords = overrideCoords || gpsCoords;

  // 2026-01-06: P3-D - Check if this is a resume (skip blocks-fast regeneration)
  // Resume mode is set by LocationContext when restoring from sessionStorage
  const checkAndClearResumeMode = (): boolean => {
    const reason = sessionStorage.getItem(SESSION_KEYS.RESUME_REASON);
    if (reason === 'resume') {
      sessionStorage.removeItem(SESSION_KEYS.RESUME_REASON);
      return true;
    }
    return false;
  };

  // Fallback: If location context has a snapshot ID and we don't, use it
  useEffect(() => {
    const contextSnapshotId = locationContext?.lastSnapshotId;

    // 2026-01-07: Skip if manual refresh in progress - we just cleared lastSnapshotId
    // and we're waiting for location-context to create a NEW snapshot
    if (manualRefreshInProgressRef.current) {
      console.log("⏳ CoPilotContext: Manual refresh in progress - ignoring old snapshotId from context");
      return;
    }

    // 2026-04-10: FIX — Never sync snapshot when logged out (zombie snapshot fix).
    // After logout, LocationContext may briefly still hold the old snapshotId
    // (before its own auth-drop cleanup runs). Without this guard, the sync
    // restores the dead snapshot 1ms after the auth-drop effect clears it.
    if (!isAuthenticated) return;

    if (contextSnapshotId && !lastSnapshotId) {
      // 2026-01-10: CONSOLIDATED - This useEffect only syncs state
      // The vecto-snapshot-saved event listener (below) is the SINGLE source of waterfall triggers
      // This prevents race conditions from having two code paths trigger the same POST
      console.log("🔄 CoPilotContext: Syncing snapshot from context:", contextSnapshotId.slice(0, 8));
      setLastSnapshotId(contextSnapshotId);

      // 2026-01-06: P3-D - Mark resume mode in dedup set (waterfall skipped by event handler)
      if (checkAndClearResumeMode()) {
        console.log("📦 CoPilotContext: RESUME MODE - marking in dedup set");
        waterfallTriggeredRef.current.add(contextSnapshotId);
      }
      // NOTE: Waterfall is triggered by vecto-snapshot-saved event, not here
    }
  }, [locationContext?.lastSnapshotId, lastSnapshotId, isAuthenticated]);

  // 2026-01-07: Listen for manual refresh to immediately clear strategy state
  // Location context dispatches 'vecto-strategy-cleared' when user clicks refresh button
  // This ensures UI shows loading state immediately, not stale strategy
  useEffect(() => {
    const handleStrategyClear = () => {
      console.log('[CoPilotContext] 🔄 Manual refresh detected - clearing ALL state for fresh regeneration');

      // 2026-01-07: CRITICAL - Set flag BEFORE clearing state to prevent race condition
      // This flag tells the useEffect at line 122 to NOT restore the old snapshotId
      manualRefreshInProgressRef.current = true;

      // Clear localStorage
      localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);

      // Clear React state - MUST clear lastSnapshotId so new snapshot triggers waterfall
      // 2026-04-27: setPersistentStrategy removed — see auth-lost cleanup above for why.
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      setLastSnapshotId(null);  // CRITICAL: Clear snapshot ID so new one triggers waterfall

      // Clear deduplication set so new snapshot can trigger waterfall
      // Log for debugging - this should show empty set
      console.log('[CoPilotContext] 🔄 Clearing waterfallTriggeredRef, had:', Array.from(waterfallTriggeredRef.current));
      waterfallTriggeredRef.current.clear();

      // 2026-04-14: Phase 4 — Manual refresh is a user action that resets the hard-fail block.
      if (snapshotHardFailRef.current) {
        console.log('[CoPilotContext] 🔄 Clearing snapshot hard-fail block on manual refresh:', snapshotHardFailRef.current.slice(0, 8));
        snapshotHardFailRef.current = null;
      }

      // Reset previous snapshot ref so change detection works
      prevSnapshotIdRef.current = null;

      // Reset react-query cache (using centralized query keys)
      queryClient.resetQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(null) });
      queryClient.resetQueries({ queryKey: QUERY_KEYS.BLOCKS_FAST(null) });

      console.log('[CoPilotContext] ✅ State cleared, manualRefreshInProgressRef=true - waiting for new snapshot');
    };

    window.addEventListener('vecto-strategy-cleared', handleStrategyClear);
    return () => window.removeEventListener('vecto-strategy-cleared', handleStrategyClear);
  }, [queryClient]);

  // Listen for snapshot-saved event (PRIMARY trigger - fires when new snapshot is created)
  // 2026-01-06: P3-D - Event now includes reason: 'init' | 'manual_refresh' | 'resume'
  useEffect(() => {
    const handleSnapshotSaved = async (e: any) => {
      const snapshotId = e.detail?.snapshotId;
      const reason = e.detail?.reason;

      if (snapshotId) {
        console.log("🎯 CoPilotContext: Snapshot ready (via event):", snapshotId.slice(0, 8), "reason:", reason);

        // 2026-04-14: Phase 4 — Hard-fail guard. If this exact snapshotId already hard-failed,
        // refuse to retrigger until user acts (manual refresh) or a different snapshot arrives.
        if (snapshotHardFailRef.current === snapshotId) {
          console.warn("[CoPilotContext] Snapshot already hard-failed — ignoring event until refresh:", snapshotId.slice(0, 8));
          return;
        }
        if (snapshotHardFailRef.current && snapshotHardFailRef.current !== snapshotId) {
          console.log("[CoPilotContext] New snapshot after hard-fail — clearing block:", snapshotHardFailRef.current.slice(0, 8), "→", snapshotId.slice(0, 8));
          snapshotHardFailRef.current = null;
        }

        // 2026-01-07: Clear the manual refresh flag - new snapshot has arrived
        // This allows the system to accept this snapshot and trigger waterfall
        if (manualRefreshInProgressRef.current) {
          console.log("✅ CoPilotContext: Manual refresh complete - new snapshot received");
          manualRefreshInProgressRef.current = false;
        }

        setLastSnapshotId(snapshotId);

        // 2026-01-06: P3-D - Skip blocks-fast for resume events
        if (reason === 'resume') {
          console.log("📦 CoPilotContext: RESUME event - skipping blocks-fast waterfall");
          waterfallTriggeredRef.current.add(snapshotId);
          return;
        }

        // DEDUPLICATION: Skip if already triggered for this snapshot
        if (waterfallTriggeredRef.current.has(snapshotId)) {
          console.log("⏭️ CoPilotContext: Skipping duplicate waterfall (already triggered via useEffect):", snapshotId.slice(0, 8));
          return;
        }
        waterfallTriggeredRef.current.add(snapshotId);

        try {
          // 2026-04-10: Abort any previous in-flight waterfall POST (Window 3 race fix)
          if (waterfallAbortRef.current) {
            waterfallAbortRef.current.abort();
          }
          const controller = new AbortController();
          waterfallAbortRef.current = controller;

          // Snapshot readiness gate: 202 means enrichment in progress, retry with backoff.
          // Memory #111: Server holds briefing until snapshot.status = 'ok'. Client retries
          // with exponential backoff (2s, 4s, 8s, 16s, 32s) up to 5 attempts.
          const delays = [2000, 4000, 8000, 16000, 32000];
          let attempt = 0;
          let response: Response | null = null;

          while (attempt <= delays.length) {
            console.log(
              `🚀 Triggering POST /api/blocks-fast waterfall (from event)... ${snapshotId.slice(0, 8)}${attempt > 0 ? ` [retry ${attempt}/${delays.length}]` : ''}`
            );
            response = await fetch(API_ROUTES.BLOCKS.FAST, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // 2026-04-14: Phase 4 — server reads this header and returns 503 once >= MAX_SNAPSHOT_RETRIES.
                'X-Snapshot-Retry-Count': String(attempt),
                ...getAuthHeader()
              },
              body: JSON.stringify({ snapshotId }),
              signal: controller.signal,
            });

            // 2026-04-14: Phase 4 — 503 = hard fail. Server has given up; we stop and block further retries.
            if (response.status === 503) {
              let body: any = {};
              try { body = await response.clone().json(); } catch { /* body not JSON — proceed with empty */ }
              const missing: string[] = Array.isArray(body?.missingFields) ? body.missingFields : [];
              console.error('[CoPilot] ❌ HARD FAIL: Snapshot incomplete after max retries. Missing:', missing.length ? missing : '(unknown)');
              snapshotHardFailRef.current = snapshotId;
              // Dispatch a window event so UI layers (header, toast, etc.) can surface "Location data incomplete — please refresh".
              window.dispatchEvent(new CustomEvent('vecto-snapshot-hard-fail', {
                detail: {
                  snapshotId,
                  missingFields: missing,
                  message: body?.message || 'Location data incomplete — please refresh',
                  retryCount: body?.retryCount,
                  maxRetries: body?.maxRetries
                }
              }));
              break;
            }

            if (response.status !== 202) break; // 200/error/etc — exit loop, handle below

            if (attempt >= delays.length) {
              console.warn('[CoPilot] Snapshot still pending after max retries — giving up');
              break;
            }

            console.log(`[CoPilot] Snapshot still enriching — will retry when ready (in ${delays[attempt] / 1000}s)`);
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, delays[attempt]);
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            });
            attempt++;
          }

          if (response?.ok) {
            console.log("✅ Waterfall complete");
          } else if (response?.status === 503) {
            console.error("[CoPilot] Waterfall aborted — snapshot hard-failed. Awaiting manual refresh or new snapshot.");
          } else if (response?.status === 202) {
            console.warn("[CoPilot] Waterfall still pending after retries — user may need to refresh");
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log("[CoPilotContext] Waterfall POST aborted (logout or new snapshot)");
            return;
          }
          console.error("❌ Waterfall error:", err);
        }
      }
    };
    window.addEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
    return () => window.removeEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
  }, []);

  // Track previous snapshot ID to detect actual changes
  const prevSnapshotIdRef = useRef<string | null>(null);

  // Clear strategy when snapshot ID changes
  // 2026-01-06: REVISED per P3-A audit fix
  // REMOVED first-mount clearing - this was causing regeneration on app resume
  //
  // The "49-min-old strategy" problem is now solved differently:
  // - useStrategyPolling.ts restores strategy ONLY if stored snapshotId matches current
  // - If snapshot changes, strategy is cleared (below)
  // - Manual refresh clears via location-context-clean.tsx (forceNewSnapshot)
  // - Logout clears via auth-context.tsx
  //
  // LESSON LEARNED: A 10-minute-old strategy is FINE if the snapshot hasn't changed.
  // The snapshot represents the driver's position+time context. Same snapshot = same context.
  useEffect(() => {
    // Skip if no snapshot yet
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    // On first mount, just track the snapshot - don't clear
    // 2026-01-06: REMOVED clearing here per P3-A audit
    if (prevSnapshotIdRef.current === null) {
      console.log('🔄 [CoPilotContext] First mount - tracking snapshot:', lastSnapshotId.slice(0, 8));
      prevSnapshotIdRef.current = lastSnapshotId;
      return;
    }

    // Clear if snapshot changed (different location/time context)
    if (prevSnapshotIdRef.current !== lastSnapshotId) {
      console.log(`🔄 [CoPilotContext] Snapshot changed from ${prevSnapshotIdRef.current?.slice(0, 8)} to ${lastSnapshotId.slice(0, 8)}, clearing old strategy`);
      localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);
      // 2026-04-27: setPersistentStrategy removed — state was deleted in a prior
      // refactor; localStorage cleanup above is sufficient.
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      queryClient.resetQueries({ queryKey: QUERY_KEYS.BLOCKS_STRATEGY(null) });
    }

    prevSnapshotIdRef.current = lastSnapshotId;
  }, [lastSnapshotId, queryClient]);

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
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.BLOCKS_FAST(lastSnapshotId), type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE phase_change events for real-time progress bar updates
  // LESSON LEARNED: Without this, progress bar only updates via 3-second polling,
  // which is too slow to track rapid phase transitions (the bar "jumps" or "sticks")
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribePhaseChange((data) => {
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
    queryKey: QUERY_KEYS.SNAPSHOT(lastSnapshotId),
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      const response = await fetch(API_ROUTES.SNAPSHOT.GET(lastSnapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        // 2026-01-15: FAIL HARD - Don't silently return null, throw so react-query catches it
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error || `Snapshot fetch failed: ${response.status}`);
        (error as any).code = errorData.error;
        (error as any).details = errorData.message;
        throw error;
      }
      const data = await response.json();
      // 2026-01-15: FAIL HARD - Validate critical fields exist
      if (!data.city || !data.timezone) {
        const error = new Error('Snapshot data incomplete: missing city or timezone');
        (error as any).code = 'SNAPSHOT_INCOMPLETE';
        throw error;
      }
      return data;
    },
    // 2026-04-05: Gate on isAuthenticated to prevent polling after logout
    enabled: isAuthenticated && !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
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
  const { data: strategyData, isFetching: isStrategyFetching } = useQuery({
    queryKey: QUERY_KEYS.BLOCKS_STRATEGY(lastSnapshotId),
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;

      const response = await fetch(API_ROUTES.BLOCKS.STRATEGY(lastSnapshotId), {
        headers: getAuthHeader()
      });
      if (!response.ok) return null;

      const data = await response.json();
      return { ...data, _snapshotId: lastSnapshotId };
    },
    // 2026-04-05: Gate on isAuthenticated — this is the 3-second poller that spams after logout
    enabled: isAuthenticated && !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'ok' || status === 'error') return false;
      return 3000;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    const strategyForNow = strategyData?.strategy?.strategyForNow;
    if (strategyForNow && strategyForNow !== immediateStrategy) {
      setImmediateStrategy(strategyForNow);
      setStrategySnapshotId(lastSnapshotId);
    }
  }, [strategyData, lastSnapshotId, immediateStrategy]);

  // Fetch blocks
  // 2026-01-15: Using centralized API_ROUTES and QUERY_KEYS for consistency
  const { data: blocksData, isLoading: isBlocksLoading, error: blocksError, refetch: refetchBlocks } = useQuery<BlocksResponse>({
    queryKey: QUERY_KEYS.BLOCKS_FAST(lastSnapshotId),
    queryFn: async () => {
      if (!coords) throw new Error('No GPS coordinates');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 230000);

      try {
        const response = await fetch(API_ROUTES.BLOCKS.FAST_WITH_QUERY(lastSnapshotId!), {
          method: 'GET',
          signal: controller.signal,
          headers: { 'X-Snapshot-Id': lastSnapshotId || '', ...getAuthHeader() }
        });
        clearTimeout(timeoutId);

        if (!response.ok && response.status !== 202) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch blocks: ${errorText}`);
        }

        const data = await response.json();
        const isGenerating = data.status === 'pending_blocks' || data.reason === 'blocks_generating';

        // 2026-01-15: FAIL HARD - Validate ranking_id exists when blocks are returned
        // ranking_id is required to link votes, strategy, and blocks
        if (data.blocks && data.blocks.length > 0 && !data.rankingId) {
          const error = new Error('CRITICAL: Blocks returned without ranking_id - feedback system broken');
          (error as any).code = 'RANKING_ID_MISSING';
          throw error;
        }

        // 2026-01-06: P4-C fix - use real timezone from LocationContext (GPS-derived)
        // NEVER use hardcoded timezone (was 'America/Chicago' - violates NO FALLBACKS rule)
        // 2026-02-13: Removed dead `data.timezone` — blocks-fast.js never returns timezone.
        // LocationContext.timeZone is the single source of truth (derived from GPS position).
        // 2026-01-10: D-027 - Server now returns camelCase (single contract)
        return {
          now: data.generatedAt || new Date().toISOString(),
          timezone: locationContext?.timeZone || null,
          strategy: data.strategy?.strategyForNow || data.briefing?.strategyForNow,
          pathTaken: data.pathTaken,
          refined: data.refined,
          timing: data.timing,
          isBlocksGenerating: isGenerating,
          // 2026-01-09: P1-5 FIX - Removed fallbacks, using canonical camelCase only
          // Server now returns consistent camelCase - no need to accept multiple spellings
          blocks: data.blocks?.map((v: any) => ({
            name: v.name,
            address: v.address,
            category: v.category,
            placeId: v.placeId,
            coordinates: { lat: v.coordinates?.lat, lng: v.coordinates?.lng },
            estimatedDistanceMiles: Number(v.estimatedDistanceMiles ?? 0),
            driveTimeMinutes: Number(v.driveTimeMinutes ?? 0),
            distanceSource: v.distanceSource ?? "routes_api",
            estimatedEarningsPerRide: v.estimatedEarningsPerRide ?? null,
            valuePerMin: v.valuePerMin ?? null,
            valueGrade: v.valueGrade ?? null,
            notWorth: !!v.notWorth,
            surge: v.surge ?? null,
            estimatedWaitTime: v.estimatedWaitTime,
            demandLevel: v.demandLevel,
            businessHours: v.businessHours,
            isOpen: v.isOpen,
            businessStatus: v.businessStatus,
            // 2026-01-14: Server uses toApiBlock (camelCase) - no snake_case fallback needed
            closedVenueReasoning: v.closedVenueReasoning,
            stagingArea: v.stagingArea,
            proTips: v.proTips ?? [],
            streetViewUrl: v.streetViewUrl,
            hasEvent: v.hasEvent ?? false,
            eventBadge: v.eventBadge ?? null,
            // 2026-04-14: Issue X — Preserve fields from toApiBlock() that were previously dropped
            venueId: v.venueId ?? null,
            eventSummary: v.eventSummary ?? null,
            // 2026-04-16: Driver preference scoring — four-hop contract (Decision #16)
            beyondDeadhead: !!v.beyondDeadhead,
            distanceFromHomeMi: v.distanceFromHomeMi ?? null
          })) || [],
          rankingId: data.rankingId,
          metadata: {
            totalBlocks: data.blocks?.length || 0,
            processingTimeMs: data.elapsed_ms || 0,
            modelRoute: data.model_route,
            validation: data.validation
          }
        } as BlocksResponse;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Request timed out');
        }
        throw err;
      }
    },
    enabled: (() => {
      if (!isAuthenticated) return false; // 2026-04-05: No polling after logout
      const hasCoords = !!coords;
      const hasSnapshot = !!lastSnapshotId && lastSnapshotId !== 'live-snapshot';
      // 2026-01-10: D-021 - Server sends 'ok' or 'pending_blocks', not 'complete' (removed deprecated check)
      const strategyReady = strategyData?.status === 'ok' || strategyData?.status === 'pending_blocks';
      const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;
      return hasCoords && hasSnapshot && strategyReady && snapshotMatches;
    })(),
    refetchInterval: (query) => {
      const blocks = query.state.data?.blocks;
      if (blocks && blocks.length > 0) return false;
      return 15000;
    },
    retry: (failureCount, error: any) => {
      if (error?.message?.includes('timeout')) return false;
      if (error?.message?.includes('NOT_FOUND')) return false;
      // 2026-01-15: FAIL HARD - Don't retry on missing ranking_id (data integrity bug)
      if (error?.code === 'RANKING_ID_MISSING') return false;
      return failureCount < 6;
    },
  });

  // 2026-01-15: FAIL HARD - Detect blocks errors and trigger critical error
  useEffect(() => {
    if (blocksError) {
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
  }, [blocksError, setCriticalError]);

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
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    isLoading: briefingIsLoading,
    isUnavailable: briefingIsUnavailable
  } = useBriefingQueries({
    snapshotId: lastSnapshotId,
    snapshotStatus: snapshotData?.status,
    pipelinePhase,
    // 2026-04-19: M3 fix — gate the briefing query on the same isAuthenticated
    // signal that strategy/blocks/bars use. Eliminates the post-logout window
    // where the briefing hook saw a missing localStorage token and froze.
    isAuthenticated,
  });

  // Pre-load bars data as soon as location resolves (no snapshot needed)
  // This ensures bars tab has data before user navigates there
  const {
    barsData,
    isBarsLoading,
    refetchBars
  } = useBarsQuery({
    latitude: coords?.latitude || null,
    longitude: coords?.longitude || null,
    city: locationContext?.city || null,
    state: locationContext?.state || null,
    timezone: locationContext?.timeZone || null,
    isLocationResolved: locationContext?.isLocationResolved || false
  });

  // LESSON LEARNED (Dec 2025): Context value MUST be memoized to prevent re-render cascade.
  // Without useMemo, every render creates a new object → all children re-render → flashing UI.
  // NOTE: refetchBlocks and refetchBars are STABLE refs from useQuery, so they're NOT in deps.
  // 2026-01-15: FAIL HARD - Callback to clear critical error (for retry functionality)
  const handleClearError = React.useCallback(() => {
    setCriticalError(null);
    // Also clear related state to allow fresh retry
    setLastSnapshotId(null);
    queryClient.resetQueries({ queryKey: QUERY_KEYS.SNAPSHOT(lastSnapshotId) });
  }, [lastSnapshotId, queryClient]);

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

    // Strategy
    strategyData: strategyData as StrategyData | null,
    immediateStrategy,
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

    // Pre-loaded briefing data
    // 2026-04-04: Defense-in-depth — ensure array fields are always arrays, never null.
    // Prevents "undefined is not iterable" crashes when components use for...of or spread.
    briefingData: {
      weather: weatherData?.weather || null,
      traffic: trafficData?.traffic || null,
      news: newsData?.news || null,
      // 2026-03-29: FIX - Unwrap events array from API response object
      // Previously stored full response object, breaking .filter() calls downstream
      // Now properly extracts events array AND marketEvents for separate access
      events: Array.isArray(eventsData?.events) ? eventsData.events : [],
      marketEvents: Array.isArray(eventsData?.marketEvents) ? eventsData.marketEvents : [],
      // 2026-01-10: Snake/camel tolerant - accept both server response formats
      // 2026-04-18: Preserve `reason` alongside the items array so SchoolClosuresCard
      // can render the server-provided reason (e.g., "No data source for this region")
      // instead of the generic "No school closures reported" fallback. Pre-fix the
      // reason was silently dropped at this layer, breaking transparency of the tab.
      schoolClosures: (() => {
        // Snake/camel tolerant: server may return either shape; cast since the
        // typed response only declares snake_case but legacy paths use camelCase.
        const sc = schoolClosuresData as { schoolClosures?: unknown; school_closures?: unknown } | null | undefined;
        const raw = sc?.schoolClosures ?? sc?.school_closures;
        return Array.isArray(raw) ? raw : [];
      })(),
      schoolClosuresReason: schoolClosuresData?.reason ?? null,
      airport: (() => {
        const a = airportData as { airportConditions?: unknown; airport_conditions?: unknown } | null | undefined;
        return a?.airportConditions ?? a?.airport_conditions ?? null;
      })(),
      // 2026-04-19: H3 fix — expose per-section _generationFailed flags so cards
      // can render explicit "section unavailable" states. Was previously dropped
      // at the unwrap step, so a permanently-failed weather section silently
      // hid instead of saying so.
      weatherFailed: !!(weatherData as any)?._generationFailed,
      isLoading: briefingIsLoading,
      // 2026-04-05: Expose "gave up" state so UI can show "Briefing data unavailable"
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
    strategyData,
    immediateStrategy,
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

  // 2026-01-15: FAIL HARD - Render CriticalError modal when in error state
  // This completely blocks the dashboard UI - no partial rendering allowed
  if (criticalError) {
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
