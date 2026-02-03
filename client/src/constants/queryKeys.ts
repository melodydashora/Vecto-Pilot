/**
 * Centralized React Query keys
 *
 * RULE: Never use ad-hoc arrays for query keys - use these factories.
 * This ensures cache invalidation works correctly across components.
 *
 * @created 2026-01-06 (P4-F audit remediation)
 */

/**
 * Query key factories - always use these to build query keys
 */
export const queryKeys = {
  // Strategy & Blocks
  strategy: (snapshotId: string | null) => ['/api/blocks/strategy', snapshotId] as const,
  strategyBase: () => ['/api/blocks/strategy'] as const,
  blocksFast: (snapshotId: string | null) => ['/api/blocks-fast', snapshotId] as const,
  snapshot: (snapshotId: string | null) => ['/api/snapshot', snapshotId] as const,

  // Bars/Venues
  barTab: (params: { lat: number | null; lng: number | null; city: string | null; state: string | null; timezone: string | null }) =>
    ['bar-tab', params.lat, params.lng, params.city, params.state, params.timezone] as const,
  mapBars: (params: { lat: number | null; lng: number | null; timezone: string | null }) =>
    ['map-bars', params.lat, params.lng, params.timezone] as const,

  // Briefing
  briefing: {
    weather: (snapshotId: string) => ['/api/briefing/weather', snapshotId] as const,
    traffic: (snapshotId: string) => ['/api/briefing/traffic', snapshotId] as const,
    rideshareNews: (snapshotId: string) => ['/api/briefing/rideshare-news', snapshotId] as const,
    events: (snapshotId: string) => ['/api/briefing/events', snapshotId] as const,
    schoolClosures: (snapshotId: string) => ['/api/briefing/school-closures', snapshotId] as const,
    airport: (snapshotId: string) => ['/api/briefing/airport', snapshotId] as const,
  },

  // Platform data
  platform: {
    markets: (platform: string) => ['platform-markets', platform] as const,
    marketCities: (market: string, platform: string) => ['platform-market-cities', market, platform] as const,
    countries: (platform: string) => ['platform-countries', platform] as const,
    stats: (platform: string) => ['platform-stats', platform] as const,
    search: (query: string, platform: string, limit: number) => ['platform-search', query, platform, limit] as const,
  },
} as const;
