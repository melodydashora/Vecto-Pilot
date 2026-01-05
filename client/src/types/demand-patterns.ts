/**
 * Demand Patterns Types
 *
 * TypeScript interfaces for market demand rhythm visualization.
 * Used by DemandRhythmChart and related components.
 *
 * Created: 2026-01-02
 * Purpose: Support dynamic, location-aware demand visualization
 */

// ============================================================================
// DEMAND DATA TYPES
// ============================================================================

/**
 * Hourly demand data for a specific day
 */
export interface HourlyDemandData {
  /** 24 values (index 0-23) representing relative demand (0-100 scale) */
  hours: number[];
  /** Strategy insight for this day */
  insight: string;
  /** Peak period descriptions */
  peakPeriods?: string[];
  /** Recommended zones for this day */
  recommendedZones?: string[];
}

/**
 * Demand patterns for all days of the week
 */
export interface DemandPatterns {
  Mon: HourlyDemandData;
  Tue: HourlyDemandData;
  Wed: HourlyDemandData;
  Thu: HourlyDemandData;
  Fri: HourlyDemandData;
  Sat: HourlyDemandData;
  Sun: HourlyDemandData;
}

export type DayOfWeek = keyof DemandPatterns;

/**
 * API response for demand patterns endpoint
 */
export interface DemandPatternsResponse {
  success: boolean;
  market: string;
  marketSlug: string;
  /** Whether data is from market-specific intelligence or archetype defaults */
  hasMarketData: boolean;
  archetype: MarketArchetype;
  patterns: DemandPatterns;
}

// ============================================================================
// MARKET ARCHETYPE TYPES
// ============================================================================

export type MarketArchetype = 'sprawl' | 'dense' | 'party';

export interface ArchetypeInfo {
  name: string;
  description: string;
  icon: string;
  primaryStrategy: 'sniper' | 'ant' | 'hybrid';
  peakDays: DayOfWeek[];
}

export const ARCHETYPE_INFO: Record<MarketArchetype, ArchetypeInfo> = {
  sprawl: {
    name: 'Sprawl City',
    description: 'High mileage, car dependency. Focus on AM airport runs and avoiding dead miles.',
    icon: '🏘️',
    primaryStrategy: 'sniper',
    peakDays: ['Mon', 'Fri'],
  },
  dense: {
    name: 'Dense Metro',
    description: 'Short trips, high volume. Focus on quests and staying in the core.',
    icon: '🏙️',
    primaryStrategy: 'ant',
    peakDays: ['Fri', 'Sat'],
  },
  party: {
    name: 'Tourism/Party Hub',
    description: 'Extreme peaks. Sleep all day, drive all night. Focus on events and safety.',
    icon: '🎉',
    primaryStrategy: 'hybrid',
    peakDays: ['Fri', 'Sat', 'Sun'],
  },
};

// ============================================================================
// ARCHETYPE DEFAULT PATTERNS
// ============================================================================

/**
 * Default demand patterns by market archetype
 * Used when no market-specific data exists
 *
 * Values are 0-100 representing relative demand intensity
 * Index 0 = midnight, Index 12 = noon, Index 23 = 11pm
 */
