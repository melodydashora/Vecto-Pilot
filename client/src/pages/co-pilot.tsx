/**
 * Vecto Pilot™ - Co-Pilot
 * 
 * Real-time AI-powered staging location recommendations with block selection.
 * Integrates with smart-blocks-enhanced API for time-aware zone suggestions.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
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
  PartyPopper,
  Sun,
  Moon,
  Volume2,
  Square,
  Wine,
  Loader
} from 'lucide-react';
import { useLocation } from '@/contexts/location-context-clean';
import { useToast } from '@/hooks/use-toast';
import { FeedbackModal } from '@/components/FeedbackModal';
import CoachChat from '@/components/CoachChat';
import { subscribeStrategyReady } from '@/services/strategyEvents';
import { SmartBlocksStatus } from '@/components/SmartBlocksStatus';
import SmartBlocks from '@/components/SmartBlocks';
import BarsTable from '@/components/BarsTable';
import BriefingTab from '@/components/BriefingTab';
import MapTab from '@/components/MapTab';
import { DonationTab } from '@/components/DonationTab';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Map as MapIcon, Heart } from 'lucide-react';

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
    lat?: number;
    lng?: number;
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
  error?: string; // e.g., "NOT_FOUND" when blocks not yet generated
  timing?: {
    scoring_ms?: number;
    planner_ms?: number;
    total_ms?: number;
    timed_out?: boolean;
    budget_ms?: number;
  };
  metadata?: {
    totalBlocks: number;
    processingTimeMs: number;
    modelRoute?: string;
    validation?: {
      status: string;
      flags?: string[];
    };
  };
}

/**
 * CoPilot - AI-powered venue recommendations and strategy optimization
 * - Displays real-time smart blocks (staging areas) with demand/earnings insights
 * - Polls for AI-generated recommendations every 5 seconds until blocks arrive
 * - Integrates feedback system for continuous ML model improvement
 */
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
  const [strategyReadyTime, setStrategyReadyTime] = useState<number | null>(null); // Track when strategy became ready
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
  const [activeTab, setActiveTab] = useState<'strategy' | 'venues' | 'briefing' | 'map' | 'donation'>('strategy');
  
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

  // Helper to get auth headers with JWT token
  const getAuthHeader = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

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
  }, [lastSnapshotId]);

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
      console.log(`[strategy-fetch] Status: ${data.status}, Time elapsed: ${data.timeElapsedMs}ms`);
      // Attach the snapshot ID to the response for validation
      return { ...data, _snapshotId: lastSnapshotId };
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    // Poll every 3 seconds if strategy is pending (fallback when SSE fails)
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' ? 3000 : false;
    },
    // Cache for 5 minutes to avoid refetching
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // ===== BRIEFING TAB QUERIES (load in parallel regardless of active tab) =====

  const { data: weatherData, isLoading: weatherLoading } = useQuery({
    queryKey: ['/api/briefing/weather', lastSnapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching weather for', lastSnapshotId);
      if (!lastSnapshotId) return { weather: null };
      const response = await fetch(`/api/briefing/weather/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Weather failed:', response.status);
        return { weather: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Weather received:', data);
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 30000,
  });

  const { data: trafficData, isLoading: trafficLoading } = useQuery({
    queryKey: ['/api/briefing/traffic', lastSnapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching traffic for', lastSnapshotId);
      if (!lastSnapshotId) return { traffic: null };
      const response = await fetch(`/api/briefing/traffic/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Traffic failed:', response.status);
        return { traffic: null };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Traffic received:', data);
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 30000,
  });

  const { data: newsData } = useQuery({
    queryKey: ['/api/briefing/rideshare-news', lastSnapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching news for', lastSnapshotId);
      if (!lastSnapshotId) return { news: null };
      const response = await fetch(`/api/briefing/rideshare-news/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return { news: null };
      const data = await response.json();
      console.log('[BriefingQuery] News received:', data);
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 45000,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['/api/briefing/events', lastSnapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching events for', lastSnapshotId);
      if (!lastSnapshotId) return { events: [] };
      const response = await fetch(`/api/briefing/events/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        console.error('[BriefingQuery] Events failed:', response.status);
        return { events: [] };
      }
      const data = await response.json();
      console.log('[BriefingQuery] Events received:', data);
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 45000,
  });

  const { data: schoolClosuresData } = useQuery({
    queryKey: ['/api/briefing/school-closures', lastSnapshotId],
    queryFn: async () => {
      console.log('[BriefingQuery] Fetching school closures for', lastSnapshotId);
      if (!lastSnapshotId) return { school_closures: [] };
      const response = await fetch(`/api/briefing/school-closures/${lastSnapshotId}`, {
        headers: getAuthHeader()
      });
      if (!response.ok) return { school_closures: [] };
      const data = await response.json();
      console.log('[BriefingQuery] School closures received:', data);
      return data;
    },
    enabled: !!lastSnapshotId && lastSnapshotId !== 'live-snapshot',
    staleTime: 45000,
  });

  // Clear strategy if snapshot ID changes
  useEffect(() => {
    if (lastSnapshotId && lastSnapshotId !== 'live-snapshot' && strategySnapshotId && lastSnapshotId !== strategySnapshotId) {
      console.log(`🔄 New snapshot detected (${lastSnapshotId}), clearing old strategy from ${strategySnapshotId}`);
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      setPersistentStrategy(null);
      setStrategySnapshotId(null);
      // Force immediate query restart for new snapshot (ensures progress bar starts fresh)
      queryClient.resetQueries({ queryKey: ['/api/blocks/strategy'] });
    }
  }, [lastSnapshotId, strategySnapshotId]);

  // UNIFIED ENRICHMENT PROGRESS: Tracks entire pipeline from GPS to blocks
  // Phase 1: Strategy generation (0-30%) - starts when coords arrive
  // Phase 2: Blocks generation (30-100%) - starts when strategy ready
  const [enrichmentStartTime, setEnrichmentStartTime] = useState<number | null>(null);
  const [enrichmentProgress, setEnrichmentProgress] = useState(0);
  const [enrichmentPhase, setEnrichmentPhase] = useState<'idle' | 'strategy' | 'blocks'>('idle');
  
  // Start enrichment timer IMMEDIATELY when coords arrive (before snapshot created)
  useEffect(() => {
    console.log('🔍 Enrichment check:', { hasCoords: !!coords, enrichmentPhase });
    // Start as soon as we have coords and we're not already in an enrichment phase
    if (coords && enrichmentPhase === 'idle') {
      const now = Date.now();
      console.log('⏰ Enrichment started immediately - coords received');
      setEnrichmentStartTime(now);
      setEnrichmentProgress(5); // Start at 5% to show immediate feedback
      setEnrichmentPhase('strategy');
    }
  }, [coords, enrichmentPhase]);
  
  // Update phase when strategy becomes ready
  useEffect(() => {
    const strategyReady = strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks';
    const snapshotMatches = strategyData?._snapshotId === lastSnapshotId;
    
    if (strategyReady && snapshotMatches && enrichmentPhase === 'strategy') {
      console.log('⏰ Strategy ready - moving to blocks phase');
      setEnrichmentPhase('blocks');
      // Jump progress to 30% when entering blocks phase
      setEnrichmentProgress(30);
    }
  }, [strategyData, lastSnapshotId, enrichmentPhase]);
  
  // Update progress bar every 500ms for smooth animation
  useEffect(() => {
    if (!enrichmentStartTime || enrichmentPhase === 'idle') return;
    
    const interval = setInterval(() => {
      const elapsed = Date.now() - enrichmentStartTime;
      
      if (enrichmentPhase === 'strategy') {
        // Phase 1: Strategy generation (0-30% over ~15 seconds)
        const strategyExpected = 15000; // 15 seconds expected for strategy
        const strategyProgress = Math.min(30, (elapsed / strategyExpected) * 30);
        setEnrichmentProgress(strategyProgress);
      } else if (enrichmentPhase === 'blocks') {
        // Phase 2: Blocks generation (30-100% over ~75 seconds after strategy ready)
        // Use a separate timer from when blocks phase started
        const blocksExpected = 75000; // 75 seconds expected for blocks
        const blocksMax = 120000; // 120 seconds max
        
        // Calculate blocks elapsed time (estimate based on total minus strategy time)
        const strategyTime = 15000; // approximate strategy time
        const blocksElapsed = Math.max(0, elapsed - strategyTime);
        
        let progress;
        if (blocksElapsed < blocksExpected) {
          // Smooth progress from 30% to 95%
          progress = 30 + (blocksElapsed / blocksExpected) * 65;
        } else if (blocksElapsed < blocksMax) {
          // Slow crawl from 95% to 100%
          const remainingTime = blocksElapsed - blocksExpected;
          const remainingProgress = (remainingTime / (blocksMax - blocksExpected)) * 5;
          progress = 95 + remainingProgress;
        } else {
          progress = 100;
        }
        
        setEnrichmentProgress(Math.min(100, progress));
      }
    }, 500);
    
    return () => clearInterval(interval);
  }, [enrichmentStartTime, enrichmentPhase]);
  
  // Note: Stop enrichment effect moved after useQuery that defines blocksData

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
          // Debug: Blocks API response (removed verbose logs)
          
          const transformed = {
            now: data.generatedAt || new Date().toISOString(),
            timezone: 'America/Chicago',
            strategy: data.strategy_for_now,
            path_taken: data.path_taken,
            refined: data.refined,
            timing: data.timing,
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
          
          // Blocks ready - log the result
          console.log('[blocks-query] ✅ Blocks fetched successfully:', { count: transformed.blocks?.length, blocks: transformed.blocks?.slice(0, 2) });
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
    // SIMPLE POLLING: Poll every 5s until blocks arrive, then stop
    refetchInterval: (query) => {
      const blocks = query.state.data?.blocks;
      const hasBlocks = blocks && blocks.length > 0;
      // Stop polling once we have blocks (no log to reduce spam)
      if (hasBlocks) {
        return false;
      }
      return 5000; // Poll every 5 seconds
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

  // Separate query for venue-specific bars/nightlife blocks (for Venues tab)
  const { data: venueBlocksData, isLoading: venueBlocksLoading } = useQuery<BlocksResponse>({
    queryKey: ['/api/blocks-venues', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId) throw new Error('No snapshot');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 230000);
      
      try {
        // Fetch bars/nightlife specific blocks
        const response = await fetch(`/api/blocks-fast?snapshotId=${lastSnapshotId}&venueType=nightlife`, {
          method: 'GET',
          signal: controller.signal,
          headers: { ...getAuthHeader() }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok && response.status !== 202) {
          throw new Error(`Failed to fetch venue blocks: ${response.status}`);
        }
        
        const data = await response.json();
        const transformed = {
          now: data.generatedAt || new Date().toISOString(),
          timezone: 'America/Chicago',
          strategy: data.strategy_for_now,
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
            proTips: v.proTips || v.pro_tips || []
          })) || [],
          ranking_id: data.ranking_id || data.correlationId,
          metadata: {
            totalBlocks: data.blocks?.length || 0,
            processingTimeMs: data.elapsed_ms || 0,
            modelRoute: data.model_route,
            validation: data.validation
          }
        };
        return transformed;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    },
    enabled: !!lastSnapshotId && activeTab === 'venues',
    retry: 2,
    refetchInterval: (query) => {
      const hasBlocks = query.state.data?.blocks && query.state.data.blocks.length > 0;
      return hasBlocks ? false : 5000;
    }
  });

  // Stop enrichment when blocks are loaded (must be after useQuery that defines blocksData)
  useEffect(() => {
    if (blocksData?.blocks && blocksData.blocks.length > 0) {
      setEnrichmentPhase('idle');
      setEnrichmentProgress(100);
    }
  }, [blocksData?.blocks]);

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
  const [isRetrying, setIsRetrying] = useState(false);
  const retryStrategy = async () => {
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
  
  // Log blocks for debugging
  if (blocks.length > 0) {
    console.log('✅ SmartBlocks rendering:', { count: blocks.length, firstBlock: blocks[0]?.name });
  }
  
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

  // Text-to-speech handler - uses OpenAI natural voice
  const handleReadStrategy = async () => {
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
        
        {/* Strategy Tab Content */}
        {activeTab === 'strategy' && (
          <>
        {/* Greeting/Holiday Banner - Always visible with fallback */}
        {(() => {
          // Check for holiday from strategy data (always preserve holiday if found)
          const hasHoliday = strategyData?.strategy?.holiday;
          const hour = new Date().getHours();
          const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
          const greetingIcon = hour < 12 ? '☀️' : hour < 18 ? '🌅' : '🌙';
          
          // Only show holiday banner if we have holiday data
          if (hasHoliday) {
            return (
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
            );
          }
          
          // Fallback to time-based greeting (always visible)
          return (
            <Card className="mb-6 border-2 border-blue-300 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 shadow-md" data-testid="greeting-banner">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100">
                    {hour < 12 ? (
                      <Sun className="w-6 h-6 text-blue-600" />
                    ) : hour < 18 ? (
                      <Sun className="w-6 h-6 text-orange-500" />
                    ) : (
                      <Moon className="w-6 h-6 text-indigo-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900 text-lg">
                      {greetingIcon} {greeting}, driver!
                    </p>
                    <p className="text-sm text-gray-700">
                      Your AI strategy is analyzing real-time conditions to maximize your earnings
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

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
          ) : persistentStrategy ? (
            <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 shadow-md" data-testid="strategy-complete-card">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-purple-900">Strategic Overview</p>
                      <div className="flex items-center gap-2">
                        <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                          ✅ Complete
                        </Badge>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleReadStrategy}
                                className="h-6 w-6 p-0 hover:bg-purple-200"
                                data-testid="button-read-strategy"
                              >
                                {isSpeaking ? (
                                  <Square className="w-3 h-3 text-red-600 fill-red-600" />
                                ) : (
                                  <Volume2 className="w-3 h-3 text-purple-600" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              {isSpeaking ? 'Stop reading' : 'Read strategy aloud'}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{persistentStrategy}</p>
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
                        Pending
                      </Badge>
                    </div>
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

            {/* Bars Table - ML Training Data */}
            {blocks.length > 0 && <BarsTable blocks={blocks} />}

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
              strategyStatus={strategyData?.status}
              strategyReady={strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks'}
              isStrategyFetching={isStrategyFetching}
              hasBlocks={blocks.length > 0}
              isBlocksLoading={isLoading}
              blocksError={error as Error | null}
              timeElapsedMs={strategyData?.timeElapsedMs}
              snapshotId={lastSnapshotId}
              enrichmentProgress={enrichmentProgress}
              enrichmentPhase={enrichmentPhase}
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

        {/* Donation/About Tab Content */}
        {activeTab === 'donation' && (
          <div data-testid="donation-section" className="mb-24">
            <DonationTab userId={localStorage.getItem('vecto_user_id') || 'default'} />
          </div>
        )}

        {/* Venues Tab Content - Bars & High-Volume Venues */}
        {activeTab === 'venues' && (
          <div data-testid="venue-intelligence-section">
            {/* Venues Header with Location Context */}
            <div className="mb-6 flex items-center gap-3 flex-wrap justify-between">
              <div className="flex items-center gap-2">
                <Wine className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-semibold text-gray-800">Bars & High-Volume Venues</h2>
                <Badge variant="outline" className="border-green-500 text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                  Live
                </Badge>
              </div>
              {coords && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span>{coords.city}{coords.state ? `, ${coords.state}` : ''}</span>
                </div>
              )}
            </div>
            
            {/* Location Context Card from Coordinates */}
            {coords && (
              <Card className="mb-4 border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-purple-100">
                      <MapPin className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">
                        {coords.city}{coords.state ? `, ${coords.state}` : ''}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        Showing bars and restaurants sorted by expense level ($$$$→$) with last-call alerts
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Venues Loading State */}
            {venueBlocksLoading && (
              <Card className="p-6 border-purple-100 bg-purple-50/50 mb-6">
                <div className="flex items-center gap-3">
                  <Loader className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-gray-800 font-semibold text-sm">Finding nearby bars & lounges...</p>
                    <p className="text-gray-600 text-xs">Checking operating hours and availability</p>
                  </div>
                </div>
              </Card>
            )}
            
            {!venueBlocksLoading && <BarsTable blocks={venueBlocksData?.blocks} />}
          </div>
        )}

        {activeTab === 'venues' && !coords && !snapshotData?.lat && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Wine className="w-12 h-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700">Location Required</h3>
            <p className="text-gray-500 mt-2">Enable location services to discover nearby bars and venues</p>
          </div>
        )}

      </div>

      {/* Bottom Tab Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50" data-testid="bottom-tabs">
        <div className="max-w-7xl mx-auto">
          <div className="flex">
            <button
              onClick={() => setActiveTab('strategy')}
              className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                activeTab === 'strategy' 
                  ? 'text-blue-600 bg-blue-50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="tab-strategy"
            >
              <Sparkles className={`w-6 h-6 ${activeTab === 'strategy' ? 'text-blue-600' : 'text-gray-400'}`} />
              <span className="text-xs font-medium">Strategy</span>
            </button>
            <button
              onClick={() => setActiveTab('venues')}
              className={`relative flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                activeTab === 'venues' 
                  ? 'text-blue-600 bg-blue-50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="tab-venues"
            >
              <div className="relative">
                <TrendingUp className={`w-6 h-6 ${activeTab === 'venues' ? 'text-blue-600' : 'text-gray-400'}`} />
                <span className="absolute -top-1 -right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              </div>
              <span className="text-xs font-medium">Venues</span>
            </button>
            <button
              onClick={() => setActiveTab('briefing')}
              className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                activeTab === 'briefing' 
                  ? 'text-indigo-600 bg-indigo-50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="tab-briefing"
            >
              <MessageSquare className={`w-6 h-6 ${activeTab === 'briefing' ? 'text-indigo-600' : 'text-gray-400'}`} />
              <span className="text-xs font-medium">Briefing</span>
            </button>
            <button
              onClick={() => setActiveTab('map')}
              className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                activeTab === 'map' 
                  ? 'text-green-600 bg-green-50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="tab-map"
            >
              <MapIcon className={`w-6 h-6 ${activeTab === 'map' ? 'text-green-600' : 'text-gray-400'}`} />
              <span className="text-xs font-medium">Map</span>
            </button>
            <button
              onClick={() => setActiveTab('donation')}
              className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
                activeTab === 'donation' 
                  ? 'text-rose-600 bg-rose-50' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="tab-donation"
            >
              <Heart className={`w-6 h-6 ${activeTab === 'donation' ? 'text-rose-600' : 'text-gray-400'}`} />
              <span className="text-xs font-medium">About</span>
            </button>
          </div>
        </div>
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
