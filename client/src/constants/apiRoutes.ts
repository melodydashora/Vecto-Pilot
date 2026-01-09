/**
 * Centralized API route strings
 *
 * RULE: No inline "/api/..." strings outside this file.
 * This provides a single source of truth for all API endpoints.
 *
 * @created 2026-01-06 (P4-F audit remediation)
 */

export const API_ROUTES = {
  // Authentication
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    REFRESH: '/api/auth/refresh',
  },

  // Location
  LOCATION: {
    RESOLVE: '/api/location/resolve',
    SNAPSHOT: '/api/location/snapshot',
    WEATHER: '/api/location/weather',
    AIR_QUALITY: '/api/location/airquality',
  },

  // Strategy & Blocks
  BLOCKS: {
    FAST: '/api/blocks-fast',
    STRATEGY: (snapshotId: string) => `/api/blocks/strategy/${snapshotId}`,
  },

  // Briefing
  BRIEFING: {
    WEATHER: (snapshotId: string) => `/api/briefing/weather/${snapshotId}`,
    TRAFFIC: (snapshotId: string) => `/api/briefing/traffic/${snapshotId}`,
    EVENTS: (snapshotId: string) => `/api/briefing/events/${snapshotId}`,
    RIDESHARE_NEWS: (snapshotId: string) => `/api/briefing/rideshare-news/${snapshotId}`,
    SCHOOL_CLOSURES: (snapshotId: string) => `/api/briefing/school-closures/${snapshotId}`,
    AIRPORT: (snapshotId: string) => `/api/briefing/airport/${snapshotId}`,
  },

  // Venues
  VENUES: {
    NEARBY: '/api/venues/nearby',
    DETAILS: (placeId: string) => `/api/venues/${placeId}`,
  },

  // Chat/Coach
  CHAT: {
    SEND: '/api/chat/send',
    TTS: '/api/chat/tts',
    NOTES: '/api/coach/notes',
  },

  // Agent (internal/dev)
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

  // Feedback
  FEEDBACK: {
    SUBMIT: '/api/feedback',
    ACTIONS: '/api/feedback/actions',
  },

  // User
  USER: {
    PROFILE: '/api/users/me',
    UPDATE: '/api/users/me',
  },
} as const;
