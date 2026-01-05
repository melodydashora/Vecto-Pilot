/**
 * useMarketIntelligence Hook
 *
 * Fetches market-specific intelligence from the /api/intelligence API.
 * Auto-detects the user's market from their current location and provides
 * zone information, strategies, safety tips, and regulatory context.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@/contexts/location-context-clean';

// Intelligence types from the API
export type IntelType = 'regulatory' | 'strategy' | 'zone' | 'timing' | 'airport' | 'safety' | 'algorithm' | 'vehicle' | 'general';
export type ZoneSubtype = 'honey_hole' | 'danger_zone' | 'dead_zone' | 'safe_corridor' | 'caution_zone';

export interface IntelligenceItem {
  id: string;
  market: string;
  market_slug: string;
  platform: 'uber' | 'lyft' | 'both';
  intel_type: IntelType;
  intel_subtype?: ZoneSubtype;
  title: string;
  summary?: string;
  content: string;
  neighborhoods?: string[];
  boundaries?: unknown;
  time_context?: unknown;
  tags?: string[];
  priority: number;
  confidence: number;
  source: string;
  coach_can_cite: boolean;
  is_active: boolean;
  created_at: string;
}

export interface MarketIntelligenceResponse {
  market: string;
  market_name: string;
  total_items: number;
  by_type: Record<IntelType, IntelligenceItem[]>;
  intelligence: IntelligenceItem[];
}

export interface IntelligenceMarketsResponse {
  markets: Array<{
    market_slug: string;
    market: string;
    intel_count: number;
    zone_count: number;
    safety_count: number;
    strategy_count: number;
  }>;
}

// Market lookup response from /api/intelligence/lookup
export interface MarketLookupResponse {
  found: boolean;
  city?: string;
  state?: string;
  country?: string;
  market?: string;
  market_anchor?: string;
  region_type?: 'Core' | 'Satellite' | 'Rural';
  market_slug?: string;
  deadhead_risk?: {
    level: 'low' | 'medium' | 'high' | 'unknown';
    score: number;
    description: string;
    advice: string;
  };
  market_stats?: {
    total_cities: string;
    core_count: string;
    satellite_count: string;
    rural_count: string;
  };
  market_cities?: Array<{
    city: string;
    region: string;
    region_type: string;
  }>;
  message?: string;
  suggestions?: Array<{
    city: string;
    state: string;
    market: string;
  }>;
}

// Market archetype detection based on city characteristics
export type MarketArchetype = 'sprawl' | 'dense' | 'party';

export interface MarketArchetypeInfo {
  type: MarketArchetype;
  name: string;
  description: string;
  examples: string[];
  color: string;
}

export const MARKET_ARCHETYPES: Record<MarketArchetype, MarketArchetypeInfo> = {
  sprawl: {
    type: 'sprawl',
    name: 'Sprawl City',
    description: 'High mileage, car dependency, and morning airport rushes. Speed is high, but deadhead risk is extreme.',
    examples: ['Dallas', 'Phoenix', 'Houston', 'Atlanta', 'Los Angeles'],
    color: 'amber'
  },
  dense: {
    type: 'dense',
    name: 'Dense Metro',
    description: 'Short trips, high traffic, constant demand. Focus on ride volume and staying in the core.',
    examples: ['New York', 'San Francisco', 'Chicago', 'Boston', 'Philadelphia'],
    color: 'blue'
  },
  party: {
    type: 'party',
    name: 'Tourism/Party',
    description: 'Extreme peaks, dead mornings. Sleep all day, drive all night. Focus on events and safety.',
    examples: ['Miami', 'Las Vegas', 'New Orleans', 'Nashville', 'Austin'],
    color: 'purple'
  }
};

/**
 * Comprehensive city-to-Uber-market mapping
 * Based on official Uber market data covering all US states
 */
