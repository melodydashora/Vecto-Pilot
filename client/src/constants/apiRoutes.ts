/**
 * Centralized API route strings
 *
 * RULE: No inline "/api/..." strings outside this file.
 * This provides a single source of truth for all API endpoints.
 *
 * @created 2026-01-06 (P4-F audit remediation)
 * @updated 2026-01-15 (Complete audit - ALL endpoints centralized)
 */

export const API_ROUTES = {
  // =========================================================================
  // Authentication
  // =========================================================================
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    REFRESH: '/api/auth/refresh',
    PROFILE: '/api/auth/profile',
    FORGOT_PASSWORD: '/api/auth/forgot-password',
    RESET_PASSWORD: '/api/auth/reset-password',
    GOOGLE: '/api/auth/google',
    GOOGLE_SIGNUP: '/api/auth/google?mode=signup',
    GOOGLE_CALLBACK: '/api/auth/google/exchange',
    APPLE: '/api/auth/apple',
    APPLE_SIGNUP: '/api/auth/apple?mode=signup',
  },

  // =========================================================================
  // Location
  // =========================================================================
  LOCATION: {
    RESOLVE: '/api/location/resolve',
    RESOLVE_WITH_PARAMS: (lat: number, lng: number, deviceId: string, accuracy: number) =>
      `/api/location/resolve?lat=${lat}&lng=${lng}&device_id=${encodeURIComponent(deviceId)}&accuracy=${accuracy}&coord_source=gps`,
    SNAPSHOT: '/api/location/snapshot',
    SNAPSHOT_ENRICH: (snapshotId: string) => `/api/location/snapshot/${snapshotId}/enrich`,
    WEATHER: '/api/location/weather',
    WEATHER_WITH_COORDS: (lat: number, lng: number) => `/api/location/weather?lat=${lat}&lng=${lng}`,
    AIR_QUALITY: '/api/location/airquality',
    AIR_QUALITY_WITH_COORDS: (lat: number, lng: number) => `/api/location/airquality?lat=${lat}&lng=${lng}`,
  },

  // =========================================================================
  // Snapshots
  // =========================================================================
  SNAPSHOT: {
    GET: (snapshotId: string) => `/api/snapshot/${snapshotId}`,
  },

  // =========================================================================
  // Strategy & Blocks
  // =========================================================================
  BLOCKS: {
    FAST: '/api/blocks-fast',
    FAST_WITH_QUERY: (snapshotId: string) => `/api/blocks-fast?snapshotId=${snapshotId}`,
    STRATEGY: (snapshotId: string) => `/api/blocks/strategy/${snapshotId}`,
  },

  STRATEGY: {
    DAILY: (snapshotId: string) => `/api/strategy/daily/${snapshotId}`,
    TACTICAL_PLAN: '/api/strategy/tactical-plan',
  },

  // =========================================================================
  // Briefing
  // =========================================================================
  BRIEFING: {
    WEATHER: (snapshotId: string) => `/api/briefing/weather/${snapshotId}`,
    TRAFFIC: (snapshotId: string) => `/api/briefing/traffic/${snapshotId}`,
    EVENTS: (snapshotId: string) => `/api/briefing/events/${snapshotId}`,
    EVENTS_ACTIVE: (snapshotId: string) => `/api/briefing/events/${snapshotId}?filter=active`,
    RIDESHARE_NEWS: (snapshotId: string) => `/api/briefing/rideshare-news/${snapshotId}`,
    SCHOOL_CLOSURES: (snapshotId: string) => `/api/briefing/school-closures/${snapshotId}`,
    AIRPORT: (snapshotId: string) => `/api/briefing/airport/${snapshotId}`,
    REFRESH_DAILY: (snapshotId: string) => `/api/briefing/refresh-daily/${snapshotId}`,
    DISCOVERED_EVENTS: (snapshotId: string) => `/api/briefing/discovered-events/${snapshotId}`,
    EVENT_DEACTIVATE: (eventId: string) => `/api/briefing/event/${eventId}/deactivate`,
  },

  // =========================================================================
  // Venues
  // =========================================================================
  VENUES: {
    NEARBY: '/api/venues/nearby',
    NEARBY_WITH_PARAMS: (params: URLSearchParams) => `/api/venues/nearby?${params}`,
    DETAILS: (placeId: string) => `/api/venues/${placeId}`,
  },

  // =========================================================================
  // Intelligence
  // =========================================================================
  INTELLIGENCE: {
    MARKETS: '/api/intelligence/markets',
    MARKETS_DROPDOWN: '/api/intelligence/markets-dropdown',
    MARKET: (slug: string) => `/api/intelligence/market/${encodeURIComponent(slug)}`,
    LOOKUP: '/api/intelligence/lookup',
    LOOKUP_WITH_PARAMS: (params: URLSearchParams) => `/api/intelligence/lookup?${params}`,
    FOR_LOCATION: '/api/intelligence/for-location',
    FOR_LOCATION_WITH_PARAMS: (params: URLSearchParams) => `/api/intelligence/for-location?${params}`,
    STAGING_AREAS: (snapshotId: string) => `/api/intelligence/staging-areas?snapshotId=${snapshotId}`,
    ADD_MARKET: '/api/intelligence/add-market',
  },

  // =========================================================================
  // Platform
  // =========================================================================
  PLATFORM: {
    COUNTRIES: (platform: string) => `/api/platform/countries?platform=${platform}`,
    COUNTRIES_DROPDOWN: '/api/platform/countries-dropdown?all=true',
    REGIONS: (country: string) => `/api/platform/regions?country=${country}`,
    REGIONS_DROPDOWN: (country: string) => `/api/platform/regions-dropdown?country=${encodeURIComponent(country)}`,
    MARKETS: (platform: string) => `/api/platform/markets?platform=${platform}`,
    MARKETS_BY_COUNTRY: (country: string) => `/api/platform/markets?country=${country}`,
    MARKETS_DROPDOWN: (country: string) => `/api/platform/markets-dropdown?country=${encodeURIComponent(country)}`,
    MARKET_DETAILS: (market: string, platform: string) => `/api/platform/markets/${encodeURIComponent(market)}?platform=${platform}`,
    STATS: (platform: string) => `/api/platform/stats?platform=${platform}`,
    SEARCH: (query: string, platform: string, limit: number) =>
      `/api/platform/search?q=${encodeURIComponent(query)}&platform=${platform}&limit=${limit}`,
    UBER: {
      YEARS: '/api/platform/uber/years',
      MAKES: (year: string) => `/api/platform/uber/makes?year=${year}`,
      MODELS: (year: string, make: string) => `/api/platform/uber/models?year=${year}&make=${encodeURIComponent(make)}`,
    },
  },

  // =========================================================================
  // Vehicle
  // =========================================================================
  VEHICLE: {
    YEARS: '/api/vehicle/years',
    MAKES: '/api/vehicle/makes',
    MODELS: (make: string, year?: number) =>
      `/api/vehicle/models?make=${encodeURIComponent(make)}${year ? `&year=${year}` : ''}`,
  },

  // =========================================================================
  // Chat & Coach
  // =========================================================================
  CHAT: {
    SEND: '/api/chat',
    LEGACY_SEND: '/api/chat/send',
  },

  COACH: {
    NOTES: '/api/coach/notes',
    NOTES_WITH_PARAMS: '/api/coach/notes?sort=pinned&limit=50',
    NOTE: (noteId: string) => `/api/coach/notes/${noteId}`,
    NOTE_PIN: (noteId: string) => `/api/coach/notes/${noteId}/pin`,
  },

  TTS: '/api/tts',

  // =========================================================================
  // Realtime
  // =========================================================================
  REALTIME: {
    TOKEN: '/api/realtime/token',
  },

  // =========================================================================
  // Feedback
  // =========================================================================
  FEEDBACK: {
    SUBMIT: '/api/feedback',
    APP: '/api/feedback/app',
    STRATEGY: '/api/feedback/strategy',
    VENUE: '/api/feedback/venue',
    ACTIONS: '/api/feedback/actions',
  },

  // =========================================================================
  // Actions (logging)
  // =========================================================================
  ACTIONS: '/api/actions',

  // =========================================================================
  // Diagnostic
  // =========================================================================
  DIAGNOSTIC: {
    IDENTITY: '/api/diagnostic/identity',
  },

  // =========================================================================
  // User
  // =========================================================================
  USER: {
    PROFILE: '/api/users/me',
    UPDATE: '/api/users/me',
  },

  // =========================================================================
  // Agent (internal/dev)
  // =========================================================================
  AGENT: {
    CONTEXT: '/agent/context',
    MEMORY: {
      CONVERSATIONS: '/agent/memory/conversations',
      CONVERSATION: '/agent/memory/conversation',
      PREFERENCE: '/agent/memory/preference',
      SESSION: '/agent/memory/session',
      PROJECT: '/agent/memory/project',
    },
  },
} as const;

