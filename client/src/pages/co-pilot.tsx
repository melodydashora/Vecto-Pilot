/**
 * Vecto Pilot™ - Co-Pilot
 * 
 * Real-time AI-powered staging location recommendations with block selection.
 * Integrates with smart-blocks-enhanced API for time-aware zone suggestions.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  Navigation,
  TrendingUp,
  Clock,
  Sparkles,
  Zap,
  AlertCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Wine
} from 'lucide-react';
import { useLocation } from '@/contexts/location-context-clean';
import { useToast } from '@/hooks/useToast';
import { FeedbackModal } from '@/components/FeedbackModal';
import CoachChat from '@/components/CoachChat';
import { SmartBlocksStatus } from '@/components/SmartBlocksStatus';
import BarsTable from '@/components/BarsTable';
import BarTab from '@/components/BarTab';
import BriefingTab from '@/components/BriefingTab';
import MapTab from '@/components/MapTab';
import { DonationTab } from '@/components/DonationTab';
import RideshareIntelTab from '@/components/RideshareIntelTab';

// Shared types and utilities
import type { SmartBlock, BlocksResponse, StrategyData } from '@/types/co-pilot';
import { getAuthHeader, subscribeStrategyReady, subscribeBlocksReady, logAction as logActionHelper } from '@/utils/co-pilot-helpers';
import { BottomTabNavigation } from '@/components/co-pilot/BottomTabNavigation';
import { GreetingBanner } from '@/components/co-pilot/GreetingBanner';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import { useEnrichmentProgress } from '@/hooks/useEnrichmentProgress';
import { useStrategyLoadingMessages } from '@/hooks/useStrategyLoadingMessages';

// Types are now imported from @/types/co-pilot

/**
 * CoPilot - AI-powered venue recommendations and strategy optimization
 * - Displays real-time smart blocks (staging areas) with demand/earnings insights
 * - Polls for AI-generated recommendations every 5 seconds until blocks arrive
 * - Integrates feedback system for continuous ML model improvement
 */