export const ARCHETYPE_DEMAND_PATTERNS: Record<MarketArchetype, DemandPatterns> = {
  sprawl: {
    Mon: {
      hours: [5, 10, 20, 50, 90, 80, 50, 40, 30, 20, 20, 30, 40, 40, 50, 70, 80, 60, 40, 30, 20, 10, 5, 5],
      insight: 'Airport runs 4-8 AM from wealthy suburbs (Plano, Frisco). Dead mid-day. Evening commute 5-7 PM.',
      peakPeriods: ['4:00 AM - 8:00 AM', '5:00 PM - 7:00 PM'],
      recommendedZones: ['Airport', 'Wealthy Suburbs'],
    },
    Tue: {
      hours: [5, 8, 15, 40, 80, 70, 45, 35, 25, 20, 20, 25, 35, 35, 45, 65, 75, 55, 35, 25, 15, 10, 5, 5],
      insight: 'Slowest weekday. Stick to core business areas. Short rides only.',
      peakPeriods: ['6:00 AM - 9:00 AM', '5:00 PM - 7:00 PM'],
      recommendedZones: ['Business Core', 'Airport'],
    },
    Wed: {
      hours: [5, 8, 15, 40, 80, 70, 45, 35, 25, 20, 20, 25, 35, 35, 50, 70, 80, 60, 40, 30, 20, 10, 5, 5],
      insight: 'Mid-week pickup. Business travel increases. Position near hotels.',
      peakPeriods: ['6:00 AM - 9:00 AM', '4:00 PM - 7:00 PM'],
      recommendedZones: ['Hotel District', 'Business Core'],
    },
    Thu: {
      hours: [10, 15, 25, 50, 85, 75, 50, 40, 35, 30, 30, 35, 45, 55, 65, 80, 90, 75, 60, 50, 40, 30, 20, 15],
      insight: 'Pre-weekend energy. Dinner crowd emerges. Legacy West, Frisco good spots.',
      peakPeriods: ['5:00 AM - 8:00 AM', '5:00 PM - 10:00 PM'],
      recommendedZones: ['Restaurant Districts', 'Wealthy Suburbs'],
    },
    Fri: {
      hours: [15, 20, 30, 50, 75, 65, 50, 45, 40, 40, 50, 60, 70, 80, 90, 100, 95, 90, 90, 95, 90, 70, 50, 30],
      insight: 'Money day! 4 PM - 2 AM is prime. Stay in profit zone. Decline long rural trips.',
      peakPeriods: ['4:00 PM - 2:00 AM'],
      recommendedZones: ['Entertainment Districts', 'Airport'],
    },
    Sat: {
      hours: [25, 15, 10, 5, 10, 20, 30, 40, 55, 65, 75, 80, 75, 70, 75, 85, 95, 100, 100, 100, 100, 95, 85, 60],
      insight: 'Brunch → Events → Nightlife. Do not leave the metro. Peak 6 PM - 2 AM.',
      peakPeriods: ['10:00 AM - 2:00 PM', '6:00 PM - 2:00 AM'],
      recommendedZones: ['Brunch Spots', 'Event Venues', 'Nightlife'],
    },
    Sun: {
      hours: [50, 40, 25, 10, 5, 10, 20, 35, 50, 60, 65, 60, 55, 60, 70, 80, 85, 75, 55, 45, 35, 25, 15, 10],
      insight: 'Airport returns 4-9 PM are huge. Position near airport holding lot by 3 PM.',
      peakPeriods: ['10:00 AM - 1:00 PM', '4:00 PM - 9:00 PM'],
      recommendedZones: ['Airport', 'Hotel District'],
    },
  },
  dense: {
    Mon: {
      hours: [20, 15, 10, 10, 30, 55, 75, 90, 85, 75, 70, 75, 80, 75, 80, 90, 95, 90, 75, 65, 55, 45, 35, 25],
      insight: 'Constant demand. Rush hours brutal but profitable. Use "Stop New Requests" strategically.',
      peakPeriods: ['7:00 AM - 10:00 AM', '5:00 PM - 8:00 PM'],
      recommendedZones: ['Financial District', 'Transit Hubs'],
    },
    Tue: {
      hours: [20, 15, 10, 10, 25, 50, 70, 85, 80, 70, 65, 70, 75, 70, 75, 85, 90, 85, 70, 60, 50, 40, 30, 25],
      insight: 'Similar to Monday. Business as usual. Focus on volume for quest bonuses.',
      peakPeriods: ['7:00 AM - 10:00 AM', '5:00 PM - 8:00 PM'],
      recommendedZones: ['Business Core', 'University Areas'],
    },
    Wed: {
      hours: [20, 15, 10, 10, 25, 50, 70, 85, 80, 70, 65, 70, 75, 70, 75, 85, 90, 85, 70, 60, 50, 40, 30, 25],
      insight: 'Midweek push. Corporate events start picking up for evening.',
      peakPeriods: ['7:00 AM - 10:00 AM', '5:00 PM - 9:00 PM'],
      recommendedZones: ['Convention Center', 'Business Core'],
    },
    Thu: {
      hours: [25, 20, 15, 12, 30, 55, 75, 90, 85, 75, 72, 78, 82, 78, 82, 92, 98, 95, 85, 78, 68, 55, 42, 32],
      insight: 'Nightlife begins. Stay until 10 PM for dinner surge.',
      peakPeriods: ['7:00 AM - 10:00 AM', '5:00 PM - 10:00 PM'],
      recommendedZones: ['Restaurant Row', 'Theater District'],
    },
    Fri: {
      hours: [30, 25, 18, 15, 25, 40, 60, 80, 82, 78, 78, 82, 88, 92, 98, 100, 100, 100, 100, 100, 100, 95, 85, 65],
      insight: 'Gridlock 4-8 PM. Patience. 9 PM+ is gold. Stay in core, accept everything.',
      peakPeriods: ['4:00 PM - 2:00 AM'],
      recommendedZones: ['Entertainment Districts', 'Bar Areas'],
    },
    Sat: {
      hours: [55, 45, 35, 22, 15, 15, 20, 32, 48, 65, 82, 92, 95, 92, 92, 98, 100, 100, 100, 100, 100, 100, 95, 82],
      insight: 'Non-stop demand. Short trips add up fast. Hit quest numbers. Peak after 6 PM.',
      peakPeriods: ['11:00 AM - 2:00 PM', '6:00 PM - 3:00 AM'],
      recommendedZones: ['Brunch Districts', 'Nightlife Core'],
    },
    Sun: {
      hours: [72, 55, 38, 22, 15, 15, 22, 35, 52, 68, 78, 82, 78, 72, 75, 82, 88, 82, 72, 62, 52, 42, 32, 22],
      insight: 'Brunch crowd, then airport returns. Winds down by 9 PM.',
      peakPeriods: ['10:00 AM - 2:00 PM', '4:00 PM - 8:00 PM'],
      recommendedZones: ['Brunch Areas', 'Airport'],
    },
  },
  party: {
    Mon: {
      hours: [35, 15, 8, 5, 8, 18, 28, 32, 28, 22, 22, 28, 35, 42, 45, 55, 62, 58, 48, 38, 28, 18, 12, 8],
      insight: 'Recovery day. Very slow. Only airport departures worth your time.',
      peakPeriods: ['5:00 PM - 8:00 PM'],
      recommendedZones: ['Airport', 'Resort Hotels'],
    },
    Tue: {
      hours: [28, 12, 5, 5, 8, 15, 25, 32, 32, 28, 28, 32, 38, 42, 48, 58, 65, 60, 50, 40, 30, 20, 12, 8],
      insight: 'Tourists arriving for mid-week stays. Hotel pickups good.',
      peakPeriods: ['3:00 PM - 8:00 PM'],
      recommendedZones: ['Resort Area', 'Airport'],
    },
    Wed: {
      hours: [25, 12, 5, 5, 8, 15, 28, 38, 38, 35, 35, 40, 48, 55, 62, 72, 78, 72, 62, 52, 42, 32, 22, 15],
      insight: 'Midweek event nights begin. Check local venues.',
      peakPeriods: ['4:00 PM - 11:00 PM'],
      recommendedZones: ['Event Venues', 'Entertainment Strip'],
    },
    Thu: {
      hours: [35, 18, 8, 5, 8, 18, 32, 45, 48, 45, 48, 55, 65, 72, 80, 88, 92, 88, 82, 78, 72, 62, 48, 35],
      insight: 'Weekend tourists arriving. Nightlife starting. Good evening.',
      peakPeriods: ['4:00 PM - 1:00 AM'],
      recommendedZones: ['Resort Hotels', 'Club District'],
    },
    Fri: {
      hours: [28, 15, 8, 5, 8, 15, 28, 42, 52, 62, 72, 82, 88, 92, 95, 98, 100, 100, 100, 100, 100, 98, 92, 82],
      insight: 'Tourist arrivals 11 AM - 4 PM. Nightlife 9 PM - 4 AM. Rest in between.',
      peakPeriods: ['11:00 AM - 4:00 PM', '9:00 PM - 4:00 AM'],
      recommendedZones: ['Airport', 'Club District'],
    },
    Sat: {
      hours: [72, 55, 38, 18, 8, 8, 15, 28, 42, 62, 78, 88, 92, 92, 95, 98, 100, 100, 100, 100, 100, 100, 98, 92],
      insight: 'THE MAIN EVENT. Sleep until noon. Drive 4 PM - 4 AM. Prepare for drunk passengers.',
      peakPeriods: ['4:00 PM - 4:00 AM'],
      recommendedZones: ['Pool Parties', 'Club District', 'Concert Venues'],
    },
    Sun: {
      hours: [85, 72, 55, 35, 18, 12, 18, 32, 48, 65, 78, 85, 82, 78, 75, 78, 82, 78, 68, 55, 42, 32, 22, 15],
      insight: 'Airport departures all day. Pool parties wind down. Good steady day.',
      peakPeriods: ['10:00 AM - 2:00 PM', '3:00 PM - 7:00 PM'],
      recommendedZones: ['Airport', 'Resort Area'],
    },
  },
};

