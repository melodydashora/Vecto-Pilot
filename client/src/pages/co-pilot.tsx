/**
 * Vecto Pilot™ - Co-Pilot
 * 
 * Real-time AI-powered staging location recommendations with block selection.
 * Integrates with smart-blocks-enhanced API for time-aware zone suggestions.
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  MapPin, 
  Navigation, 
  TrendingUp, 
  Clock, 
  Sparkles,
  Activity,
  CheckCircle2,
  Zap,
  AlertCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Info,
  PartyPopper
} from 'lucide-react';
import { useLocation } from '@/contexts/location-context-clean';
import { useToast } from '@/hooks/use-toast';
import { FeedbackModal } from '@/components/FeedbackModal';
import CoachChat from '@/components/CoachChat';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SmartBlock {
  name: string;
  description?: string;
  address?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  estimatedWaitTime?: number;
  estimatedEarningsPerRide?: number;
  estimated_earnings?: number;
  potential?: number;
  estimated_distance_miles?: number;
  distanceSource?: string;
  driveTimeMinutes?: number;
  surge?: number;
  type?: string;
  // Value per minute fields
  value_per_min?: number;
  value_grade?: string;
  not_worth?: boolean;
  demandLevel?: string;
  category?: string;
  businessHours?: string;
  isOpen?: boolean;
  businessStatus?: string;
  placeId?: string;
  closedButStillGood?: string;
  closed_venue_reasoning?: string;
  hasEvent?: boolean;
  eventBadge?: string;
  eventSummary?: string;
  eventImpact?: string;
  stagingArea?: {
    type: string;
    name: string;
    address: string;
    walkTime: string;
    parkingTip: string;
  };
  proTips?: string[];
  up_count?: number;
  down_count?: number;
}

interface BlocksResponse {
  now: string;
  timezone: string;
  strategy?: string;
  blocks: SmartBlock[];
  ranking_id?: string;
  path_taken?: string;
  refined?: boolean;
  timing?: {
    scoring_ms?: number;
    planner_ms?: number;
    total_ms?: number;
    timed_out?: boolean;
    budget_ms?: number;
  };
  metadata: {
    totalBlocks: number;
    processingTimeMs: number;
    modelRoute?: string;
    validation?: {
      status: string;
      flags?: string[];
    };
  };
}

const CoPilot: React.FC = () => {
  const locationContext = useLocation();
  const { toast } = useToast();
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const [showOffPeak, setShowOffPeak] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState<'auto' | 'near' | 'far'>('auto');
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'gpt-5' | 'claude' | null>(null);
  const [modelParameter, setModelParameter] = useState<string>('0.7');
  const [dwellTimers, setDwellTimers] = useState<Map<number, number>>(new Map());
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false); // Manual test trigger
  const [fastTacticalMode, setFastTacticalMode] = useState<boolean>(() => {
    return localStorage.getItem('vecto_fast_tactical_mode') === 'true';
  });
  const [persistentStrategy, setPersistentStrategy] = useState<string | null>(() => {
    return localStorage.getItem('vecto_persistent_strategy');
  });
  const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(() => {
    return localStorage.getItem('vecto_strategy_snapshot_id');
  });
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

  // Get coords from shared location context (same as GlobalHeader)
  const gpsCoords = locationContext?.currentCoords;
  const refreshGPS = locationContext?.refreshGPS;
  const isUpdating = locationContext?.isLoading || false;
  
  // Get override coords from shared context (synced with GlobalHeader)
  const overrideCoords = locationContext?.overrideCoords;
  const setOverrideCoords = locationContext?.setOverrideCoords;
  
  // Use override coords if available, otherwise GPS
  const coords = overrideCoords || gpsCoords;
  
  // Listen for snapshot-saved event to gate blocks query
  useEffect(() => {
    const handleSnapshotSaved = (e: any) => {
      const snapshotId = e.detail?.snapshotId;
      if (snapshotId) {
        console.log("🎯 Co-Pilot: Snapshot ready, enabling blocks query:", snapshotId);
        setLastSnapshotId(snapshotId);
      }
    };
    window.addEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
    
    return () => window.removeEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
  }, [coords, lastSnapshotId]);

  // Clear persistent strategy when new coords received (before snapshot creation)
  useEffect(() => {
    const handleStrategyCleared = () => {
      console.log("🧹 Strategy cleared event received - updating UI state");
      setPersistentStrategy(null);
      setStrategySnapshotId(null);
    };
    
    const handleManualRefresh = () => {
      console.log("🔄 Manual refresh triggered");
      // Location context will clear strategy when coords arrive
    };
    
    const handleLocationPermission = () => {
      console.log("📍 Location permission granted");
      setPersistentStrategy(null);
      setStrategySnapshotId(null);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
    };
    
    window.addEventListener("vecto-strategy-cleared", handleStrategyCleared);
    window.addEventListener("vecto-manual-refresh", handleManualRefresh);
    window.addEventListener("vecto-location-permission", handleLocationPermission);
    
    return () => {
      window.removeEventListener("vecto-strategy-cleared", handleStrategyCleared);
      window.removeEventListener("vecto-manual-refresh", handleManualRefresh);
      window.removeEventListener("vecto-location-permission", handleLocationPermission);
    };
  }, []);

  // Fetch strategy from database when we have a new snapshot
  const { data: strategyData, isFetching: isStrategyFetching } = useQuery({
    queryKey: ['/api/blocks/strategy', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId || lastSnapshotId === 'live-snapshot') return null;
      
      const response = await fetch(`/api/blocks/strategy/${lastSnapshotId}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      console.log(`[strategy-poll] Status: ${data.status}, Time elapsed: ${data.timeElapsedMs}ms`);
      // Attach the snapshot ID to the response for validation
      return { ...data, _snapshotId: lastSnapshotId };
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    refetchInterval: (query) => {
      // Poll every 2 seconds if strategy is still pending (was checking wrong field!)
      const status = query.state.data?.status;
      const isReady = status === 'ok' || status === 'ok_partial';
      
      if (isReady) {
        console.log('[strategy-poll] ✅ Strategy ready, stopping poll');
        return false; // Stop polling
      }
      
      console.log(`[strategy-poll] ⏳ Status: ${status}, continuing poll...`);
      return 2000; // Poll every 2 seconds
    },
    // Critical: Prevent stale data from previous snapshots
    staleTime: 0,
    gcTime: 0,
  });

  // Clear strategy if snapshot ID changes
  useEffect(() => {
    if (lastSnapshotId && lastSnapshotId !== 'live-snapshot' && strategySnapshotId && lastSnapshotId !== strategySnapshotId) {
      console.log(`🔄 New snapshot detected (${lastSnapshotId}), clearing old strategy from ${strategySnapshotId}`);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      setPersistentStrategy(null);
      setStrategySnapshotId(null);
    }
  }, [lastSnapshotId, strategySnapshotId]);

  // Update persistent strategy when new strategy arrives
  useEffect(() => {
    const consolidatedStrategy = strategyData?.strategy?.consolidated;
    if (consolidatedStrategy && consolidatedStrategy !== persistentStrategy) {
      console.log("📝 New strategy received, persisting to localStorage");
      localStorage.setItem('vecto_persistent_strategy', consolidatedStrategy);
      localStorage.setItem('vecto_strategy_snapshot_id', lastSnapshotId || '');
      setPersistentStrategy(consolidatedStrategy);
      setStrategySnapshotId(lastSnapshotId);
    }
  }, [strategyData, lastSnapshotId, persistentStrategy]);

  // NEW DIRECTIVE: 0-15 min base band, expand to 20-30 if needed for Top6
  // Auto mode: Server decides based on expand policy
  // Near/Far modes: User explicitly locks to band
  const distanceRange = {
    min: distanceFilter === 'near' ? 0 : distanceFilter === 'far' ? 20 : 0,
    max: distanceFilter === 'near' ? 15 : distanceFilter === 'far' ? 30 : 30
  };

  // Fetch smart blocks - server returns Top6 based on staging coordinate
  // GATED on snapshot ready to prevent "Unknown city" race condition
  const { data: blocksData, isLoading, error, refetch } = useQuery<BlocksResponse>({
    // Note: selectedModel and modelParameter NOT in queryKey to avoid cancelling previous requests during testing
    queryKey: ['/api/blocks', coords?.latitude, coords?.longitude, distanceFilter, locationContext.locationSessionId, lastSnapshotId],
    queryFn: async () => {
      console.log('[blocks-query] Starting blocks fetch for snapshot:', lastSnapshotId);
      if (!coords) throw new Error('No GPS coordinates');
      
      // 3min 50s timeout for Triad orchestrator (Claude 15s + GPT-5 120s + Gemini 20s + buffer)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 230000); // 230s = 3min 50s with buffer
      
      try {
        const headers: HeadersInit = lastSnapshotId ? { 'X-Snapshot-Id': lastSnapshotId } : {};
        
        // PRODUCTION AUTO-ROUTER: Use merged strategy (GPT-5 → Gemini → Claude)
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
          // Production: Choose between Fast Tactical Path or Full Triad
          const useFastPath = fastTacticalMode;
          const endpoint = useFastPath ? '/api/blocks/fast' : '/api/blocks';
          
          // Deterministic idempotency key per snapshot to collapse duplicate requests
          const idemKey = lastSnapshotId ? `POST:${endpoint}:${lastSnapshotId}` : undefined;
          
          // Uses fetch for AbortController timeout + custom headers (x-idempotency-key, X-Snapshot-Id)
          const response = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              ...(idemKey ? { 'x-idempotency-key': idemKey } : {}),
              ...headers
            },
            body: JSON.stringify({
              userId: localStorage.getItem('vecto_user_id') || 'default',
              origin: {
                lat: coords.latitude,
                lng: coords.longitude
              }
            })
          });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch strategy: ${errorText}`);
          }
          
          // Transform response to match existing interface
          const data = await response.json();
          console.log('🔍 Raw API response:', data);
          console.log('🔍 First block raw:', data.blocks?.[0]);
          
          const transformed = {
            now: data.generatedAt || new Date().toISOString(),
            timezone: 'America/Chicago',
            strategy: data.strategy_for_now,
            path_taken: data.path_taken,
            refined: data.refined,
            timing: data.timing,
            blocks: data.blocks?.map((v: any) => {
              console.log('🔄 Transforming block:', v.name, {
                estimated_distance_miles: v.estimated_distance_miles,
                driveTimeMinutes: v.driveTimeMinutes,
                distanceSource: v.distanceSource,
                value_per_min: v.value_per_min,
                value_grade: v.value_grade
              });
              
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
                proTips: v.proTips || v.pro_tips || []
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
          
          console.log('✅ Transformed blocks:', transformed.blocks);
          return transformed;
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Request timed out - Claude is taking longer than expected');
        }
        throw err;
      }
    },
    // AUTO-RUN when GPS + snapshot ready + strategy ready - keep spinning until success
    // CRITICAL GATING:
    // 1. Strategy must be written to DB with status='ok' (not 'pending', 'failed', etc.)
    // 2. Strategy must be for the CURRENT snapshot ID (prevent stale data races)
    // 3. Don't run while strategy is fetching (initial load OR polling)
    // This ensures blocks query ONLY runs after strategy is persisted in DB with proper foreign key
    enabled: (() => {
      const hasCoords = !!coords;
      const hasSnapshot = !!lastSnapshotId;
      const strategyReady = strategyData?.status === 'ok';
      const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;
      
      const shouldEnable = hasCoords && hasSnapshot && !isStrategyFetching && strategyReady && snapshotMatches;
      
      console.log('[blocks-query] 🔍 GATING CHECK:', {
        hasCoords,
        hasSnapshot,
        lastSnapshotId,
        isStrategyFetching,
        strategyStatus: strategyData?.status,
        strategyReady,
        strategySnapshotId: strategyData?._snapshotId,
        snapshotMatches,
        '⚠️ BLOCKED_REASON': !shouldEnable ? (!hasCoords ? 'NO_COORDS' : !hasSnapshot ? 'NO_SNAPSHOT' : isStrategyFetching ? 'STRATEGY_FETCHING' : !strategyReady ? 'STRATEGY_NOT_READY' : !snapshotMatches ? 'SNAPSHOT_MISMATCH' : 'UNKNOWN') : 'NONE',
        shouldEnable
      });
      
      return shouldEnable;
    })(), // Auto-start when coordinates, snapshot, and DB-confirmed strategy are available
    refetchInterval: false, // No periodic auto-refresh (only on demand)
    retry: (failureCount, error: any) => {
      // Stop retrying if we got a timeout (504)
      if (error?.message?.includes('504') || error?.message?.includes('timeout')) {
        console.error('[co-pilot] Strategy generation timed out, stopping retries');
        return false;
      }
      // Otherwise retry up to 12 times (max ~60 seconds total with backoff)
      return failureCount < 12;
    },
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 10000), // Exponential backoff: 2s, 4s, 8s, 10s max
  });

  useEffect(() => {
    if (error) {
      toast({
        title: 'Failed to Load Recommendations',
        description: 'Unable to fetch AI-powered blocks. Check your connection.',
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  // Log action to backend with idempotency key
  const logAction = async (action: string, blockId?: string, dwellMs?: number, fromRank?: number) => {
    try {
      const ranking_id = blocksData?.ranking_id || 'unknown';
      const timestamp = new Date().toISOString();
      const idempotencyKey = `${ranking_id}:${action}:${blockId || 'na'}:${timestamp}`;
      
      // Uses fetch for custom X-Idempotency-Key header
      await fetch('/api/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          ranking_id: ranking_id !== 'unknown' ? ranking_id : null,
          action,
          block_id: blockId || null,
          dwell_ms: dwellMs || null,
          from_rank: fromRank || null,
          user_id: localStorage.getItem('vecto_user_id') || 'default',
        }),
      });
    } catch (err) {
      console.warn('[Co-Pilot] Failed to log action:', err);
    }
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
  
  const metadata = blocksData?.metadata;
  const tacticalSummary = (blocksData as any)?.tactical_summary;
  const bestStagingLocation = (blocksData as any)?.best_staging_location;

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
  const citySearchMutation = useMutation({
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

  const handleModelChange = (model: 'gemini' | 'gpt-5' | 'claude') => {
    setSelectedModel(model);
    // Set default parameter for each model
    if (model === 'gpt-5') {
      setModelParameter('low'); // reasoning_effort
    } else {
      setModelParameter('0.7'); // temperature
    }
  };

  const clearManualCity = () => {
    if (setOverrideCoords) {
      setOverrideCoords(null);
    }
    toast({
      title: 'Using GPS Location',
      description: 'Switched back to your current GPS location.',
    });
  };

  const toggleBlockSelection = (blockIndex: number) => {
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

  // Get demand level badge
  const getDemandBadge = (level?: string) => {
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
        {/* Live Status Banner */}
        <div className="mb-6 flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-800">Top Earning Spots</h2>
            <Badge variant="outline" className="border-green-500 text-green-600">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
              Live · Ranked by $/Mile
            </Badge>
            {blocksData?.path_taken && (
              <Badge 
                variant="outline" 
                className={blocksData.path_taken === 'refined' 
                  ? "border-purple-500 text-purple-600 bg-purple-50" 
                  : "border-blue-500 text-blue-600 bg-blue-50"}
              >
                <Zap className="w-3 h-3 mr-1" />
                {blocksData.path_taken === 'refined' ? 'AI Refined' : 'Quick Picks'}
              </Badge>
            )}
            {blocksData?.timing && (
              <span className="text-xs text-gray-500">
                {blocksData.timing.total_ms}ms
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newMode = !fastTacticalMode;
              setFastTacticalMode(newMode);
              localStorage.setItem('vecto_fast_tactical_mode', String(newMode));
              toast({
                title: newMode ? 'Fast Tactical Mode Enabled' : 'Full Triad Mode Enabled',
                description: newMode ? 'Using Quick Picks with AI reranking (sub-7s)' : 'Using full AI strategic pipeline',
              });
            }}
            data-testid="button-toggle-fast-mode"
          >
            <Zap className="w-4 h-4 mr-2" />
            {fastTacticalMode ? 'Fast Mode' : 'Full Mode'}
          </Button>
        </div>

        {/* Holiday Banner */}
        {strategyData?.strategy?.holiday && (
          <Card className="mb-6 border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 shadow-lg" data-testid="holiday-banner">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100">
                  <PartyPopper className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-amber-900 text-lg">
                    🎉 Happy {strategyData.strategy.holiday}!
                  </p>
                  <p className="text-sm text-amber-800">
                    Holiday demand patterns in effect - expect increased airport traffic and surge pricing opportunities
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
              <h2 className="text-lg font-semibold text-gray-800">Strategy</h2>
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
          ) : persistentStrategy ? (
            <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 shadow-md" data-testid="persistent-strategy-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-purple-900">Strategic Overview</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-white">
                          Auto-Generated
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{persistentStrategy}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-blue-300 shadow-md" data-testid="strategy-pending-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-900 mb-1">AI Strategy Generating...</p>
                    <p className="text-xs text-blue-700 mb-3">analyzing your location and conditions</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-blue-700">
                        <span>Time Elapsed</span>
                        <span className="font-mono">{strategyData?.timeElapsedMs ? Math.round(strategyData.timeElapsedMs / 1000) : 0}s / 60s</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                          style={{ 
                            width: strategyData?.timeElapsedMs ? `${Math.min((strategyData.timeElapsedMs / 60000) * 100, 100)}%` : '0%'
                          }}
                        />
                      </div>
                      <p className="text-xs text-blue-600 italic">
                        {strategyData?.waitFor && strategyData.waitFor.length > 0 
                          ? `Waiting for: ${strategyData.waitFor.join(', ')}`
                          : 'Processing...'
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* AI Strategy Coach - GPT-5 Chat Interface */}
        {coords && persistentStrategy && (
          <div className="mb-6" data-testid="ai-coach-section">
            <div className="sticky top-20 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-semibold text-gray-800">AI Strategy Coach</h2>
              </div>
              <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">
                Live Chat
              </Badge>
            </div>
            <div className="mt-4">
              <CoachChat 
                userId={localStorage.getItem('vecto_user_id') || 'default'}
                snapshotId={lastSnapshotId || undefined}
                strategy={persistentStrategy}
                blocks={blocks}
              />
            </div>
          </div>
        )}

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
                    <p className="text-gray-800 font-semibold">AI is analyzing your area...</p>
                    <p className="text-gray-600 text-sm mb-3">Finding optimal venues with real-time data · This may take up to 3 minutes</p>
                    <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 rounded-full"
                        style={{
                          animation: 'progressBar 180s linear forwards',
                        }}
                      />
                    </div>
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

            {/* Blocks List */}
            {blocks.length > 0 && (
            <div className="space-y-4" data-testid="blocks-list">
              {blocks.map((block, index) => {
                const isSelected = selectedBlocks.has(index);

                // Determine card gradient based on value grade
                const cardGradient = block.value_grade === 'A' 
                  ? 'bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 border-emerald-300' 
                  : block.value_grade === 'B'
                  ? 'bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-50 border-blue-300'
                  : block.value_grade === 'C'
                  ? 'bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 border-purple-300'
                  : 'bg-gradient-to-br from-gray-50 via-slate-50 to-zinc-50 border-gray-300';

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
                              {block.isOpen !== true && block.isOpen !== false && block.type !== 'staging' && (
                                <Badge className="bg-gray-100 text-gray-700 border-gray-300 text-xs">
                                  Unknown
                                </Badge>
                              )}
                              {block.hasEvent && block.eventBadge && (
                                <Badge className="bg-purple-100 text-purple-700 border-purple-300 text-xs">
                                  {block.eventBadge}
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

                      {/* Metrics Row */}
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            ${Number(block.estimatedEarningsPerRide ?? block.estimated_earnings ?? block.potential ?? 0).toFixed(2)}/ride
                          </div>
                          <div className="text-xs text-gray-500">Potential</div>
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

                      {/* Event Badge - High Priority Display with Full Details Tooltip */}
                      {block.hasEvent && block.eventBadge && (
                        <div className="bg-indigo-50 border-2 border-indigo-400 rounded-lg px-3 py-2 mb-3" data-testid={`event-badge-${index}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{block.eventBadge.split(' ')[0]}</span>
                            <p className="text-sm font-bold text-indigo-900 flex-1">
                              {block.eventBadge.split(' ').slice(1).join(' ')}
                            </p>
                            {block.eventSummary && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button 
                                      className="p-1 hover:bg-indigo-100 rounded-full transition-colors"
                                      data-testid={`event-info-${index}`}
                                    >
                                      <Info className="w-4 h-4 text-indigo-600" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent 
                                    className="max-w-md p-4 bg-white border-2 border-indigo-200"
                                    side="left"
                                    data-testid={`event-tooltip-${index}`}
                                  >
                                    <div className="space-y-2">
                                      <h4 className="font-semibold text-indigo-900 text-sm">Event Details</h4>
                                      <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                                        {block.eventSummary}
                                      </p>
                                      {block.eventImpact && (
                                        <div className="pt-2 border-t border-indigo-100">
                                          <span className="text-xs font-semibold text-indigo-700">
                                            Impact: <span className="capitalize">{block.eventImpact}</span> demand expected
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </div>
                      )}

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
                          <div className="flex items-center gap-2 mb-2">
                            <MapPin className="w-4 h-4 text-gray-600" />
                            <h4 className="text-sm font-semibold text-gray-900">Staging Area</h4>
                            <Badge className="bg-yellow-400 text-yellow-900 border-0 text-xs px-2 py-0">
                              {block.stagingArea.type}
                            </Badge>
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

      </div>
      
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
