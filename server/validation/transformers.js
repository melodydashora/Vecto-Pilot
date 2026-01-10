// server/validation/transformers.js
// ============================================================================
// DATA TRANSFORMATION LAYER
// ============================================================================
//
// PURPOSE: Single source of truth for transforming data between layers:
//   - DB (snake_case) → Server domain model → API (camelCase) → Client
//
// CONVENTION:
//   - Database tables: snake_case (PostgreSQL standard)
//   - Server internal: snake_case (matches DB for simplicity)
//   - API responses: camelCase (JavaScript/JSON convention)
//   - Client types: camelCase (TypeScript/React convention)
//
// USAGE:
//   import { toApiVenue, toApiBlock } from '../validation/transformers.js';
//   res.json({ success: true, data: toApiVenueData(dbResult) });
//
// ============================================================================

// ============================================================================
// GENERIC CASE CONVERTERS
// ============================================================================

/**
 * Convert snake_case to camelCase
 * @param {string} str - Snake case string (e.g., 'my_variable_name')
 * @returns {string} Camel case string (e.g., 'myVariableName')
 */
export function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 * @param {string} str - Camel case string (e.g., 'myVariableName')
 * @returns {string} Snake case string (e.g., 'my_variable_name')
 */
export function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Transform all keys in an object from snake_case to camelCase
 * Recursively handles nested objects and arrays
 */
export function transformKeysToCamel(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(transformKeysToCamel);
  if (typeof obj !== 'object') return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    result[camelKey] = transformKeysToCamel(value);
  }
  return result;
}

/**
 * Transform all keys in an object from camelCase to snake_case
 * Recursively handles nested objects and arrays
 */
export function transformKeysToSnake(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(transformKeysToSnake);
  if (typeof obj !== 'object') return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    result[snakeKey] = transformKeysToSnake(value);
  }
  return result;
}

// ============================================================================
// VENUE TRANSFORMERS (DB → API)
// ============================================================================

/**
 * Transform a single venue from DB/server format to API format
 * DB: { is_open, hours_today, expense_level, ... }
 * API: { isOpen, hoursToday, expenseLevel, ... }
 *
 * @param {Object} dbVenue - Venue from discoverNearbyVenues()
 * @returns {Object} API-formatted venue
 */
export function toApiVenue(dbVenue) {
  if (!dbVenue) return null;

  return {
    name: dbVenue.name,
    type: dbVenue.type,
    address: dbVenue.address,
    phone: dbVenue.phone,
    expenseLevel: dbVenue.expense_level,
    expenseRank: dbVenue.expense_rank,
    isOpen: dbVenue.is_open,
    opensInMinutes: dbVenue.opens_in_minutes,
    hoursToday: dbVenue.hours_today,
    closingSoon: dbVenue.closing_soon,
    minutesUntilClose: dbVenue.minutes_until_close,
    crowdLevel: dbVenue.crowd_level,
    ridesharePotential: dbVenue.rideshare_potential,
    rating: dbVenue.rating,
    lat: dbVenue.lat,
    lng: dbVenue.lng,
    placeId: dbVenue.place_id
  };
}

/**
 * Transform venue discovery result to API format
 * @param {Object} venueData - Result from discoverNearbyVenues()
 * @returns {Object} API-formatted venue data
 */
export function toApiVenueData(venueData) {
  if (!venueData) return null;

  return {
    queryTime: venueData.query_time,
    location: venueData.location,
    totalVenues: venueData.total_venues,
    venues: (venueData.venues || []).map(toApiVenue),
    lastCallVenues: (venueData.last_call_venues || []).map(toApiVenue),
    searchSources: venueData.search_sources
  };
}

// ============================================================================
// SMART BLOCK TRANSFORMERS (DB → API)
// ============================================================================

/**
 * Transform a single SmartBlock from DB/server format to API format
 * DB: { distance_miles, drive_minutes, value_per_min, ... }
 * API: { estimatedDistanceMiles, driveTimeMinutes, valuePerMin, ... }
 *
 * @param {Object} dbBlock - Block from ranking_candidates table
 * @returns {Object} API-formatted block
 */
