// client/src/contexts/co-pilot-context.tsx
// Shared state and queries for all co-pilot pages

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useLocationContext } from '@/contexts/location-context-clean';
import type { SmartBlock, BlocksResponse, StrategyData, PipelinePhase } from '@/types/co-pilot';
import { getAuthHeader, subscribeStrategyReady, subscribeBlocksReady, subscribePhaseChange } from '@/utils/co-pilot-helpers';
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useBarsQuery, type BarsData } from '@/hooks/useBarsQuery';

interface CoPilotContextValue {
  // Location (from LocationContext)
  coords: { latitude: number; longitude: number } | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;

  // Snapshot lifecycle
  lastSnapshotId: string | null;

  // Strategy
  strategyData: StrategyData | null;
  persistentStrategy: string | null;
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
    schoolClosures: any;
    airport: any;
    isLoading: {
      weather: boolean;
      traffic: boolean;
      events: boolean;
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

  // Snapshot state
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  // Track which snapshot the current strategy belongs to (for future refresh optimization)
  const [_strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);

  // Strategy state
  const [persistentStrategy, setPersistentStrategy] = useState<string | null>(null);
  const [immediateStrategy, setImmediateStrategy] = useState<string | null>(null);

  // Enriched reasonings for closed venues
  const [enrichedReasonings, _setEnrichedReasonings] = useState<Map<string, string>>(new Map());

  // Ref to track polling status
  const _lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');

  // DEDUPLICATION: Track which snapshot IDs have already triggered /api/blocks-fast
  // Prevents duplicate pipeline runs when both useEffect AND event handler fire
  const waterfallTriggeredRef = useRef<Set<string>>(new Set());

  // 2026-01-07: Flag to prevent race condition during manual refresh
  // When refresh clicked, we clear lastSnapshotId, but locationContext still has old value
  // Without this flag, useEffect would immediately restore the old snapshotId
  const manualRefreshInProgressRef = useRef<boolean>(false);

  // Get coords from location context
  const gpsCoords = locationContext?.currentCoords;
  const overrideCoords = locationContext?.overrideCoords;
  const coords = overrideCoords || gpsCoords;

  // 2026-01-06: P3-D - Check if this is a resume (skip blocks-fast regeneration)
  // Resume mode is set by LocationContext when restoring from sessionStorage
  const checkAndClearResumeMode = (): boolean => {
    const reason = sessionStorage.getItem('vecto_resume_reason');
    if (reason === 'resume') {
      sessionStorage.removeItem('vecto_resume_reason');
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

    if (contextSnapshotId && !lastSnapshotId) {
      console.log("🔄 CoPilotContext: Using snapshot from context:", contextSnapshotId);
      setLastSnapshotId(contextSnapshotId);

      // 2026-01-06: P3-D - Skip blocks-fast if this is a resume
      if (checkAndClearResumeMode()) {
        console.log("📦 CoPilotContext: RESUME MODE - skipping blocks-fast waterfall, using cached strategy");
        waterfallTriggeredRef.current.add(contextSnapshotId);
        return;
      }

      // DEDUPLICATION: Skip if already triggered for this snapshot
      if (waterfallTriggeredRef.current.has(contextSnapshotId)) {
        console.log("⏭️ CoPilotContext: Skipping duplicate waterfall (already triggered via event):", contextSnapshotId.slice(0, 8));
        return;
      }
      waterfallTriggeredRef.current.add(contextSnapshotId);

      // Trigger waterfall for this snapshot
      (async () => {
        try {
          console.log("🚀 Triggering POST /api/blocks-fast waterfall (from useEffect)...", contextSnapshotId.slice(0, 8));
          const response = await fetch('/api/blocks-fast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ snapshotId: contextSnapshotId })
          });

          if (!response.ok) {
            const error = await response.json();
            console.error("❌ Waterfall failed:", error);
          } else {
            const result = await response.json();
            console.log("✅ Waterfall complete:", result);
          }
        } catch (err) {
          console.error("❌ Waterfall error:", err);
        }
      })();
    }
  }, [locationContext?.lastSnapshotId, lastSnapshotId]);

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
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');

      // Clear React state - MUST clear lastSnapshotId so new snapshot triggers waterfall
      setPersistentStrategy(null);
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      setLastSnapshotId(null);  // CRITICAL: Clear snapshot ID so new one triggers waterfall

      // Clear deduplication set so new snapshot can trigger waterfall
      // Log for debugging - this should show empty set
      console.log('[CoPilotContext] 🔄 Clearing waterfallTriggeredRef, had:', Array.from(waterfallTriggeredRef.current));
      waterfallTriggeredRef.current.clear();

      // Reset previous snapshot ref so change detection works
      prevSnapshotIdRef.current = null;

