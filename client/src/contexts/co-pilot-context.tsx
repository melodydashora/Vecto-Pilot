// client/src/contexts/co-pilot-context.tsx
// Shared state and queries for all co-pilot pages

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useLocationContext } from '@/contexts/location-context-clean';
import type { SmartBlock, BlocksResponse, StrategyData, PipelinePhase } from '@/types/co-pilot';
import { getAuthHeader, subscribeStrategyReady, subscribeBlocksReady } from '@/utils/co-pilot-helpers';
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';

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
  pipelinePhase: PipelinePhase;
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
  const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);

  // Strategy state
  const [persistentStrategy, setPersistentStrategy] = useState<string | null>(null);
  const [immediateStrategy, setImmediateStrategy] = useState<string | null>(null);

  // Enriched reasonings for closed venues
  const [enrichedReasonings, setEnrichedReasonings] = useState<Map<string, string>>(new Map());

  // Ref to track polling status
  const lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');

  // Get coords from location context
  const gpsCoords = locationContext?.currentCoords;
  const overrideCoords = locationContext?.overrideCoords;
  const coords = overrideCoords || gpsCoords;

  // Fallback: If location context has a snapshot ID and we don't, use it
  useEffect(() => {
    const contextSnapshotId = locationContext?.lastSnapshotId;
    if (contextSnapshotId && !lastSnapshotId) {
      console.log("🔄 CoPilotContext: Using snapshot from context:", contextSnapshotId);
      setLastSnapshotId(contextSnapshotId);

      // Trigger waterfall for this snapshot
      (async () => {
        try {
          console.log("🚀 Triggering POST /api/blocks-fast waterfall...");
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

  // Listen for snapshot-saved event
  useEffect(() => {
    const handleSnapshotSaved = async (e: any) => {
      const snapshotId = e.detail?.snapshotId;
      if (snapshotId) {
        console.log("🎯 CoPilotContext: Snapshot ready:", snapshotId);
        setLastSnapshotId(snapshotId);

        try {
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

  // Clear strategy ONLY when snapshot ID actually changes (not on mount)
  // This preserves data when switching between apps or route changes
  useEffect(() => {
    // Skip if no snapshot yet
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    // On first mount with a snapshot, try to restore from localStorage
    if (prevSnapshotIdRef.current === null) {
      const storedStrategy = localStorage.getItem('vecto_persistent_strategy');
      const storedSnapshotId = localStorage.getItem('vecto_strategy_snapshot_id');

      if (storedStrategy && storedSnapshotId === lastSnapshotId) {
        console.log('📦 [CoPilotContext] Restoring strategy from localStorage:', storedSnapshotId?.slice(0, 8));
        setPersistentStrategy(storedStrategy);
        setStrategySnapshotId(storedSnapshotId);
      }

      prevSnapshotIdRef.current = lastSnapshotId;
      return;
    }

    // Only clear if snapshot actually changed
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
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribeStrategyReady((readySnapshotId) => {
      if (readySnapshotId === lastSnapshotId) {
        queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId] });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE blocks_ready events
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    const unsubscribe = subscribeBlocksReady((data) => {
      if (data.snapshot_id === lastSnapshotId) {
        queryClient.invalidateQueries({ queryKey: ['/api/blocks-fast', lastSnapshotId] });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Fetch snapshot data
  const { data: snapshotData } = useQuery({
    queryKey: ['/api/snapshot', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      const response = await fetch(`/api/snapshot/${lastSnapshotId}`);
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

        return {
          now: data.generatedAt || new Date().toISOString(),
          timezone: 'America/Chicago',
          strategy: data.strategy_for_now || data.briefing?.strategy_for_now,
          path_taken: data.path_taken,
          refined: data.refined,
          timing: data.timing,
          isBlocksGenerating: isGenerating,
          blocks: data.blocks?.map((v: any) => ({
            name: v.name,
            address: v.address,
            category: v.category,
            placeId: v.placeId,
            coordinates: { lat: v.coordinates?.lat ?? v.lat, lng: v.coordinates?.lng ?? v.lng },
            estimated_distance_miles: Number(v.estimated_distance_miles ?? v.distance ?? 0),
            driveTimeMinutes: Number(v.driveTimeMinutes ?? v.drive_time ?? 0),
            distanceSource: v.distanceSource ?? "routes_api",
            estimatedEarningsPerRide: v.estimated_earnings ?? v.estimatedEarningsPerRide ?? null,
            earnings_per_mile: v.earnings_per_mile ?? null,
            value_per_min: v.value_per_min ?? null,
            value_grade: v.value_grade ?? null,
            not_worth: !!v.not_worth,
            surge: v.surge ?? null,
            estimatedWaitTime: v.estimatedWaitTime,
            demandLevel: v.demandLevel,
            businessHours: v.businessHours,
            isOpen: v.isOpen,
            businessStatus: v.businessStatus,
            closed_venue_reasoning: v.closed_venue_reasoning,
            stagingArea: v.stagingArea,
            proTips: v.proTips || v.pro_tips || [],
            streetViewUrl: v.streetViewUrl,
            hasEvent: v.hasEvent ?? v.features?.hasEvent ?? false,
            eventBadge: v.eventBadge ?? v.features?.eventBadge ?? null
          })) || [],
          ranking_id: data.ranking_id || data.correlationId,
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

  // Merge enriched reasonings into blocks
  const blocks = (blocksData?.blocks || []).map(block => {
    if (!block.isOpen && !block.closed_venue_reasoning) {
      const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
      const reasoning = enrichedReasonings.get(key);
      if (reasoning) {
        return { ...block, closed_venue_reasoning: reasoning };
      }
    }
    return block;
  });

  // Enrichment progress
  const hasBlocks = blocks.length > 0;
  const { progress: enrichmentProgress, strategyProgress, phase: _enrichmentPhase, pipelinePhase, timeRemainingText } = useEnrichmentProgress({
    coords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
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

  const value: CoPilotContextValue = {
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
  };

  return (
    <CoPilotContext.Provider value={value}>
      {children}
    </CoPilotContext.Provider>
  );
}