const CITY_TO_MARKET: Record<string, string> = {
  // Texas - Dallas market
  'dallas': 'dallas', 'addison': 'dallas', 'allen': 'dallas', 'carrollton': 'dallas',
  'farmers branch': 'dallas', 'garland': 'dallas', 'irving': 'dallas', 'lewisville': 'dallas',
  'plano': 'dallas', 'richardson': 'dallas', 'the colony': 'dallas', 'frisco': 'dallas',
  'prosper': 'dallas', 'coppell': 'dallas', 'mckinney': 'dallas',

  // Texas - Fort Worth market
  'fort worth': 'fort-worth', 'north richland hills': 'fort-worth', 'saginaw': 'fort-worth',
  'benbrook': 'fort-worth', 'keller': 'fort-worth', 'weatherford': 'fort-worth',

  // Texas - Other markets (pasadena exists in CA too, add state-specific)
  'houston': 'houston', 'baytown': 'houston', 'pasadena, tx': 'houston', 'sugar land': 'houston',
  'pearland': 'houston', 'conroe': 'houston', 'the woodlands': 'houston', 'galveston': 'houston',
  'austin': 'austin', 'round rock': 'austin', 'cedar park': 'austin', 'georgetown': 'austin', 'pflugerville': 'austin',
  'san antonio': 'san-antonio', 'new braunfels': 'san-antonio', 'san marcos': 'san-antonio',
  'el paso': 'el-paso', 'laredo': 'laredo', 'corpus christi': 'corpus-christi',
  'lubbock': 'lubbock', 'amarillo': 'amarillo', 'waco': 'waco',

  // California - Los Angeles market (note: pasadena/glendale exist in multiple states, using CA as default)
  'los angeles': 'los-angeles', 'la': 'los-angeles', 'anaheim': 'los-angeles', 'long beach': 'los-angeles',
  'santa monica': 'los-angeles', 'irvine': 'los-angeles', 'burbank': 'los-angeles', 'pasadena': 'los-angeles',
  'glendale': 'los-angeles', 'inglewood': 'los-angeles', 'pomona': 'los-angeles', 'torrance': 'los-angeles',
  'pasadena, ca': 'los-angeles', 'glendale, ca': 'los-angeles',

  // California - SF Bay Area market
  'san francisco': 'san-francisco-bay-area', 'oakland': 'san-francisco-bay-area', 'san jose': 'san-francisco-bay-area',
  'berkeley': 'san-francisco-bay-area', 'fremont': 'san-francisco-bay-area', 'sunnyvale': 'san-francisco-bay-area',
  'palo alto': 'san-francisco-bay-area', 'redwood city': 'san-francisco-bay-area',

  // California - Other markets
  'san diego': 'san-diego', 'chula vista': 'san-diego', 'carlsbad': 'san-diego', 'escondido': 'san-diego',
  'sacramento': 'sacramento', 'roseville': 'sacramento', 'elk grove': 'sacramento', 'folsom': 'sacramento',
  'fresno': 'fresno', 'clovis': 'fresno', 'bakersfield': 'bakersfield',
  'riverside': 'inland-empire', 'san bernardino': 'inland-empire', 'ontario': 'inland-empire',

  // New York - NYC market
  'new york': 'new-york-city', 'nyc': 'new-york-city', 'manhattan': 'new-york-city',
  'brooklyn': 'new-york-city', 'queens': 'new-york-city', 'bronx': 'new-york-city', 'staten island': 'new-york-city',

  // New York - Other markets
  'albany': 'upstate-ny', 'rochester': 'upstate-ny', 'syracuse': 'upstate-ny', 'buffalo': 'upstate-ny', 'ithaca': 'upstate-ny',
  'long island': 'nyc-suburbs', 'hempstead': 'nyc-suburbs', 'poughkeepsie': 'nyc-suburbs',

  // Florida
  'miami': 'miami', 'fort lauderdale': 'miami', 'west palm beach': 'miami', 'boca raton': 'miami',
  'orlando': 'orlando', 'kissimmee': 'orlando', 'sanford': 'orlando', 'winter park': 'orlando',
  'tampa': 'tampa-bay', 'st. petersburg': 'tampa-bay', 'clearwater': 'tampa-bay', 'lakeland': 'tampa-bay',
  'jacksonville': 'jacksonville', 'st. augustine': 'jacksonville',
  'key west': 'florida-keys', 'marathon': 'florida-keys', 'key largo': 'florida-keys',
  'fort myers': 'fort-myers-naples', 'naples': 'fort-myers-naples', 'cape coral': 'fort-myers-naples',

  // Illinois (note: aurora exists in CO too, using IL as default since it's larger)
  'chicago': 'chicago', 'aurora': 'chicago', 'naperville': 'chicago', 'joliet': 'chicago',
  'elgin': 'chicago', 'waukegan': 'chicago', 'aurora, il': 'chicago',

  // Arizona (glendale already defined for LA, add state-specific)
  'phoenix': 'phoenix', 'mesa': 'phoenix', 'chandler': 'phoenix', 'gilbert': 'phoenix',
  'scottsdale': 'phoenix', 'tempe': 'phoenix', 'peoria': 'phoenix', 'glendale, az': 'phoenix',
  'tucson': 'tucson', 'oro valley': 'tucson',

  // Nevada
  'las vegas': 'las-vegas', 'henderson': 'las-vegas', 'north las vegas': 'las-vegas',
  'reno': 'reno', 'sparks': 'reno', 'carson city': 'reno',

  // Georgia
  'atlanta': 'atlanta', 'marietta': 'atlanta', 'decatur': 'atlanta', 'sandy springs': 'atlanta',
  'roswell': 'atlanta', 'alpharetta': 'atlanta',
  'savannah': 'coastal-georgia', 'brunswick': 'coastal-georgia',

  // Washington
  'seattle': 'seattle', 'bellevue': 'seattle', 'tacoma': 'seattle', 'everett': 'seattle',
  'kirkland': 'seattle', 'redmond': 'seattle',
  'spokane': 'eastern-washington', 'yakima': 'eastern-washington',

  // Colorado (aurora already defined for Chicago, add state-specific)
  'denver': 'denver', 'aurora, co': 'denver', 'lakewood': 'denver', 'boulder': 'denver',
  'colorado springs': 'colorado-springs', 'pueblo': 'colorado-springs',
  'aspen': 'rockies', 'vail': 'rockies', 'breckenridge': 'rockies',

  // Massachusetts
  'boston': 'boston', 'cambridge': 'boston', 'worcester': 'boston',
  'springfield': 'western-massachusetts', 'pittsfield': 'western-massachusetts',

  // Pennsylvania
  'philadelphia': 'philadelphia', 'pittsburgh': 'pittsburgh',
  'harrisburg': 'harrisburg', 'lancaster': 'lancaster',
  'allentown': 'lehigh-valley', 'bethlehem': 'lehigh-valley',

  // Tennessee
  'nashville': 'nashville', 'murfreesboro': 'nashville', 'franklin': 'nashville',
  'memphis': 'memphis', 'knoxville': 'knoxville', 'chattanooga': 'chattanooga',

  // Louisiana
  'new orleans': 'new-orleans', 'metairie': 'new-orleans', 'kenner': 'new-orleans',
  'baton rouge': 'baton-rouge',

  // North Carolina
  'charlotte': 'charlotte', 'concord': 'charlotte', 'gastonia': 'charlotte',
  'raleigh': 'raleigh-durham', 'durham': 'raleigh-durham', 'chapel hill': 'raleigh-durham',
  'greensboro': 'piedmont-triad', 'winston-salem': 'piedmont-triad',
  'asheville': 'asheville',

  // Ohio
  'columbus': 'columbus', 'cleveland': 'cleveland', 'cincinnati': 'cincinnati',
  'dayton': 'dayton', 'toledo': 'toledo', 'akron': 'akron',

  // Michigan
  'detroit': 'detroit', 'warren': 'detroit', 'dearborn': 'detroit',
  'ann arbor': 'ann-arbor', 'grand rapids': 'grand-rapids',

  // Minnesota
  'minneapolis': 'minneapolis-st-paul', 'saint paul': 'minneapolis-st-paul', 'st. paul': 'minneapolis-st-paul',

  // Oregon
  'portland': 'portland', 'beaverton': 'portland', 'hillsboro': 'portland',
  'eugene': 'eugene', 'salem': 'willamette-valley',

  // DC
  'washington': 'washington-dc', 'dc': 'washington-dc', 'washington, d.c.': 'washington-dc',

  // Maryland (columbia exists in SC too, using MD as default)
  'baltimore': 'baltimore', 'columbia': 'baltimore', 'columbia, md': 'baltimore',

  // Virginia
  'norfolk': 'hampton-roads', 'virginia beach': 'hampton-roads', 'chesapeake': 'hampton-roads',
  'richmond': 'richmond', 'roanoke': 'roanoke-blacksburg',

  // South Carolina (columbia already defined for MD, add state-specific)
  'charleston': 'charleston', 'columbia, sc': 'columbia-sc', 'greenville': 'greenville',
  'myrtle beach': 'myrtle-beach',

  // Indiana
  'indianapolis': 'indianapolis', 'carmel': 'indianapolis', 'fishers': 'indianapolis',
  'fort wayne': 'fort-wayne',

  // Missouri
  'kansas city': 'kansas-city', 'st. louis': 'st-louis', 'saint louis': 'st-louis',

  // Wisconsin
  'milwaukee': 'milwaukee', 'madison': 'madison',

  // Kentucky
  'louisville': 'louisville', 'lexington': 'lexington',

  // Alabama
  'birmingham': 'birmingham', 'huntsville': 'huntsville', 'mobile': 'mobile', 'montgomery': 'montgomery',

  // Oklahoma
  'oklahoma city': 'oklahoma-city', 'tulsa': 'tulsa',

  // Iowa
  'des moines': 'des-moines', 'cedar rapids': 'cedar-rapids', 'iowa city': 'iowa-city',

  // Utah
  'salt lake city': 'salt-lake-city', 'ogden': 'salt-lake-city', 'provo': 'salt-lake-city',

  // Hawaii
  'honolulu': 'honolulu', 'hilo': 'big-island', 'kona': 'big-island',
  'kahului': 'maui', 'lahaina': 'maui',

  // Puerto Rico
  'san juan': 'san-juan', 'ponce': 'ponce', 'mayaguez': 'mayaguez',
};

