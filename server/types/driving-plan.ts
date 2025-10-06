/**
 * Vecto Pilot™ - Driving Plan Types
 * 
 * Comprehensive type definitions for AI-powered shift planning system.
 * All data is variable-based with zero hardcoded values.
 */

export type PlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export type LocationCategory = 
  | 'airport' 
  | 'business_district' 
  | 'entertainment' 
  | 'residential' 
  | 'hotspot' 
  | 'transportation_hub'
  | 'shopping'
  | 'event_venue';

export type SurgeSensitivity = 'low' | 'medium' | 'high';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface StagingLocation {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  category: LocationCategory;
  stageAdvice: string;
  parkingInfo?: string;
  accessNotes?: string;
  estimatedEarningsPerHour: number;
  surgeSensitivity: SurgeSensitivity;
  riskLevel: RiskLevel;
  riskNotes?: string;
  peakHours?: number[];
  confidenceScore: number;
}

export interface PlanBlock {
  id: string;
  planId: string;
  sequence: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  stagingLocation: StagingLocation;
  estimatedEarnings: number;
  rationale: string;
  actionItems: string[];
  tips: string[];
  warnings?: string[];
  timeWindowMins?: number;
  aiProvider?: 'openai' | 'anthropic' | 'gemini' | 'local';
  aiConfidence: number;
}

export interface DrivingPlan {
  id: string;
  userId: string;
  baseAddress: string;
  baseCoordinates: Coordinates;
  duration: number;
  targetEarnings?: number;
  createdAt: string;
  updatedAt: string;
  startTime: string;
  endTime: string;
  totalEstimatedEarnings: number;
  blocks: PlanBlock[];
  status: PlanStatus;
  keyInsights: string[];
  riskFactors: string[];
  opportunities: string[];
  metadata: {
    createdBy: 'user' | 'ai' | 'hybrid';
    aiProvider?: string;
    modelVersion?: string;
    generationTime?: number;
  };
}

export interface PlanGenerationRequest {
  userId: string;
  baseAddress: string;
  baseCoordinates?: Coordinates;
  duration: number;
  targetEarnings?: number;
  preferredZones?: string[];
  avoidZones?: string[];
  startTime?: string;
  vehicleTypes?: string[];
  constraints?: {
    maxPickupEtaMins?: number;
    minDollarsPerMile?: number;
    minDollarsPerHour?: number;
  };
  budgetMode?: 'normal' | 'mini';
}

export interface PlanGenerationResponse {
  success: boolean;
  plan?: DrivingPlan;
  error?: string;
  warnings?: string[];
  estimatedGenerationCost?: number;
}

export interface PlanUpdateRequest {
  planId: string;
  userId: string;
  updates: {
    status?: PlanStatus;
    targetEarnings?: number;
    addBlocks?: Partial<PlanBlock>[];
    removeBlockIds?: string[];
    updateBlocks?: Array<{ blockId: string; updates: Partial<PlanBlock> }>;
  };
}

export interface TrafficConditions {
  severity: 'light' | 'moderate' | 'heavy' | 'severe';
  estimatedDelayMinutes: number;
  affectedRoutes: string[];
  lastUpdated: string;
}

export interface WeatherConditions {
  temperature: number;
  feelsLike: number;
  conditions: string;
  description: string;
  precipitation: number;
  impact: 'none' | 'minor' | 'moderate' | 'severe';
}

export interface RealTimeContext {
  timestamp: string;
  currentLocation: Coordinates;
  traffic: TrafficConditions;
  weather: WeatherConditions;
  nearbyHotspots: StagingLocation[];
  activeSurgeZones: Array<{
    name: string;
    coordinates: Coordinates;
    surgeMultiplier: number;
  }>;
}

export interface PlanAdjustment {
  type: 'location_shift' | 'time_extension' | 'break_insertion' | 'block_swap';
  reason: string;
  impact: {
    earningsChange: number;
    timeChange: number;
    riskChange: RiskLevel;
  };
  suggestedChanges: Partial<DrivingPlan>;
  confidence: number;
}