      // Reset react-query cache
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
      queryClient.resetQueries({ queryKey: ['/api/blocks-fast'] });

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
          console.log("🚀 Triggering POST /api/blocks-fast waterfall (from event)...", snapshotId.slice(0, 8));
          const response = await fetch('/api/blocks-fast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ snapshotId })
          });

          if (response.ok) {
            console.log("✅ Waterfall complete");
          }
        } catch (err) {
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
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      setPersistentStrategy(null);
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
    }

    prevSnapshotIdRef.current = lastSnapshotId;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE strategy_ready events
  // LESSON LEARNED (Dec 2025): Use refetchQueries instead of invalidateQueries!
  // invalidateQueries clears cache immediately → isLoading=true → UI shows loading state → FLASH
  // refetchQueries fetches in background → isFetching=true but isLoading stays false → smooth transition
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribeStrategyReady((readySnapshotId) => {
      if (readySnapshotId === lastSnapshotId) {
        queryClient.refetchQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId], type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE blocks_ready events
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribeBlocksReady((data) => {
      if (data.snapshot_id === lastSnapshotId) {
        queryClient.refetchQueries({ queryKey: ['/api/blocks-fast', lastSnapshotId], type: 'active' });
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
        queryClient.refetchQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId], type: 'active' });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Fetch snapshot data
  const { data: snapshotData } = useQuery({
    queryKey: ['/api/snapshot', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      const response = await fetch(`/api/snapshot/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
  });

  // Fetch strategy
  const { data: strategyData, isFetching: isStrategyFetching } = useQuery({
    queryKey: ['/api/blocks/strategy', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;

      const response = await fetch(`/api/blocks/strategy/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return null;

      const data = await response.json();
      return { ...data, _snapshotId: lastSnapshotId };
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'ok' || status === 'error') return false;
      return 3000;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Update persistent strategy when new strategy arrives
  useEffect(() => {
    const consolidatedStrategy = strategyData?.strategy?.consolidated;
    const strategyForNow = strategyData?.strategy?.strategy_for_now;

    if (consolidatedStrategy && consolidatedStrategy !== persistentStrategy) {
      localStorage.setItem('vecto_persistent_strategy', consolidatedStrategy);
      localStorage.setItem('vecto_strategy_snapshot_id', lastSnapshotId || '');
      setPersistentStrategy(consolidatedStrategy);
      setStrategySnapshotId(lastSnapshotId);
    }

    if (strategyForNow && strategyForNow !== immediateStrategy) {
      setImmediateStrategy(strategyForNow);
    }
  }, [strategyData, lastSnapshotId, persistentStrategy, immediateStrategy]);

  // Fetch blocks
  const { data: blocksData, isLoading: isBlocksLoading, error: blocksError, refetch: refetchBlocks } = useQuery<BlocksResponse>({
    queryKey: ['/api/blocks-fast', lastSnapshotId],
    queryFn: async () => {
      if (!coords) throw new Error('No GPS coordinates');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 230000);

      try {
        const response = await fetch(`/api/blocks-fast?snapshotId=${lastSnapshotId}`, {
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

        // 2026-01-06: P4-C fix - use real timezone from server or LocationContext
        // NEVER use hardcoded timezone (was 'America/Chicago' - violates NO FALLBACKS rule)
        return {
          now: data.generatedAt || new Date().toISOString(),
          timezone: data.timezone || locationContext?.timeZone || null,
          strategy: data.strategy_for_now || data.briefing?.strategy_for_now,
          path_taken: data.path_taken,
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
            closedVenueReasoning: v.closedVenueReasoning,
            stagingArea: v.stagingArea,
            proTips: v.proTips ?? [],
            streetViewUrl: v.streetViewUrl,
            hasEvent: v.hasEvent ?? false,
            eventBadge: v.eventBadge ?? null
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
      const hasCoords = !!coords;
      const hasSnapshot = !!lastSnapshotId && lastSnapshotId !== 'live-snapshot';
      const strategyReady = strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks';
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
      return failureCount < 6;
    },
  });

  // 2026-01-06: CRITICAL FIX - Memoize blocks to prevent infinite re-render loop
  // Without useMemo, .map() creates a new array reference on every render.
  // Since `blocks` is in the context useMemo deps, this caused:
  // render → new blocks array → useMemo recalc → new context → consumer re-render → infinite loop
  const blocks = useMemo(() => {
    return (blocksData?.blocks || []).map(block => {
      if (!block.isOpen && !block.closed_venue_reasoning) {
        const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
        const reasoning = enrichedReasonings.get(key);
        if (reasoning) {
          return { ...block, closed_venue_reasoning: reasoning };
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
    isLoading: briefingIsLoading
  } = useBriefingQueries({ snapshotId: lastSnapshotId, pipelinePhase });

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
  const value: CoPilotContextValue = useMemo(() => ({
    // Location
    coords,
    city: locationContext?.city || null,
    state: locationContext?.state || null,
    timezone: locationContext?.timeZone || null,
    isLocationResolved: locationContext?.isLocationResolved || false,

    // Snapshot
    lastSnapshotId,

    // Strategy
    strategyData: strategyData as StrategyData | null,
    persistentStrategy,
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
    briefingData: {
      weather: weatherData?.weather || null,
      traffic: trafficData?.traffic || null,
      news: newsData?.news || null,
      events: eventsData?.events || [],
      schoolClosures: schoolClosuresData?.school_closures || [],
      airport: airportData?.airport_conditions || null,
      isLoading: briefingIsLoading,
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
    lastSnapshotId,
    strategyData,
    persistentStrategy,
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
    barsData,
    isBarsLoading,
    // refetchBlocks and refetchBars are EXCLUDED - they're stable refs from useQuery
  ]);

  return (
    <CoPilotContext.Provider value={value}>
      {children}
    </CoPilotContext.Provider>
  );
}