/**
 * Derives a market slug from city and state
 * Uses comprehensive Uber market mapping data
 */
export function deriveMarketSlug(city: string | null, _state: string | null): string | null {
  if (!city) return null;

  const cityLower = city.toLowerCase().trim();

  // Check direct mapping first
  if (CITY_TO_MARKET[cityLower]) {
    return CITY_TO_MARKET[cityLower];
  }

  // Fallback: generate slug from city name
  return cityLower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Detects the market archetype based on city
 */
export function detectMarketArchetype(city: string | null): MarketArchetype {
  if (!city) return 'sprawl'; // Default

  const cityLower = city.toLowerCase();

  // Dense metros
  const denseMetros = ['new york', 'manhattan', 'brooklyn', 'san francisco', 'chicago', 'boston', 'philadelphia', 'washington', 'dc'];
  if (denseMetros.some(d => cityLower.includes(d))) return 'dense';

  // Party/Tourism cities
  const partyCities = ['miami', 'las vegas', 'new orleans', 'nashville', 'austin', 'key west', 'atlantic city'];
  if (partyCities.some(p => cityLower.includes(p))) return 'party';

  // Default to sprawl (most common US cities)
  return 'sprawl';
}

/**
 * Fetches all intelligence for a specific market
 */
async function fetchMarketIntelligence(marketSlug: string): Promise<MarketIntelligenceResponse> {
  const response = await fetch(`/api/intelligence/market/${encodeURIComponent(marketSlug)}`);

  if (!response.ok) {
    if (response.status === 404) {
      // Return empty result for markets with no intelligence yet
      return {
        market: marketSlug,
        market_name: marketSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        total_items: 0,
        by_type: {} as Record<IntelType, IntelligenceItem[]>,
        intelligence: []
      };
    }
    throw new Error('Failed to fetch market intelligence');
  }

  return response.json();
}

/**
 * Fetches list of all markets with intelligence
 */
async function fetchIntelligenceMarkets(): Promise<IntelligenceMarketsResponse> {
  const response = await fetch('/api/intelligence/markets');

  if (!response.ok) {
    throw new Error('Failed to fetch intelligence markets');
  }

  return response.json();
}

/**
 * Fetches market lookup data for a city/state
 */
async function fetchMarketLookup(city: string, state: string): Promise<MarketLookupResponse> {
  const params = new URLSearchParams({ city, state });
  const response = await fetch(`/api/intelligence/lookup?${params}`);

  if (!response.ok) {
    // Return not found response
    return { found: false, message: `No market data for ${city}, ${state}` };
  }

  return response.json();
}

/**
 * Main hook for fetching market intelligence
 */
export function useMarketIntelligence() {
  const { city, state, isLocationResolved } = useLocation();

  // Derive market slug from location
  const marketSlug = deriveMarketSlug(city, state);
  const archetype = detectMarketArchetype(city);
  const archetypeInfo = MARKET_ARCHETYPES[archetype];

  // Fetch market lookup data (includes region type, deadhead risk, etc.)
  const marketLookupQuery = useQuery({
    queryKey: ['marketLookup', city, state],
    queryFn: () => city && state ? fetchMarketLookup(city, state) : Promise.resolve({ found: false }),
    enabled: !!city && !!state && isLocationResolved,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  // Use market slug from lookup if available, otherwise derive it
  const effectiveMarketSlug = marketLookupQuery.data?.market_slug || marketSlug;

  // Fetch intelligence for the detected market
  const intelligenceQuery = useQuery({
    queryKey: ['marketIntelligence', effectiveMarketSlug],
    queryFn: () => effectiveMarketSlug ? fetchMarketIntelligence(effectiveMarketSlug) : Promise.resolve(null),
    enabled: !!effectiveMarketSlug && isLocationResolved,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  // Fetch all available markets
  const marketsQuery = useQuery({
    queryKey: ['intelligenceMarkets'],
    queryFn: fetchIntelligenceMarkets,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Extract market lookup data
  const marketLookup = marketLookupQuery.data;
  const intelligenceData = intelligenceQuery.data;

  // ---------------------------------------------------------------------------
  // 🛡️ CRITICAL FIX: Single useMemo to prevent infinite re-render loops
  //
  // Problem: Individual useMemos with array dependencies (like [zones])
  // still cause loops because the array REFERENCE changes every render.
  //
  // Solution: Bundle ALL array processing in ONE useMemo with intelligenceData
  // as the single dependency. React Query keeps intelligenceData reference
  // stable between renders.
  // ---------------------------------------------------------------------------
  const processedData = useMemo(() => {
    // Stable empty array - same reference reused for all empty returns
    const EMPTY: IntelligenceItem[] = [];

    // Helper to safely get by type (uses stable empty array)
    const getByType = (type: IntelType) => intelligenceData?.by_type?.[type] || EMPTY;

    const zones = getByType('zone');

    return {
      // Type-based accessors
      zones,
      strategies: getByType('strategy'),
      regulatory: getByType('regulatory'),
      safety: getByType('safety'),
      timing: getByType('timing'),
      airport: getByType('airport'),
      algorithm: getByType('algorithm'),

      // Zone subtypes (filtered from memoized zones)
      honeyHoles: zones.filter(z => z.intel_subtype === 'honey_hole'),
      dangerZones: zones.filter(z => z.intel_subtype === 'danger_zone'),
      deadZones: zones.filter(z => z.intel_subtype === 'dead_zone'),
      safeCorridor: zones.filter(z => z.intel_subtype === 'safe_corridor'),
      cautionZones: zones.filter(z => z.intel_subtype === 'caution_zone'),
    };
  }, [intelligenceData]); // Single stable dependency from React Query

  // Memoize markets list separately (different query)
  const markets = useMemo(() => {
    return marketsQuery.data?.markets || [];
  }, [marketsQuery.data]);

  // Memoize market cities separately (from lookup query)
  const marketCities = useMemo(() => {
    return marketLookup?.market_cities || [];
  }, [marketLookup]);

  return {
    // Location info
    city,
    state,
    marketSlug: effectiveMarketSlug,
    isLocationResolved,

    // Market archetype
    archetype,
    archetypeInfo,

    // Market structure data from research
    marketAnchor: marketLookup?.market_anchor || null,
    regionType: marketLookup?.region_type || null,
    deadheadRisk: marketLookup?.deadhead_risk || null,
    marketStats: marketLookup?.market_stats || null,
    marketCities,
    isMarketLookupLoading: marketLookupQuery.isLoading,

    // Intelligence data
    intelligence: intelligenceData,
    isLoading: intelligenceQuery.isLoading || marketLookupQuery.isLoading,
    error: intelligenceQuery.error,

    // Markets list
    markets,
    marketsLoading: marketsQuery.isLoading,

    // Spread all memoized arrays from processedData
    // (zones, strategies, regulatory, safety, timing, airport, algorithm,
    //  honeyHoles, dangerZones, deadZones, safeCorridor, cautionZones)
    ...processedData,
  };
}