const CoPilot: React.FC = () => {
  const locationContext = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const [distanceFilter, _setDistanceFilter] = useState<'auto' | 'near' | 'far'>('auto');
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'gpt-5' | 'claude' | null>(null);
  const [modelParameter, setModelParameter] = useState<string>('0.7');
  const [dwellTimers, setDwellTimers] = useState<Map<number, number>>(new Map());
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null); // Start empty for fresh load
  const [persistentStrategy, setPersistentStrategy] = useState<string | null>(null); // Start empty for fresh load (consolidated daily strategy)
  const [immediateStrategy, setImmediateStrategy] = useState<string | null>(null); // Strategy for right now (GPT-5.2 generated)
  const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null); // Start empty for fresh load
  const [_strategyReadyTime, _setStrategyReadyTime] = useState<number | null>(null); // Track when strategy became ready
  const [enrichedReasonings, setEnrichedReasonings] = useState<Map<string, string>>(new Map());

  // Feedback modal state
  const [feedbackModal, setFeedbackModal] = useState<{
    isOpen: boolean;
    sentiment: 'up' | 'down' | null;
    block: SmartBlock | null;
    blockIndex: number | null;
  }>({
    isOpen: false,
    sentiment: null,
    block: null,
    blockIndex: null,
  });

  // Strategy feedback modal state  
  const [strategyFeedbackOpen, setStrategyFeedbackOpen] = useState(false);

  // Bottom tab navigation
  const [activeTab, setActiveTab] = useState<'strategy' | 'venues' | 'briefing' | 'map' | 'rideshare' | 'donation'>('strategy');

  // Ref to track polling status changes (reduces console spam by only logging transitions)
  const lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');

  // Text-to-speech state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Get coords from shared location context (same as GlobalHeader)
  const gpsCoords = locationContext?.currentCoords;
  const refreshGPS = locationContext?.refreshGPS;
  const isUpdating = locationContext?.isLoading || false;

  // Get override coords from shared context (synced with GlobalHeader)
  const overrideCoords = locationContext?.overrideCoords;
  const setOverrideCoords = locationContext?.setOverrideCoords;

  // Use override coords if available, otherwise GPS
  const coords = overrideCoords || gpsCoords;

  // getAuthHeader is now imported from @/utils/co-pilot-helpers

  // Fallback: If location context has a snapshot ID and we don't, use it
  // This handles the case where the event was dispatched before co-pilot mounted
  useEffect(() => {
    const contextSnapshotId = locationContext?.lastSnapshotId;
    if (contextSnapshotId && !lastSnapshotId) {
      console.log("🔄 Co-Pilot: Using snapshot from context (event may have been missed):", contextSnapshotId);
      setLastSnapshotId(contextSnapshotId);

      // Trigger waterfall for this snapshot
      (async () => {
        try {
          console.log("🚀 Triggering POST /api/blocks-fast waterfall (from context fallback)...");
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

  // Listen for snapshot-saved event to trigger waterfall and load all tabs
  useEffect(() => {
    const handleSnapshotSaved = async (e: any) => {
      const snapshotId = e.detail?.snapshotId;
      if (snapshotId) {
        console.log("🎯 Co-Pilot: Snapshot ready, triggering all tabs + waterfall:", snapshotId);
        setLastSnapshotId(snapshotId);

        // Trigger synchronous waterfall: providers → consolidation → blocks
        // This POST blocks until all steps complete (35-50s total)
        try {
          console.log("🚀 Triggering POST /api/blocks-fast waterfall...");
          const response = await fetch('/api/blocks-fast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ snapshotId })
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
      }
    };
    window.addEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);

    return () => window.removeEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
  }, []);

  // Clear persistent strategy on mount to force fresh generation
  useEffect(() => {
    console.log("🧹 Clearing persistent strategy on app mount");
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    setPersistentStrategy(null);
    setImmediateStrategy(null);
    setStrategySnapshotId(null);
  }, []);

  // Clear strategy if snapshot ID changes
  useEffect(() => {
    if (lastSnapshotId && lastSnapshotId !== 'live-snapshot' && strategySnapshotId && lastSnapshotId !== strategySnapshotId) {
      console.log(`🔄 New snapshot detected (${lastSnapshotId}), clearing old strategy from ${strategySnapshotId}`);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      setPersistentStrategy(null);
      setImmediateStrategy(null);
      setStrategySnapshotId(null);
      // Force immediate query restart for new snapshot (ensures progress bar starts fresh)
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
    }
  }, [lastSnapshotId, strategySnapshotId]);

  // Subscribe to SSE strategy_ready events
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    console.log('[SSE] Subscribing to strategy_ready events for snapshot:', lastSnapshotId);
    const unsubscribe = subscribeStrategyReady((readySnapshotId) => {
      if (readySnapshotId === lastSnapshotId) {
        console.log('[SSE] Strategy ready for current snapshot, fetching data');
        // Refetch the strategy query
        queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId] });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Subscribe to SSE blocks_ready events
  useEffect(() => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return;

    console.log('[SSE] Subscribing to blocks_ready events for snapshot:', lastSnapshotId);
    const unsubscribe = subscribeBlocksReady((data) => {
      if (data.snapshot_id === lastSnapshotId) {
        console.log('[SSE] Blocks ready for current snapshot, fetching data');
        // Refetch the blocks query
        queryClient.invalidateQueries({ queryKey: ['/api/blocks-fast', lastSnapshotId] });
      }
    });

    return unsubscribe;
  }, [lastSnapshotId, queryClient]);

  // Fetch snapshot data early for Coach context (backup while strategy generates)
  const { data: snapshotData } = useQuery({
    queryKey: ['/api/snapshot', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;

      const response = await fetch(`/api/snapshot/${lastSnapshotId}`);
      if (!response.ok) return null;

      const data = await response.json();
      console.log('[snapshot-fetch]', {
        city: data.city,
        state: data.state,
        weather: data.weather,
        air: data.air,
        hour: data.hour,
        dayPart: data.day_part_key,
        holiday: data.holiday
      });
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 20 * 60 * 1000,
  });

  // Fetch strategy from database when we have a new snapshot (polling fallback if SSE fails)
  const { data: strategyData, isFetching: isStrategyFetching } = useQuery({
    queryKey: ['/api/blocks/strategy', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;

      const response = await fetch(`/api/blocks/strategy/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return null;

      const data = await response.json();
      console.log(`[strategy-fetch] Status: ${data.status}, Phase: ${data.phase || 'none'}, Time: ${data.timeElapsedMs}ms`);
      // Attach the snapshot ID to the response for validation
      return { ...data, _snapshotId: lastSnapshotId };
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    // Poll every 3 seconds while pending/missing to show phase progress, stop when complete
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling only when we have a definitive completion status
      if (status === 'ok' || status === 'error') {
        return false;
      }
      // Poll while: no data yet (undefined), missing, pending, or pending_blocks
      return 3000;
    },
    // Cache for 5 minutes to avoid refetching
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // ===== BRIEFING TAB QUERIES (using extracted hook) =====
  // Note: pipelinePhase is used to delay queries until briefing data is ready
  // Get phase directly from strategyData since useEnrichmentProgress is called later
  const currentPipelinePhase = (strategyData?.phase as import('@/types/co-pilot').PipelinePhase) || 'starting';
  const {
    weatherData,
    trafficData,
    newsData,
    eventsData,
    schoolClosuresData,
    airportData,
    isLoading: _briefingLoading
  } = useBriefingQueries({ snapshotId: lastSnapshotId, pipelinePhase: currentPipelinePhase });

  // NOTE: Enrichment progress state is tracked via useEnrichmentProgress hook
  // (called after blocksData query below)

  // Update persistent strategy and immediate strategy when new strategy arrives
  useEffect(() => {
    const consolidatedStrategy = strategyData?.strategy?.consolidated;
    const strategyForNow = strategyData?.strategy?.strategy_for_now;
    
    if (consolidatedStrategy && consolidatedStrategy !== persistentStrategy) {
      console.log("📝 New consolidated strategy received, persisting to localStorage");
      localStorage.setItem('vecto_persistent_strategy', consolidatedStrategy);
      localStorage.setItem('vecto_strategy_snapshot_id', lastSnapshotId || '');
      setPersistentStrategy(consolidatedStrategy);
      setStrategySnapshotId(lastSnapshotId);
    }
    
    if (strategyForNow && strategyForNow !== immediateStrategy) {
      console.log("🎯 New immediate strategy received for right now");
      setImmediateStrategy(strategyForNow);
    }
  }, [strategyData, lastSnapshotId, persistentStrategy, immediateStrategy]);

  // Distance filtering is handled server-side via snapshot-scoped blocks
  // Client distanceFilter state retained for potential future UI filters

  // Fetch smart blocks - server returns Top6 based on staging coordinate
  // GATED on snapshot ready to prevent "Unknown city" race condition
  const { data: blocksData, isLoading, error, refetch } = useQuery<BlocksResponse>({
    // Note: selectedModel and modelParameter NOT in queryKey to avoid cancelling previous requests during testing
    queryKey: ['/api/blocks', coords?.latitude, coords?.longitude, distanceFilter, locationContext.locationSessionId, lastSnapshotId],
    queryFn: async () => {
      if (!coords) throw new Error('No GPS coordinates');

      // 3min 50s timeout for Triad orchestrator (AI processing with buffer)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 230000); // 230s = 3min 50s with buffer

      try {
        const headers: HeadersInit = lastSnapshotId ? { 'X-Snapshot-Id': lastSnapshotId } : {};

        // PRODUCTION AUTO-ROUTER: Use merged strategy from configured AI models
        // TEST MODE: Use manual model selection
        if (selectedModel) {
          // Manual testing: /api/test-blocks with specific model
          const response = await fetch(`/api/test-blocks?lat=${coords.latitude}&lng=${coords.longitude}&minDistance=${distanceRange.min}&maxDistance=${distanceRange.max}&llmModel=${selectedModel}&llmParam=${modelParameter}`, {
            signal: controller.signal,
            headers
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch blocks: ${errorText}`);
          }
          return response.json();
        } else {
          // Production: Use Fast Tactical Path with GET to retrieve existing blocks
          // POST would trigger regeneration, GET retrieves snapshot-scoped blocks
          const endpoint = '/api/blocks-fast';

          // First try GET to retrieve existing blocks (snapshot-first pattern)
          const response = await fetch(`${endpoint}?snapshotId=${lastSnapshotId}`, {
            method: 'GET',
            signal: controller.signal,
            headers: { ...headers, ...getAuthHeader() }
          });
          clearTimeout(timeoutId);

          // Handle 202 Accepted as success (blocks still generating)
          if (!response.ok && response.status !== 202) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch strategy: ${errorText}`);
          }

          // Transform response to match existing interface
          const data = await response.json();
          // Debug: Full API response for troubleshooting
          console.log('[blocks-query] 📦 Raw API response:', {
            status: response.status,
            ok: data.ok,
            reason: data.reason,
            dataStatus: data.status,
            blocksCount: data.blocks?.length,
            hasRankingId: !!data.ranking_id,
            hasBriefing: !!data.briefing,
            keys: Object.keys(data)
          });

          // Track if blocks are still being generated (202 response)
          const isGenerating = data.status === 'pending_blocks' || data.reason === 'blocks_generating' || data.reason === 'briefing_pending';

          const transformed = {
            now: data.generatedAt || new Date().toISOString(),
            timezone: 'America/Chicago',
            strategy: data.strategy_for_now || data.briefing?.strategy_for_now || data.strategy?.strategy_for_now,
            path_taken: data.path_taken,
            refined: data.refined,
            timing: data.timing,
            isBlocksGenerating: isGenerating,
            blocks: data.blocks?.map((v: any) => {
              return {
                name: v.name,
                address: v.address,
                category: v.category,
                placeId: v.placeId,
                coordinates: {
                  lat: v.coordinates?.lat ?? v.lat,
                  lng: v.coordinates?.lng ?? v.lng
                },
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
                // Event flags from discovered_events matching
                hasEvent: v.hasEvent ?? v.features?.hasEvent ?? false,
                eventBadge: v.eventBadge ?? v.features?.eventBadge ?? null
              };
            }) || [],
            ranking_id: data.ranking_id || data.correlationId,  // Use actual ranking_id from DB
            metadata: {
              totalBlocks: data.blocks?.length || 0,
              processingTimeMs: data.elapsed_ms || 0,
              modelRoute: data.model_route,
              validation: data.validation
            }
          };

          // Log the result
          if (isGenerating) {
            console.log('[blocks-query] 🔄 Blocks generating:', { status: data.status, reason: data.reason });
          } else {
            console.log('[blocks-query] ✅ Blocks fetched successfully:', { count: transformed.blocks?.length, blocks: transformed.blocks?.slice(0, 2) });
          }
          return transformed;
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Request timed out - AI is taking longer than expected');
        }
        throw err;
      }
    },
    // SIMPLIFIED POLLING: Start when AI Coach (strategy) is visible
    // No SSE, no complex gating - just poll after strategy shows
    enabled: (() => {
      const hasCoords = !!coords;
      const hasSnapshot = !!lastSnapshotId && lastSnapshotId !== 'live-snapshot';
      const strategyReady = strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks';
      const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;

      // SIMPLE GATE: Only start polling when AI Coach is visible
      const shouldEnable = hasCoords && hasSnapshot && strategyReady && snapshotMatches;

      // Debug: Only log gating status changes to reduce console spam
      if (shouldEnable && lastStatusRef.current !== 'ready') {
        console.log('[blocks-query] ✅ Ready to fetch blocks (strategy-driven polling)');
        lastStatusRef.current = 'ready';
      } else if (!shouldEnable && lastStatusRef.current === 'ready') {
        const reason = !hasCoords ? 'NO_COORDS' : !hasSnapshot ? 'NO_SNAPSHOT' : !strategyReady ? 'STRATEGY_PENDING' : 'SNAPSHOT_MISMATCH';
        console.log('[blocks-query] ⏸️ Polling paused -', reason);
        lastStatusRef.current = 'paused';
      }

      return shouldEnable;
    })(),
    // Reduced polling - SSE is primary mechanism, this is just a safety fallback
    // Poll every 15s until blocks arrive, then stop
    refetchInterval: (query) => {
      const blocks = query.state.data?.blocks;
      const hasBlocks = blocks && blocks.length > 0;
      // Stop polling once we have blocks
      if (hasBlocks) {
        return false;
      }
      return 15000; // Poll every 15 seconds (SSE handles immediate updates)
    },
    retry: (failureCount, error: any) => {
      // Stop retrying if we got a timeout (504)
      if (error?.message?.includes('504') || error?.message?.includes('timeout')) {
        console.error('[co-pilot] Strategy generation timed out, stopping retries');
        return false;
      }
      // Stop retrying if blocks aren't ready yet (NOT_FOUND) - refetchInterval will handle periodic checks
      if (error?.message?.includes('NOT_FOUND')) {
        return false;
      }
      // Otherwise retry up to 6 times (max ~30 seconds with backoff)
      return failureCount < 6;
    },
    retryDelay: (attemptIndex) => Math.min(3000 * 2 ** attemptIndex, 10000), // Exponential backoff: 3s, 6s, 10s max
  });

  // NOTE: Bar Tab data fetching moved to BarTab.tsx component
  // The BarTab component handles its own independent data flow

  // Enrichment progress tracking (using extracted hook)
  const hasBlocks = (blocksData?.blocks?.length ?? 0) > 0;
  const { progress: enrichmentProgress, strategyProgress, phase: enrichmentPhase, pipelinePhase, timeRemainingText } = useEnrichmentProgress({
    coords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
    strategyData: strategyData as StrategyData | null,
    lastSnapshotId,
    hasBlocks
  });

  // Cycling loading messages for strategy generation (with time remaining)
  const loadingMessages = useStrategyLoadingMessages({ pipelinePhase, timeRemainingText });

  useEffect(() => {
    if (error) {
      toast({
        title: 'Failed to Load Recommendations',
        description: 'Unable to fetch AI-powered blocks. Check your connection.',
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  // Retry strategy generation with same location context
  const [_isRetrying, setIsRetrying] = useState(false);
  const _retryStrategy = async () => {
    if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') {
      toast({
        title: 'Cannot Retry',
        description: 'No strategy to retry. Please wait for initial strategy to generate.',
        variant: 'destructive',
      });
      return;
    }

    setIsRetrying(true);
    try {
      console.log(`[retry] Retrying strategy for snapshot ${lastSnapshotId}`);
      const response = await fetch(`/api/strategy/${lastSnapshotId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Retry failed: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[retry] New snapshot created: ${data.new_snapshot_id}`);

      // Update to new snapshot
      setLastSnapshotId(data.new_snapshot_id);
      setPersistentStrategy(null);
      setStrategySnapshotId(null);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');

      // Invalidate queries to trigger refresh
      queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy'] });
      queryClient.invalidateQueries({ queryKey: ['/api/strategy/history'] });

      toast({
        title: 'Strategy Retry Started',
        description: 'Generating a new strategy with updated AI analysis...',
      });
    } catch (err) {
      console.error('[retry] Failed:', err);
      toast({
        title: 'Retry Failed',
        description: err instanceof Error ? err.message : 'Unable to retry strategy',
        variant: 'destructive',
      });
    } finally {
      setIsRetrying(false);
    }
  };

  // Log action wrapper using imported helper (provides rankingId from blocksData context)
  const logAction = (action: string, blockId?: string, dwellMs?: number, fromRank?: number) => {
    logActionHelper(blocksData?.ranking_id, action, blockId, dwellMs, fromRank);
  };

  // Server now returns Top6 pre-ranked by earnings per mile
  // No client-side distance filtering - server handles expand policy
  const blocks = (blocksData?.blocks || []).map(block => {
    // Merge in real-time enriched reasoning for closed venues
    if (!block.isOpen && !block.closed_venue_reasoning) {
      const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
      const reasoning = enrichedReasonings.get(key);
      if (reasoning) {
        return { ...block, closed_venue_reasoning: reasoning };
      }
    }
    return block;
  });

  // Log blocks for debugging
  if (blocks.length > 0) {
    console.log('✅ SmartBlocks rendering:', { count: blocks.length, firstBlock: blocks[0]?.name });
  }

  const metadata = blocksData?.metadata;
  const _tacticalSummary = (blocksData as BlocksResponse | undefined)?.tactical_summary;
  const _bestStagingLocation = (blocksData as BlocksResponse | undefined)?.best_staging_location;

  // Log view action when blocks are loaded
  useEffect(() => {
    if (blocksData?.blocks && blocksData.blocks.length > 0 && blocksData.ranking_id) {
      logAction('blocks_viewed');
      console.log(`📊 Logged view action for ${blocksData.blocks.length} blocks (ranking: ${blocksData.ranking_id})`);
    }
  }, [blocksData?.ranking_id]);

  // Track dwell time for each block using IntersectionObserver
  useEffect(() => {
    if (!blocks.length) return;

    const observers = new Map<number, IntersectionObserver>();

    blocks.forEach((block, index) => {
      const blockElement = document.querySelector(`[data-block-index="${index}"]`);
      if (!blockElement) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              // Block entered viewport - start timer
              const startTime = Date.now();
              setDwellTimers(prev => new Map(prev).set(index, startTime));
            } else {
              // Block left viewport - log dwell time
              const startTime = dwellTimers.get(index);
              if (startTime) {
                const dwellMs = Date.now() - startTime;
                if (dwellMs > 500) { // Only log if viewed for more than 500ms
                  const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                  logAction('block_dwell', blockId, dwellMs, index + 1);
                  console.log(`📊 Logged dwell: ${block.name} (${dwellMs}ms)`);
                }
                setDwellTimers(prev => {
                  const next = new Map(prev);
                  next.delete(index);
                  return next;
                });
              }
            }
          });
        },
        { threshold: 0.5 }
      );

      observer.observe(blockElement);
      observers.set(index, observer);
    });

    return () => {
      observers.forEach(observer => observer.disconnect());
    };
  }, [blocks, blocksData?.ranking_id]);

  // Parallel enrichment: fetch "why go when closed" reasoning for closed venues
  useEffect(() => {
    if (!blocksData?.blocks || blocksData.blocks.length === 0) return;

    const closedVenues = blocksData.blocks.filter(block => 
      !block.isOpen && 
      !block.closed_venue_reasoning &&
      block.businessStatus
    );

    if (closedVenues.length === 0) return;

    console.log(`[Closed Venue Enrichment] Found ${closedVenues.length} closed venues, fetching reasoning in parallel...`);

    // Call API for each closed venue in parallel
    closedVenues.forEach(async (block) => {
      const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;

      // Skip if we already have reasoning for this venue
      if (enrichedReasonings.has(key)) return;

      try {
        const response = await fetch('/api/closed-venue-reasoning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venueName: block.name,
            category: block.category,
            address: block.address,
            businessHours: block.businessHours,
            strategyContext: persistentStrategy?.slice(0, 500) || 'none'
          })
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`[Closed Venue Enrichment] ✅ Got reasoning for ${block.name}: "${data.reasoning.slice(0, 60)}..."`);

          // Update state with new reasoning - this triggers a re-render
          setEnrichedReasonings(prev => new Map(prev).set(key, data.reasoning));
        }
      } catch (err) {
        console.warn(`[Closed Venue Enrichment] Failed for ${block.name}:`, err);
      }
    });
  }, [blocksData?.blocks, persistentStrategy]);

  // City search mutation
  const _citySearchMutation = useMutation({
    mutationFn: async (city: string) => {
      const response = await fetch(`/api/location/geocode/forward?city=${encodeURIComponent(city)}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to find city');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Set override coordinates in shared context (will update GlobalHeader too)
      if (setOverrideCoords) {
        setOverrideCoords({
          latitude: data.coordinates.lat,
          longitude: data.coordinates.lng,
          city: data.city,
          source: 'manual_city_search'
        });
      }
      toast({
        title: 'Location Updated',
        description: `Showing blocks for ${data.formattedAddress}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'City Not Found',
        description: error.message || 'Unable to find that city. Try a different format.',
        variant: 'destructive',
      });
    }
  });

  const _handleModelChange = (model: 'gemini' | 'gpt-5' | 'claude') => {
    setSelectedModel(model);
    // Set default parameter for each model
    if (model === 'gpt-5') {
      setModelParameter('low'); // reasoning_effort
    } else {
      setModelParameter('0.7'); // temperature
    }
  };

  const _clearManualCity = () => {
    if (setOverrideCoords) {
      setOverrideCoords(null);
    }
    toast({
      title: 'Using GPS Location',
      description: 'Switched back to your current GPS location.',
    });
  };

  const _toggleBlockSelection = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (!block) return;

    const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
    const isSelecting = !selectedBlocks.has(blockIndex);

    setSelectedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockIndex)) {
        next.delete(blockIndex);
      } else {
        next.add(blockIndex);
      }
      return next;
    });

    // Log selection action
    logAction(
      isSelecting ? 'block_selected' : 'block_deselected',
      blockId,
      undefined,
      blockIndex + 1
    );
    console.log(`📊 Logged ${isSelecting ? 'selection' : 'deselection'}: ${block.name} (rank ${blockIndex + 1})`);
  };

  const buildRoute = () => {
    if (selectedBlocks.size === 0) {
      toast({
        title: 'No Blocks Selected',
        description: 'Select at least one block to build your route.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Route Building',
      description: `Building optimized route with ${selectedBlocks.size} location${selectedBlocks.size > 1 ? 's' : ''}...`,
    });

    // TODO: Integrate with route optimization API
    console.log('Building route with blocks:', Array.from(selectedBlocks));
  };

  const clearSelections = () => {
    setSelectedBlocks(new Set());
    toast({
      title: 'Selections Cleared',
      description: 'All block selections have been removed.',
    });
  };

  // Text-to-speech handler - uses OpenAI natural voice (currently disabled in UI)
  const _handleReadStrategy = async () => {
    if (!persistentStrategy) return;

    if (isSpeaking) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsSpeaking(false);
      return;
    }

    try {
      setIsSpeaking(true);
      console.log('[TTS] Requesting audio synthesis for strategy...');

      // Call backend TTS endpoint
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: persistentStrategy })
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      // Get audio blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create or reuse audio element
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.src = audioUrl;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        toast({
          title: 'Playback Failed',
          description: 'Unable to play audio.',
          variant: 'destructive',
        });
      };

      // Play audio
      await audio.play();
      console.log('[TTS] ✅ Playing audio');
    } catch (err) {
      setIsSpeaking(false);
      console.error('[TTS] Error:', err);
      toast({
        title: 'Text-to-Speech Failed',
        description: err instanceof Error ? err.message : 'Unable to read strategy aloud.',
        variant: 'destructive',
      });
    }
  };

  // Get demand level badge
  const _getDemandBadge = (level?: string) => {
    if (level === 'high') {
      return (
        <Badge className="bg-green-100 text-green-700 border-0 text-xs">
          <TrendingUp className="w-2 h-2 mr-1" />
          High Demand
        </Badge>
      );
    }
    if (level === 'medium') {
      return (
        <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">
          Medium Demand
        </Badge>
      );
    }
    if (level === 'low') {
      return (
        <Badge className="bg-gray-100 text-gray-700 border-0 text-xs">
          Low Demand
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-24" data-testid="copilot-page">
      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-6">

        {/* Strategy Tab Content */}
        {activeTab === 'strategy' && (
          <>
        {/* Greeting/Holiday Banner - Using extracted component */}
        <GreetingBanner holiday={strategyData?.strategy?.holiday} />

        {/* Selection Controls */}
        {selectedBlocks.size > 0 && (
          <Card className="mb-6 border-2 border-blue-500" data-testid="selection-controls">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">
                    {selectedBlocks.size} block{selectedBlocks.size !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-sm text-gray-600">Ready to build your optimized route</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelections}
                    data-testid="button-clear-selections"
                  >
                    Clear All
                  </Button>
                  <Button
                    size="sm"
                    onClick={buildRoute}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="button-build-route"
                  >
                    <Navigation className="w-4 h-4 mr-2" />
                    Build Route
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Strategy Section - ALWAYS FIRST */}
        <div className="mb-6 space-y-4">
          <div className="sticky top-20 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 flex items-center justify-between border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-800">Current Strategy</h2>
            </div>
            {/* Static Feedback Button - Always Visible & Clickable */}
            <Button
              variant="ghost"
              size="sm"
              className="text-purple-600 hover:text-purple-700 hover:bg-purple-100 h-8 px-3 text-sm"
              onClick={() => setStrategyFeedbackOpen(true)}
              data-testid="button-strategy-feedback-static"
            >
              <MessageSquare className="w-4 h-4 mr-1" />
              Give Feedback
            </Button>
          </div>

          {/* Current Strategy Card */}
          {!coords ? (
            <Card className="bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 border-gray-300 shadow-md" data-testid="strategy-needs-gps">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">GPS Required for Strategy</p>
                    <p className="text-xs text-gray-600">Enable location to receive AI-powered strategic analysis</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : immediateStrategy ? (
            <Card className="bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-50 border-orange-300 shadow-md" data-testid="immediate-strategy-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-orange-100">
                    <Zap className="w-5 h-5 text-orange-600 flex-shrink-0" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-orange-900 mb-2">🎯 Where to Go NOW</p>
                    <p
                      className="text-sm text-gray-800 leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: immediateStrategy
                          .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-orange-800 font-semibold">$1</strong>')
                          .replace(/\n/g, '<br />')
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : strategyData?.status === 'failed' ? (
            <Card className="bg-gradient-to-br from-red-50 via-pink-50 to-red-50 border-red-300 shadow-md" data-testid="strategy-failed-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-red-100">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900 mb-1">❌ Strategy Generation Failed</p>
                    <p className="text-xs text-red-700">We couldn't generate a strategy this time. Please try again.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-blue-300 shadow-md" data-testid="strategy-pending-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-blue-600 animate-pulse flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-blue-900">⏳ Generating your strategy...</p>
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                        {loadingMessages.badge}
                      </Badge>
                    </div>
                    {/* Cycling detailed message */}
                    <p className="text-xs text-blue-700 mb-3 transition-opacity duration-300">
                      {loadingMessages.icon} {loadingMessages.text}
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-blue-700">
                        <span>Progress</span>
                        <span className="font-mono">{strategyProgress}%</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${Math.min(strategyProgress, 100)}%`
                          }}
                        />
                      </div>
                      <div className="space-y-1 mt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-blue-600 italic">
                            {loadingMessages.step}
                          </p>
                          {/* Time remaining estimate */}
                          {loadingMessages.timeRemaining && (
                            <p className="text-xs text-blue-500">
                              {loadingMessages.timeRemaining}
                            </p>
                          )}
                        </div>
                        {/* Sub-message dots indicator */}
                        <div className="flex gap-1 justify-center mt-1">
                          {Array.from({ length: loadingMessages.messageCount }).map((_, i) => (
                            <span
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                i === loadingMessages.currentIndex
                                  ? 'bg-blue-600 scale-125'
                                  : 'bg-blue-300'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Smart Blocks - Only render when we have data */}
        {blocks.length > 0 && (
          <div className="mb-6" id="blocks-section">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-semibold text-gray-800">Closest High-Earning Spots</h2>
                <Badge className="bg-purple-100 text-purple-700 border-0">
                  Smart Blocks
                </Badge>
              {metadata && (
                <>
                  <span className="text-sm text-gray-500">
                    {metadata.totalBlocks} location{metadata.totalBlocks !== 1 ? 's' : ''}
                  </span>
                  {metadata.validation?.status && (
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${
                        metadata.validation.status === 'ok' 
                          ? 'border-green-500 text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-400' 
                          : 'border-yellow-500 text-yellow-700 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-400'
                      }`}
                      data-testid="validation-badge"
                    >
                      {metadata.validation.status === 'ok' ? '✓ Validated' : '⚠ Validation Issues'}
                    </Badge>
                  )}
                  {metadata.processingTimeMs && (
                    <span className="text-xs text-gray-400">
                      {(metadata.processingTimeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

            {/* Loading State with Skeleton Cards */}
            {isLoading && (
            <div className="space-y-4" data-testid="loading-state">
              <Card className="p-8 border-blue-100 bg-blue-50/50">
                <div className="flex items-center gap-3 mb-4">
                  <RefreshCw className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-gray-800 font-semibold">
                      {pipelinePhase === 'starting' && 'Starting...'}
                      {pipelinePhase === 'resolving' && 'Examining location...'}
                      {pipelinePhase === 'analyzing' && 'Analyzing area...'}
                      {pipelinePhase === 'immediate' && 'Building strategy...'}
                      {pipelinePhase === 'venues' && 'AI finding venues...'}
                      {pipelinePhase === 'routing' && 'Calculating routes...'}
                      {pipelinePhase === 'places' && 'Fetching venue details...'}
                      {pipelinePhase === 'verifying' && 'Verifying events...'}
                      {pipelinePhase === 'enriching' && 'Enriching venue data...'}
                      {pipelinePhase === 'complete' && 'Loading venues and map...'}
                    </p>
                    <p className="text-gray-600 text-sm mb-3">
                      {pipelinePhase === 'starting' && 'Initializing AI pipeline...'}
                      {pipelinePhase === 'resolving' && 'Resolving your location and examining the area...'}
                      {pipelinePhase === 'analyzing' && 'Examining late night venues and evaluating conditions...'}
                      {pipelinePhase === 'immediate' && 'AI processing your area intel...'}
                      {pipelinePhase === 'venues' && 'GPT-5.2 selecting optimal venues near you...'}
                      {pipelinePhase === 'routing' && 'Google Routes API calculating drive times...'}
                      {pipelinePhase === 'places' && 'Google Places API fetching business hours...'}
                      {pipelinePhase === 'verifying' && 'Gemini AI verifying venue events...'}
                      {pipelinePhase === 'enriching' && 'Calculating distances, drive times, and rankings...'}
                      {pipelinePhase === 'complete' && 'Almost done! Loading venue cards and map...'}
                    </p>
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>
                        {pipelinePhase === 'starting' && 'Step 1/9: Starting'}
                        {pipelinePhase === 'resolving' && 'Step 2/9: Location'}
                        {pipelinePhase === 'analyzing' && 'Step 3/9: Research'}
                        {pipelinePhase === 'immediate' && 'Step 4/9: Strategy'}
                        {pipelinePhase === 'venues' && 'Step 5/9: Venue AI'}
                        {pipelinePhase === 'routing' && 'Step 6/9: Routes'}
                        {pipelinePhase === 'places' && 'Step 7/9: Details'}
                        {pipelinePhase === 'verifying' && 'Step 8/9: Verify'}
                        {pipelinePhase === 'enriching' && 'Step 6/9: Enrichment'}
                        {pipelinePhase === 'complete' && 'Step 9/9: Complete!'}
                      </span>
                      <span className="font-mono">{enrichmentProgress}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 rounded-full transition-all duration-500 ease-out"
                        style={{
                          width: `${enrichmentProgress}%`
                        }}
                      />
                    </div>
                    {/* Time remaining estimate */}
                    {timeRemainingText && pipelinePhase !== 'complete' && (
                      <p className="text-xs text-gray-500 text-center mt-2">
                        {timeRemainingText} remaining
                      </p>
                    )}
                  </div>
                </div>
              </Card>
              {/* Skeleton Cards */}
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="p-4 animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-3"></div>
                  <div className="h-4 bg-gray-100 rounded w-1/2 mb-4"></div>
                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div className="h-12 bg-gray-200 rounded"></div>
                    <div className="h-12 bg-gray-200 rounded"></div>
                    <div className="h-12 bg-gray-200 rounded"></div>
                  </div>
                  <div className="h-20 bg-gray-100 rounded"></div>
                </Card>
              ))}
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <Card className="p-8 border-red-200" data-testid="error-state">
              <div className="flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-8 h-8 text-red-600 mb-4" />
                <p className="text-gray-800 font-semibold mb-2">
                  {error instanceof Error && error.message.includes('timeout') 
                    ? 'Strategy Generation Timed Out' 
                    : 'Failed to Load Blocks'}
                </p>
                <p className="text-gray-600 text-sm mb-4">
                  {error instanceof Error && error.message.includes('timeout')
                    ? 'The AI took longer than 60 seconds to generate blocks. This usually means high API load. Please try again in a moment.'
                    : (error instanceof Error ? error.message : 'Unable to connect to AI engine')}
                </p>
                <Button onClick={() => refetch()} variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </Card>
          )}

          {/* No GPS State */}
          {!coords && !isLoading && (
            <Card className="p-8" data-testid="no-gps-state">
              <div className="flex flex-col items-center justify-center text-center">
                <MapPin className="w-8 h-8 text-gray-400 mb-4" />
                <p className="text-gray-800 font-semibold mb-2">GPS Location Required</p>
                <p className="text-gray-600 text-sm mb-4">
                  Enable location services to receive personalized recommendations
                </p>
                <Button onClick={refreshGPS} disabled={isUpdating}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
                  Enable GPS
                </Button>
              </div>
            </Card>
          )}

            {/* Bars Table - ML Training Data */}
            {blocks.length > 0 && <BarsTable blocks={blocks} />}

            {/* Blocks List */}
            {blocks.length > 0 && (
            <div className="space-y-4" data-testid="blocks-list">
              {blocks.map((block, index) => {
                const _isSelected = selectedBlocks.has(index);

                // Gradient colors based on ranking icons
                let cardGradient = 'bg-white border-gray-200';
                if (index <= 1) {
                  // 🔥 HIGH VALUE - Red/Orange gradient
                  cardGradient = 'bg-gradient-to-br from-red-50 via-orange-50 to-amber-50 border-orange-300';
                } else if (index <= 3) {
                  // ⭐ GOOD OPPORTUNITY - Yellow/Gold gradient
                  cardGradient = 'bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 border-yellow-300';
                } else if (Number(block.estimated_distance_miles ?? 0) <= 5) {
                  // 📍 NEARBY OPTION - Blue gradient
                  cardGradient = 'bg-gradient-to-br from-blue-50 via-cyan-50 to-sky-50 border-blue-300';
                } else {
                  // 💡 STRATEGIC - Purple gradient
                  cardGradient = 'bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 border-purple-300';
                }

                return (
                  <Card
                    key={index}
                    className={`border-2 shadow-md hover:shadow-xl transition-all ${cardGradient}`}
                    data-testid={`block-${index}`}
                    data-block-index={index}
                  >
                    <CardContent className="p-4">
                      {/* Header with Name and Priority Badge */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start gap-2 flex-1">
                          <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-gray-900 text-base">
                                {block.name}
                              </h3>
                              {block.isOpen === true && (
                                <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">
                                  Open
                                </Badge>
                              )}
                              {block.isOpen === false && (
                                <Badge className="bg-red-100 text-red-700 border-red-300 text-xs">
                                  Closed
                                </Badge>
                              )}
                              {block.isOpen !== true && block.isOpen !== false && block.type === 'staging' && (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-xs">
                                  Staging (open curb)
                                </Badge>
                              )}
                              {block.hasEvent && block.eventBadge && (
                                <Badge className="bg-gradient-to-r from-pink-100 to-purple-200 text-purple-700 border-purple-300 text-xs font-normal">
                                  <span className="text-xs">🎫 Event: {block.eventBadge}</span>
                                </Badge>
                              )}
                            </div>
                            {block.address && (
                              <p className="text-sm text-gray-500 mt-0.5">{block.address}</p>
                            )}
                          </div>
                        </div>
                        {block.demandLevel === 'high' && (
                          <Badge className="bg-red-100 text-red-700 border-0 text-xs px-2 py-0.5">
                            high priority
                          </Badge>
                        )}
                      </div>

                      {/* Priority Badge & Metrics Row */}
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div className="text-center">
                          {(() => {
                            const distance = Number(block.estimated_distance_miles ?? 0);
                            const isNearby = distance <= 5;

                            if (index <= 1) {
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="text-2xl mb-1">🔥</div>
                                  <div className="text-sm font-bold text-orange-600">HIGH VALUE</div>
                                  <div className="text-xs text-gray-500">Top ranked</div>
                                </div>
                              );
                            } else if (index <= 3) {
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="text-2xl mb-1">⭐</div>
                                  <div className="text-sm font-bold text-yellow-600">GOOD OPPORTUNITY</div>
                                  <div className="text-xs text-gray-500">Recommended</div>
                                </div>
                              );
                            } else if (isNearby) {
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="text-2xl mb-1">📍</div>
                                  <div className="text-sm font-bold text-blue-600">NEARBY OPTION</div>
                                  <div className="text-xs text-gray-500">Close proximity</div>
                                </div>
                              );
                            } else {
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="text-2xl mb-1">💡</div>
                                  <div className="text-sm font-bold text-purple-600">STRATEGIC</div>
                                  <div className="text-xs text-gray-500">Consider timing</div>
                                </div>
                              );
                            }
                          })()}
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-700">
                            {Number(block.estimated_distance_miles ?? 0).toFixed(1)} mi
                            {block.distanceSource === "haversine_fallback" && (
                              <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">est.</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            est drive time {Math.round(Number(block.driveTimeMinutes ?? block.estimatedWaitTime ?? 0))} min
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">
                            {block.surge ?? (block.demandLevel === 'high' ? '1.5' : block.demandLevel === 'medium' ? '1.3' : '1.0')}x
                          </div>
                          <div className="text-xs text-gray-500">Surge</div>
                        </div>
                      </div>

                      {/* Not Worth It Ribbon */}
                      {block.not_worth && (
                        <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3" data-testid="not-worth-ribbon">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <p className="text-sm font-semibold text-red-900">
                              Not worth it ({block.value_per_min?.toFixed(2)}/min)
                            </p>
                          </div>
                        </div>
                      )}

                      {/* AI Badge & Business Status */}
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                          🤖 AI Generated
                        </Badge>
                        <span className="text-xs text-gray-500">Live recommendation</span>
                      </div>

                      {/* Business Hours */}
                      {block.businessHours && (
                        <div className="flex items-center gap-2 mb-3 text-sm">
                          <Clock className="w-4 h-4 text-blue-600" />
                          <span className="text-gray-700">
                            {block.businessHours}
                          </span>
                        </div>
                      )}

                      {/* Closed Venue Strategic Reasoning - Highlighted */}
                      {!block.isOpen && block.closed_venue_reasoning && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <h4 className="text-sm font-semibold text-amber-900 mb-1">Why Go When Closed?</h4>
                              <p className="text-sm text-amber-800">{block.closed_venue_reasoning}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Closed Venue Without Event or Reasoning - Show Fallback */}
                      {!block.isOpen && !block.hasEvent && !block.closed_venue_reasoning && (
                        <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 mb-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <h4 className="text-sm font-semibold text-gray-700 mb-1">Closed Now</h4>
                              <p className="text-sm text-gray-600">
                                This venue is currently closed. Recommended as a strategic staging location near other active destinations or due to high traffic patterns in the area.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Staging Area */}
                      {block.stagingArea && (
                        <div className="bg-gray-50 rounded-lg p-3 mb-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-600" />
                              <h4 className="text-sm font-semibold text-gray-900">Staging Area</h4>
                              <Badge className="bg-yellow-400 text-yellow-900 border-0 text-xs px-2 py-0">
                                {block.stagingArea.type}
                              </Badge>
                            </div>
                            {block.stagingArea.lat && block.stagingArea.lng && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-blue-400 text-blue-600 hover:bg-blue-50"
                                onClick={() => {
                                  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${block.stagingArea.lat},${block.stagingArea.lng}`;
                                  window.open(mapsUrl, '_blank');
                                }}
                                data-testid="button-navigate-staging"
                              >
                                <Navigation className="w-4 h-4 mr-1" />
                                Navigate
                              </Button>
                            )}
                          </div>
                          <div className="ml-6 space-y-1">
                            <p className="text-sm font-medium text-gray-900">{block.stagingArea.name}</p>
                            <p className="text-xs text-gray-600">{block.stagingArea.address}</p>
                            <div className="flex items-center gap-1 mt-2">
                              <Clock className="w-3 h-3 text-gray-500" />
                              <p className="text-xs text-gray-600">{block.stagingArea.walkTime}</p>
                            </div>
                            <p className="text-xs text-gray-500 italic">{block.stagingArea.parkingTip}</p>
                          </div>
                        </div>
                      )}

                      {/* Pro Tips */}
                      {block.proTips && block.proTips.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">Pro Tips:</h4>
                          <ul className="space-y-1 ml-1">
                            {block.proTips.map((tip, tipIndex) => {
                              // Match both formats: "Pickup zone:" or "Pickup Zone Tip:"
                              const patterns = [
                                { regex: /^Pickup zone:/i, label: 'Pickup Zone:' },
                                { regex: /^Routing:/i, label: 'Routing:' },
                                { regex: /^Positioning:/i, label: 'Positioning:' },
                                { regex: /^Pickup Zone Tip:/i, label: 'Pickup Zone Tip:' },
                                { regex: /^Routing Tip:/i, label: 'Routing Tip:' },
                                { regex: /^Positioning Tip:/i, label: 'Positioning Tip:' }
                              ];

                              let formattedTip = tip;
                              let label = '';

                              for (const pattern of patterns) {
                                const match = tip.match(pattern.regex);
                                if (match) {
                                  label = pattern.label;
                                  formattedTip = tip.replace(match[0], '').trim();
                                  break;
                                }
                              }

                              return (
                                <li key={tipIndex} className="text-sm text-gray-600 flex items-start gap-2">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>
                                    {label && <span className="font-semibold text-gray-900">{label} </span>}
                                    {formattedTip}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Bottom Actions */}
                      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => {
                              setFeedbackModal({
                                isOpen: true,
                                sentiment: 'up',
                                block,
                                blockIndex: index,
                              });
                            }}
                            data-testid={`button-thumbs-up-${index}`}
                          >
                            <ThumbsUp className="w-4 h-4 mr-1" />
                            {block.up_count ? block.up_count : ''}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setFeedbackModal({
                                isOpen: true,
                                sentiment: 'down',
                                block,
                                blockIndex: index,
                              });
                            }}
                            data-testid={`button-thumbs-down-${index}`}
                          >
                            <ThumbsDown className="w-4 h-4 mr-1" />
                            {block.down_count ? block.down_count : ''}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => {
                              const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                              logAction('navigate_google_maps', blockId, undefined, index + 1);
                              window.open(`https://www.google.com/maps/dir/?api=1&destination=${block.coordinates.lat},${block.coordinates.lng}`, '_blank');
                            }}
                            data-testid={`button-navigate-maps-${index}`}
                          >
                            <Navigation className="w-4 h-4 mr-1" />
                            Maps
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gray-300"
                            onClick={() => {
                              const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                              logAction('navigate_apple_maps', blockId, undefined, index + 1);
                              window.open(`https://maps.apple.com/?daddr=${block.coordinates.lat},${block.coordinates.lng}`, '_blank');
                            }}
                            data-testid={`button-navigate-apple-${index}`}
                          >
                            <MapPin className="w-4 h-4 mr-1" />
                            Apple
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* AI Strategy Coach - Shows whenever we have coords (early engagement, doesn't require snapshotData) */}
        {coords && (
          <div className="mb-6" data-testid="ai-coach-section">
            <div className="sticky top-20 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-semibold text-gray-800">AI Strategy Coach</h2>
                {!persistentStrategy && (
                  <Badge variant="secondary" className="text-xs">
                    Strategy Generating...
                  </Badge>
                )}
              </div>
              <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">
                Live Chat
              </Badge>
            </div>
            <div className="mt-4">
              <CoachChat 
                userId={localStorage.getItem('vecto_user_id') || 'default'}
                snapshotId={lastSnapshotId || undefined}
                strategyId={strategyData?.strategy_id || undefined}
                strategy={persistentStrategy}
                snapshot={snapshotData}
                blocks={blocks}
                strategyReady={!!persistentStrategy}
              />
            </div>
          </div>
        )}

        {/* Smart Blocks Pipeline Status - Shows after Coach */}
        {coords && (
          <div className="mb-6">
            <SmartBlocksStatus
              strategyReady={strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks'}
              isStrategyFetching={isStrategyFetching}
              hasBlocks={blocks.length > 0}
              isBlocksLoading={isLoading || !!blocksData?.isBlocksGenerating}
              blocksError={error as Error | null}
              timeElapsedMs={strategyData?.timeElapsedMs}
              snapshotId={lastSnapshotId}
              enrichmentProgress={enrichmentProgress}
              enrichmentPhase={enrichmentPhase}
              pipelinePhase={pipelinePhase}
            />
          </div>
        )}
          </>
        )}

        {/* Briefing Tab Content - Data persists across tab switches */}
        {activeTab === 'briefing' && (
          <div data-testid="briefing-section" className="mb-24">
            <BriefingTab
              snapshotId={lastSnapshotId || undefined}
              weatherData={weatherData}
              trafficData={trafficData}
              newsData={newsData}
              eventsData={eventsData}
              schoolClosuresData={schoolClosuresData}
              airportData={airportData}
              consolidatedStrategy={persistentStrategy}
            />
          </div>
        )}

        {/* Map Tab Content - Interactive venue map with traffic */}
        {activeTab === 'map' && (
          <div data-testid="map-section" className="mb-24">
            {coords && lastSnapshotId ? (
              <MapTab
                driverLat={coords.latitude}
                driverLng={coords.longitude}
                venues={blocks.map((block, idx) => ({
                  id: `${idx}`,
                  name: block.name,
                  lat: block.coordinates.lat,
                  lng: block.coordinates.lng,
                  distance_miles: block.estimated_distance_miles,
                  drive_time_min: block.driveTimeMinutes || block.estimatedWaitTime,
                  est_earnings_per_ride: block.estimated_earnings,
                  rank: idx + 1,
                  value_grade: block.value_grade,
                }))}
                events={eventsData?.events?.map((e: Record<string, unknown>) => ({
                  title: e.title as string,
                  venue: e.venue as string | undefined,
                  address: e.address as string | undefined,
                  event_date: e.event_date as string | undefined,
                  event_time: e.event_time as string | undefined,
                  event_end_time: e.event_end_time as string | undefined,
                  latitude: e.latitude as number | undefined,
                  longitude: e.longitude as number | undefined,
                  impact: e.impact as 'high' | 'medium' | 'low' | undefined,
                  subtype: e.subtype as string | undefined,
                })) || []}
                snapshotId={lastSnapshotId}
                isLoading={isLoading}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <MapPin className="w-12 h-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-gray-700">Map & Venues</h3>
                <p className="text-gray-500 mt-2">Generate recommendations to view them on the map</p>
              </div>
            )}
          </div>
        )}

        {/* Rideshare Intelligence Tab Content */}
        {activeTab === 'rideshare' && (
          <div data-testid="rideshare-section">
            <RideshareIntelTab />
          </div>
        )}

        {/* Donation/About Tab Content */}
        {activeTab === 'donation' && (
          <div data-testid="donation-section" className="mb-24">
            <DonationTab userId={localStorage.getItem('vecto_user_id') || 'default'} />
          </div>
        )}

        {/* Bar Tab - Premium Venues (Independent of Strategy Pipeline) */}
        {activeTab === 'venues' && coords && (
          <div data-testid="bar-tab-section">
            <BarTab
              latitude={coords.latitude}
              longitude={coords.longitude}
              city={locationContext?.city || null}
              state={locationContext?.state || null}
              timezone={locationContext?.timeZone || null}
              isLocationResolved={locationContext?.isLocationResolved || false}
              getAuthHeader={getAuthHeader}
            />
          </div>
        )}

        {activeTab === 'venues' && !coords && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Wine className="w-12 h-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700">Location Required</h3>
            <p className="text-gray-500 mt-2">Enable location services to discover nearby bars and venues</p>
          </div>
        )}

      </div>

      {/* Bottom Tab Navigation - Using extracted component */}
      <BottomTabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Venue Feedback Modal */}
      <FeedbackModal
        isOpen={feedbackModal.isOpen}
        onClose={() => setFeedbackModal({ isOpen: false, sentiment: null, block: null, blockIndex: null })}
        initialSentiment={feedbackModal.sentiment}
        venueName={feedbackModal.block?.name}
        placeId={feedbackModal.block?.placeId}
        snapshotId={lastSnapshotId || undefined}
        rankingId={blocksData?.ranking_id}
        userId={localStorage.getItem('vecto_user_id') || 'default'}
        onSuccess={(sentiment) => {
          // Optimistically update the block counts
          if (feedbackModal.block && feedbackModal.blockIndex !== null) {
            const updatedBlocks = [...blocks];
            const block = updatedBlocks[feedbackModal.blockIndex];
            if (sentiment === 'up') {
              block.up_count = (block.up_count || 0) + 1;
            } else {
              block.down_count = (block.down_count || 0) + 1;
            }
            // This will trigger a re-render with updated counts
          }
        }}
      />

      {/* App Feedback Modal */}
      <FeedbackModal
        isOpen={strategyFeedbackOpen}
        onClose={() => setStrategyFeedbackOpen(false)}
        initialSentiment={null}
        snapshotId={lastSnapshotId || undefined}
        isAppFeedback={true}
      />
    </div>
  );
};

export default CoPilot;