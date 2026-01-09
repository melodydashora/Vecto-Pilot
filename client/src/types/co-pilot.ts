// client/src/types/co-pilot.ts
// Shared types for Co-Pilot page and related components
// 2026-01-09: Standardized to camelCase to match API response format

/**
 * SmartBlock - AI-recommended venue with enrichment data
 * Matches server/validation/response-schemas.js SmartBlockSchema
 */
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
  estimatedEarnings?: number;
  potential?: number;
  estimatedDistanceMiles?: number;
  distanceSource?: string;
  driveTimeMinutes?: number;
  surge?: number;
  type?: string;
  // Value per minute fields
  valuePerMin?: number;
  valueGrade?: string;
  notWorth?: boolean;
  demandLevel?: string;
  category?: string;
  businessHours?: string;
  isOpen?: boolean;
  businessStatus?: string;
  placeId?: string;
  closedButStillGood?: string;
  closedVenueReasoning?: string;
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
  upCount?: number;
  downCount?: number;
  rankingId?: string;
}

/**
 * BlocksResponse - Response from /api/blocks-fast endpoints
 * Uses camelCase to match API response format
 */
export interface BlocksResponse {
  now: string;
  // 2026-01-09: timezone can be null if not available from server or location context
  timezone: string | null;
  strategy?: string;
  blocks: SmartBlock[];
  rankingId?: string;
  pathTaken?: string;
  refined?: boolean;
  error?: string;
  tacticalSummary?: string;
  bestStagingLocation?: string;
  isBlocksGenerating?: boolean;
  timing?: {
    scoringMs?: number;
    plannerMs?: number;
    totalMs?: number;
    timedOut?: boolean;
    budgetMs?: number;
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

/**
 * StrategyData - Strategy polling response data
 * Uses camelCase to match API response format
 */
export interface StrategyData {
  status?: string;
  phase?: PipelinePhase;
  strategy?: {
    consolidated?: string;
    strategyForNow?: string;
    holiday?: string;
  };
  strategyId?: string;
  timeElapsedMs?: number;
  _snapshotId?: string;
  timing?: {
    phaseStartedAt?: string;
    phaseElapsedMs?: number;
    expectedDurationMs?: number;
    expectedDurations?: Record<string, number>;
  };
}

export interface CoordData {
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  source?: string;
}
