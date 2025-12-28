// client/src/types/co-pilot.ts
// Shared types for Co-Pilot page and related components

export interface SmartBlock {
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
  streetViewUrl?: string;
  up_count?: number;
  down_count?: number;
}

export interface BlocksResponse {
  now: string;
  timezone: string;
  strategy?: string;
  blocks: SmartBlock[];
  ranking_id?: string;
  path_taken?: string;
  refined?: boolean;
  error?: string;
  tactical_summary?: string;
  best_staging_location?: string;
  isBlocksGenerating?: boolean;
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

export interface FeedbackModalState {
  isOpen: boolean;
  sentiment: 'up' | 'down' | null;
  block: SmartBlock | null;
  blockIndex: number | null;
}

export type TabType = 'strategy' | 'venues' | 'briefing' | 'map' | 'rideshare' | 'donation';

// Backend pipeline phases (from strategies.phase column)
// Strategy phases: starting → resolving → analyzing → immediate
// SmartBlocks phases: venues → routing → places → verifying → complete
export type PipelinePhase = 'starting' | 'resolving' | 'analyzing' | 'immediate' | 'venues' | 'routing' | 'places' | 'verifying' | 'enriching' | 'complete';

// Legacy frontend phases (kept for backwards compatibility)
export type EnrichmentPhase = 'idle' | 'strategy' | 'blocks';

export interface StrategyData {
  status?: string;
  phase?: PipelinePhase;
  strategy?: {
    consolidated?: string;
    strategy_for_now?: string;
    holiday?: string;
  };
  strategy_id?: string;
  timeElapsedMs?: number;
  _snapshotId?: string;
  timing?: {
    phase_started_at?: string;
    phase_elapsed_ms?: number;
    expected_duration_ms?: number;
    expected_durations?: Record<string, number>;
  };
}

export interface CoordData {
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  source?: string;
}
