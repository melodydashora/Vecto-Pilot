/**
 * Tactical Map Types
 *
 * TypeScript interfaces for the Tactical Staging Map feature.
 * Used by TacticalStagingMap component and related hooks.
 */

// ============================================================================
// MISSION TYPES
// ============================================================================

/**
 * Base mission interface - represents a target location (event or airport)
 */
export interface Mission {
  id: string;
  type: 'event' | 'airport';
  name: string;
  lat: number;
  lng: number;
  subtitle?: string;
}

/**
 * Event mission - populated from briefing API eventsData
 */
export interface EventMission extends Mission {
  type: 'event';
  venue?: string;
  eventDate?: string;
  eventTime?: string;
  eventEndTime?: string;
  impact?: 'high' | 'medium' | 'low';
  category?: string;
  subtype?: string;
}

/**
 * Airport mission - populated from briefing API airportData
 */
export interface AirportMission extends Mission {
  type: 'airport';
  code: string;
  terminal?: string;
  currentDelays?: number; // minutes
  status?: 'normal' | 'delays' | 'severe_delays';
}

// ============================================================================
// ZONE TYPES
// ============================================================================

export type ZoneType = 'staging' | 'avoid';
export type ZoneSource = 'ranking_candidates' | 'ai_tactical' | 'traffic_data' | 'fallback';

/**
 * Tactical zone - either staging (green) or avoid (red)
 */
export interface TacticalZone {
  id: string;
  type: ZoneType;
  name: string;
  lat: number;
  lng: number;
  notes?: string;
  reason?: string;
  source: ZoneSource;
}

/**
 * Staging zone with venue context
 */
export interface StagingZone extends TacticalZone {
  type: 'staging';
  venue?: {
    name: string;
    lat: number;
    lng: number;
    category?: string;
    district?: string;
    valueGrade?: string;
    driveTimeMin?: number;
    distanceMiles?: number;
    proTips?: string[];
  };
}

/**
 * Avoid zone with reason
 */
export interface AvoidZone extends TacticalZone {
  type: 'avoid';
  severity?: 'low' | 'medium' | 'high';
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Response from GET /api/intelligence/staging-areas
 */
export interface StagingAreasResponse {
  success: boolean;
  snapshotId: string;
  count: number;
  stagingZones: StagingZone[];
}

/**
 * Request body for POST /api/strategy/tactical-plan
 */
export interface TacticalPlanRequest {
  snapshotId: string;
  mission: {
    type: 'event' | 'airport';
    name: string;
    lat: number;
    lng: number;
    venue?: string;
    eventTime?: string;
    eventEndTime?: string;
    expectedAttendance?: string;
    airportCode?: string;
    terminal?: string;
  };
  driverLat: number;
  driverLng: number;
  trafficContext?: {
    congestionLevel?: string;
    incidents?: unknown[];
    avoidAreas?: string[];
  };
}

/**
 * Response from POST /api/strategy/tactical-plan
 */
export interface TacticalPlanResponse {
  success: boolean;
  mission: {
    type: 'event' | 'airport';
    name: string;
    lat: number;
    lng: number;
  };
  stagingZones: TacticalZone[];
  avoidZones: TacticalZone[];
  strategy: string;
  metadata: {
    model: string;
    latencyMs: number;
    generatedAt: string;
    searchGrounded: boolean;
  };
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

/**
 * Props for TacticalStagingMap component
 */
export interface TacticalStagingMapProps {
  snapshotId: string;
  driverLat: number;
  driverLng: number;
  timezone?: string;
  events?: EventMission[];
  airports?: AirportMission[];
  trafficContext?: TacticalPlanRequest['trafficContext'];
}

/**
 * Active mission state (selected mission with zones)
 */
export interface ActiveMission {
  mission: Mission;
  stagingZones: TacticalZone[];
  avoidZones: TacticalZone[];
  strategy?: string;
  isAiEnhanced: boolean;
}

// ============================================================================
// MAP MARKER TYPES
// ============================================================================

export type MarkerType = 'driver' | 'mission' | 'staging' | 'avoid';

export interface MapMarkerConfig {
  type: MarkerType;
  color: string;
  label: string;
  zIndex: number;
}

export const MARKER_CONFIGS: Record<MarkerType, MapMarkerConfig> = {
  driver: {
    type: 'driver',
    color: '#3B82F6', // blue-500
    label: 'You',
    zIndex: 100,
  },
  mission: {
    type: 'mission',
    color: '#8B5CF6', // violet-500
    label: 'Target',
    zIndex: 90,
  },
  staging: {
    type: 'staging',
    color: '#10B981', // emerald-500
    label: 'Stage Here',
    zIndex: 80,
  },
  avoid: {
    type: 'avoid',
    color: '#EF4444', // red-500
    label: 'Avoid',
    zIndex: 70,
  },
};