export function toApiBlock(dbBlock) {
  if (!dbBlock) return null;

  return {
    name: dbBlock.name,
    address: dbBlock.address,
    coordinates: dbBlock.coordinates || { lat: dbBlock.lat, lng: dbBlock.lng },
    placeId: dbBlock.place_id || dbBlock.placeId,
    // 2026-01-09: Fallbacks kept for backward compatibility with old data
    // Phase 2 stopped writing legacy columns; Phase 3 will drop them + remove fallbacks
    estimatedDistanceMiles: dbBlock.distance_miles ?? dbBlock.estimated_distance_miles,
    driveTimeMinutes: dbBlock.drive_minutes ?? dbBlock.driveTimeMinutes,
    valuePerMin: dbBlock.value_per_min,
    valueGrade: dbBlock.value_grade,
    notWorth: dbBlock.not_worth,
    proTips: dbBlock.pro_tips ?? dbBlock.proTips,
    closedVenueReasoning: dbBlock.closed_reasoning ?? dbBlock.closed_venue_reasoning,
    stagingArea: dbBlock.staging_tips
      ? { parkingTip: dbBlock.staging_tips }
      : dbBlock.stagingArea || null,
    // 2026-01-10: Snake/camel tolerant - check all variants
    // DB stores is_open (snake), some paths use isOpen (camel)
    isOpen: dbBlock.isOpen ?? dbBlock.is_open ??
            dbBlock.features?.isOpen ?? dbBlock.features?.is_open ?? null,
    businessHours: dbBlock.business_hours ?? dbBlock.businessHours,
    // 2026-01-10: Snake/camel tolerant for street view URL
    streetViewUrl: dbBlock.streetViewUrl ?? dbBlock.street_view_url ??
                   dbBlock.features?.streetViewUrl ?? dbBlock.features?.street_view_url ?? null,
    hasEvent: dbBlock.features?.hasEvent ??
      (Array.isArray(dbBlock.venue_events) && dbBlock.venue_events.length > 0),
    eventBadge: dbBlock.features?.eventBadge ??
      (Array.isArray(dbBlock.venue_events) && dbBlock.venue_events.length > 0
        ? dbBlock.venue_events[0].title
        : null),
    // 2026-01-10: Use symmetric field name (event_start_time)
    eventSummary: Array.isArray(dbBlock.venue_events) && dbBlock.venue_events.length > 0
      ? `${dbBlock.venue_events[0].category} at ${dbBlock.venue_events[0].event_start_time || 'today'}`
      : null
  };
}

/**
 * Transform blocks-fast response to API format
 * Used for both GET and POST success responses
 */
export function toApiBlocksResponse(data) {
  if (!data) return null;

  return {
    status: data.status,
    snapshotId: data.snapshot_id,
    blocks: (data.blocks || []).map(toApiBlock),
    rankingId: data.ranking_id,
    strategy: data.strategy ? {
      strategyForNow: data.strategy.strategy_for_now || data.strategy.strategyForNow || '',
      consolidated: data.strategy.consolidated_strategy || data.strategy.consolidated || ''
    } : undefined,
    message: data.message,
    audit: data.audit
  };
}

// ============================================================================
// STRATEGY POLLING TRANSFORMERS (DB → API)
// ============================================================================

/**
 * Transform strategy polling response to API format
 * Handles all status variants: missing, pending, pending_blocks, ok, error
 */
export function toApiStrategyPolling(data) {
  if (!data) return null;

  const base = {
    status: data.status,
    snapshotId: data.snapshot_id,
    timeElapsedMs: data.timeElapsedMs
  };

  // Transform timing metadata
  const timing = data.timing ? {
    phaseStartedAt: data.timing.phase_started_at,
    phaseElapsedMs: data.timing.phase_elapsed_ms,
    expectedDurationMs: data.timing.expected_duration_ms,
    expectedDurations: data.timing.expected_durations
  } : undefined;

  // Transform strategy object
  const strategy = data.strategy ? {
    consolidated: data.strategy.consolidated || '',
    strategyForNow: data.strategy.strategy_for_now || '',
    holiday: data.strategy.holiday,
    briefing: data.strategy.briefing ? {
      events: data.strategy.briefing.events,
      news: data.strategy.briefing.news,
      traffic: data.strategy.briefing.traffic,
      holidays: data.strategy.briefing.holidays,
      schoolClosures: data.strategy.briefing.school_closures
    } : null
  } : undefined;

  // Handle different status types
  switch (data.status) {
    case 'missing':
      return { ...base, phase: 'starting' };

    case 'pending':
      return {
        ...base,
        phase: data.phase,
        timing,
        waitFor: data.waitFor,
        strategy
      };

    case 'pending_blocks':
      return {
        ...base,
        phase: data.phase,
        timing,
        waitFor: data.waitFor,
        strategy,
        blocks: (data.blocks || []).map(toApiBlock)
      };

    case 'ok':
      return {
        ...base,
        phase: 'complete',
        strategy,
        blocks: (data.blocks || []).map(toApiBlock),
        rankingId: data.ranking_id
      };

    case 'error':
      return {
        status: 'error',
        error: data.error,
        message: data.message,
        timeElapsedMs: data.timeElapsedMs
      };

    default:
      return base;
  }
}

// ============================================================================
// CLIENT → SERVER TRANSFORMERS (API → DB)
// ============================================================================

/**
 * Transform client request to DB format (camelCase → snake_case)
 * Use for incoming POST/PUT request bodies
 */
export function fromClientRequest(clientData) {
  return transformKeysToSnake(clientData);
}

// ============================================================================
// EXPORT ALL
// ============================================================================

export default {
  // Generic converters
  snakeToCamel,
  camelToSnake,
  transformKeysToCamel,
  transformKeysToSnake,

  // Venue transformers
  toApiVenue,
  toApiVenueData,

  // Block transformers
  toApiBlock,
  toApiBlocksResponse,

  // Strategy transformers
  toApiStrategyPolling,

  // Client request transformer
  fromClientRequest
};