// ============================================================================
// MARKET CITY TYPES
// ============================================================================

export type RegionType = 'Core' | 'Satellite' | 'Rural';

export interface MarketCity {
  city: string;
  state?: string;
  region_type: RegionType;
}

/** Simple deadhead risk level for calculator components */
export type DeadheadRiskLevel = 'low' | 'medium' | 'high' | 'extreme';

/** Detailed deadhead risk info for advanced use */
export interface DeadheadRiskInfo {
  level: DeadheadRiskLevel;
  score: number; // 0-100
  color: string;
  advice: string;
}

/**
 * Calculate deadhead risk based on region type transition
 * From user's current position to destination
 *
 * Returns a simple level string for use in components.
 * For detailed info (score, color, advice), use getDeadheadRiskInfo.
 */
export function calculateDeadheadRisk(
  fromRegion: RegionType,
  toRegion: RegionType
): DeadheadRiskLevel {
  // Same region = low risk
  if (fromRegion === toRegion) {
    return 'low';
  }

  // Core to Satellite = low
  if (fromRegion === 'Core' && toRegion === 'Satellite') {
    return 'low';
  }

  // Satellite to Core = low (best case)
  if (fromRegion === 'Satellite' && toRegion === 'Core') {
    return 'low';
  }

  // Rural to Rural = extreme (worst case)
  if (fromRegion === 'Rural' && toRegion === 'Rural') {
    return 'extreme';
  }

  // Any to Rural = high risk
  if (toRegion === 'Rural') {
    return 'high';
  }

  // Rural to anywhere else = medium (you're already in bad spot)
  if (fromRegion === 'Rural') {
    return 'medium';
  }

  // Default: medium
  return 'medium';
}

// ============================================================================
// CHART CONFIGURATION
// ============================================================================

export const HOUR_LABELS = [
  '12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
  '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p',
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