/**
 * Query keys for React Query cache management
 *
 * RULE: All useQuery calls must use these keys for consistent caching.
 * Using different strings for the same endpoint causes cache mismatches
 * and duplicate network requests.
 *
 * @created 2026-01-15 (API_ROUTES enforcement audit)
 */
export const QUERY_KEYS = {
  // =========================================================================
  // Strategy & Blocks
  // =========================================================================
  BLOCKS_STRATEGY: (snapshotId: string | null) => ['/api/blocks/strategy', snapshotId] as const,
  BLOCKS_STRATEGY_BASE: ['/api/blocks/strategy'] as const,
  BLOCKS_FAST: (snapshotId: string | null) => ['/api/blocks-fast', snapshotId] as const,

  // =========================================================================
  // Snapshots
  // =========================================================================
  SNAPSHOT: (snapshotId: string | null) => ['/api/snapshot', snapshotId] as const,

  // =========================================================================
  // Briefing
  // =========================================================================
  BRIEFING_WEATHER: (snapshotId: string) => ['/api/briefing/weather', snapshotId] as const,
  BRIEFING_TRAFFIC: (snapshotId: string) => ['/api/briefing/traffic', snapshotId] as const,
  BRIEFING_EVENTS: (snapshotId: string) => ['/api/briefing/events', snapshotId] as const,
  BRIEFING_EVENTS_ACTIVE: (snapshotId: string) => ['/api/briefing/events', snapshotId, 'active'] as const,
  BRIEFING_RIDESHARE_NEWS: (snapshotId: string) => ['/api/briefing/rideshare-news', snapshotId] as const,
  BRIEFING_SCHOOL_CLOSURES: (snapshotId: string) => ['/api/briefing/school-closures', snapshotId] as const,
  BRIEFING_AIRPORT: (snapshotId: string) => ['/api/briefing/airport', snapshotId] as const,

  // =========================================================================
  // Auth
  // =========================================================================
  AUTH_ME: (deviceId: string) => ['/api/auth/me', deviceId] as const,

  // =========================================================================
  // Intelligence
  // =========================================================================
  INTELLIGENCE_MARKETS: ['/api/intelligence/markets'] as const,
  INTELLIGENCE_MARKET: (slug: string) => ['/api/intelligence/market', slug] as const,
} as const;
