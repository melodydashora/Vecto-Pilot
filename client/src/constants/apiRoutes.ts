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
    RELEASE_SNAPSHOT: '/api/location/release-snapshot',
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
    TACTICAL_PLAN: '/api/strategy/tactical-plan',
    RETRY: (snapshotId: string) => `/api/strategy/${snapshotId}/retry`,
    HISTORY: '/api/strategy/history',
    // Legacy — prefer BLOCKS.STRATEGY for polling, BRIEFING.* for section data
    LEGACY_GET: (snapshotId: string) => `/api/strategy/${snapshotId}`,
    LEGACY_BRIEFING: (snapshotId: string) => `/api/strategy/briefing/${snapshotId}`,
    LEGACY_RUN: (snapshotId: string) => `/api/strategy/run/${snapshotId}`,
    LEGACY_SEED: '/api/strategy/seed',
  },

  // =========================================================================
  // Briefing
  // =========================================================================
  BRIEFING: {
    // 2026-04-19: Per-section route helpers (WEATHER/TRAFFIC/RIDESHARE_NEWS/
    // SCHOOL_CLOSURES/AIRPORT/EVENTS) deleted — `useBriefingQueries` was the
    // only consumer and now uses AGGREGATE. The corresponding server endpoints
    // remain in `server/api/briefing/briefing.js` for any external/legacy
    // callers (Siri shortcuts, admin tools), but the client should not hit
    // them — going through AGGREGATE preserves the transparency contract
    // between the briefing tab and what the strategist receives.
    AGGREGATE: (snapshotId: string) => `/api/briefing/snapshot/${snapshotId}`,
    EVENTS_ACTIVE: (snapshotId: string) => `/api/briefing/events/${snapshotId}?filter=active`,
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
    // 2026-04-25 (P2-8): UBER.{YEARS,MAKES,MODELS} block removed.
    // No server implementation existed at /api/platform/uber/{years,makes,models}
    // and no client code referenced these constants. The VEHICLE block below
    // (/api/vehicle/*) is the live vehicle-lookup path.
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
  // Translation (real-time driver-rider communication)
  // 2026-03-16: Added for FIFA World Cup rider translation feature
  // =========================================================================
  TRANSLATE: {
    SEND: '/api/translate',
    LANGUAGES: '/api/translate/languages',
  },

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
  // Concierge (QR code sharing + public event discovery)
  // =========================================================================
  CONCIERGE: {
    TOKEN: '/api/concierge/token',
    PREVIEW: '/api/concierge/preview',
    PUBLIC_PROFILE: (token: string) => `/api/concierge/p/${token}`,
    PUBLIC_WEATHER: (token: string, lat: number, lng: number) =>
      `/api/concierge/p/${token}/weather?lat=${lat}&lng=${lng}`,
    PUBLIC_EXPLORE: (token: string) => `/api/concierge/p/${token}/explore`,
    PUBLIC_ASK: (token: string) => `/api/concierge/p/${token}/ask`,
    PUBLIC_ASK_STREAM: (token: string) => `/api/concierge/p/${token}/ask-stream`,
    PUBLIC_FEEDBACK: (token: string) => `/api/concierge/p/${token}/feedback`,
    FEEDBACK_SUMMARY: '/api/concierge/feedback',
  },

  // =========================================================================
  // Diagnostic
  // =========================================================================
  DIAGNOSTIC: {
    IDENTITY: '/api/diagnostic/identity',
  },

  // =========================================================================
  // User block removed 2026-04-25 (P2-7): /api/users/me had zero callers and
  // was unreachable at the documented path (server route was mounted at
  // /api/location/users/me). Re-introduce only when an actual consumer exists.
  // =========================================================================

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
  // 2026-04-18: Phase B — single aggregate key for the briefing tab's one-shot fetch.
  // 2026-04-19: Per-section query keys (BRIEFING_WEATHER/TRAFFIC/EVENTS/
  // RIDESHARE_NEWS/SCHOOL_CLOSURES/AIRPORT) deleted — they had no consumers
  // after the Phase B refactor. BRIEFING_EVENTS_ACTIVE retained for MapPage's
  // useActiveEventsQuery (real-time active events filter, separate from the tab).
  BRIEFING_AGGREGATE: (snapshotId: string) => ['/api/briefing/snapshot', snapshotId] as const,
  BRIEFING_EVENTS_ACTIVE: (snapshotId: string) => ['/api/briefing/events', snapshotId, 'active'] as const,

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
