// server/validation/response-schemas.js
// ============================================================================
// API RESPONSE SCHEMAS - Zod validation for API responses
// ============================================================================
//
// PURPOSE: Define explicit contracts for API responses to ensure type safety
// between server and client. These schemas document the exact shape of responses.
//
// CONVENTION:
//   - API responses use camelCase (JavaScript convention)
//   - DB uses snake_case (PostgreSQL convention)
//   - Use transformers in this file to convert between conventions
//
// USAGE:
//   import { VenuesNearbyResponse, validateResponse } from '../validation/response-schemas.js';
//   const validated = validateResponse(VenuesNearbyResponse, responseData);
//
// ============================================================================

import { z } from 'zod';

// ============================================================================
// SHARED SCHEMAS - Reusable building blocks
// ============================================================================

/**
 * Coordinate pair - used throughout venue and block responses
 */
export const CoordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number()
});

/**
 * Timing metadata for progress tracking
 */
export const TimingSchema = z.object({
  phaseStartedAt: z.string().nullable().optional(),
  phaseElapsedMs: z.number().optional(),
  expectedDurationMs: z.number().optional(),
  expectedDurations: z.record(z.string(), z.number()).optional()
});

/**
 * Pipeline phase enum - tracks generation progress
 */
export const PipelinePhaseSchema = z.enum([
  'starting', 'resolving', 'analyzing', 'immediate',
  'venues', 'routing', 'places', 'verifying', 'enriching', 'complete'
]);

// ============================================================================
// /api/venues/nearby - VENUE DISCOVERY RESPONSE
// ============================================================================

/**
 * Single venue in the venues list
 * Maps to: server/lib/venue/venue-intelligence.js discoverNearbyVenues()
 */
export const VenueSchema = z.object({
  name: z.string(),
  type: z.enum(['bar', 'nightclub', 'wine_bar', 'lounge']),
  address: z.string(),
  phone: z.string().nullable(),
  expenseLevel: z.string(),    // '$$', '$$$', '$$$$'
  expenseRank: z.number(),     // 1-4
  // 2026-01-09: is_open can be null when hours unavailable
  isOpen: z.boolean().nullable(),
  opensInMinutes: z.number().nullable(),
  // 2026-01-09: hours_today can be null when hours unavailable
  hoursToday: z.string().nullable(),
  closingSoon: z.boolean(),
  minutesUntilClose: z.number().nullable(),
  crowdLevel: z.enum(['low', 'medium', 'high']),
  ridesharePotential: z.enum(['low', 'medium', 'high']),
  rating: z.number().nullable(),
  lat: z.number(),
  lng: z.number(),
  placeId: z.string().optional()
});

/**
 * Venue discovery response data
 */
export const VenueDataSchema = z.object({
  queryTime: z.string(),
  location: z.string(),
  totalVenues: z.number(),
  venues: z.array(VenueSchema),
  lastCallVenues: z.array(VenueSchema),
  searchSources: z.array(z.string()).optional()
});

/**
 * Full /api/venues/nearby response envelope
 */
export const VenuesNearbyResponseSchema = z.object({
  success: z.boolean(),
  data: VenueDataSchema
});

// ============================================================================
// /api/blocks-fast - SMART BLOCKS GENERATION
// ============================================================================

/**
 * Staging area information for a venue
 */
export const StagingAreaSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
  walkTime: z.string().optional(),
  parkingTip: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional()
});

/**
 * Single SmartBlock - AI-recommended venue with enrichment
 * Maps to: mapCandidatesToBlocks() in blocks-fast.js
 */
export const SmartBlockSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  coordinates: CoordinatesSchema,
  placeId: z.string().optional(),
  estimatedDistanceMiles: z.number().nullable().optional(),
  driveTimeMinutes: z.number().nullable().optional(),
  valuePerMin: z.number().nullable().optional(),
  valueGrade: z.string().nullable().optional(),
  notWorth: z.boolean().nullable().optional(),
  proTips: z.array(z.string()).nullable().optional(),
  closedVenueReasoning: z.string().nullable().optional(),
  stagingArea: StagingAreaSchema.nullable().optional(),
  isOpen: z.boolean().nullable().optional(),
  businessHours: z.string().nullable().optional(),
  streetViewUrl: z.string().nullable().optional(),
  hasEvent: z.boolean().optional(),
  eventBadge: z.string().nullable().optional(),
  eventSummary: z.string().nullable().optional()
});

/**
 * Strategy content (immediate + consolidated)
 */
export const StrategyContentSchema = z.object({
  strategyForNow: z.string(),
  consolidated: z.string()
});

/**
 * Audit trail entry for debugging
 */
export const AuditEntrySchema = z.object({
  step: z.string(),
  ts: z.number().optional()
}).passthrough(); // Allow additional fields

/**
 * /api/blocks-fast GET - Success response (200)
 *
 * briefing.consolidatedStrategy = Briefing tab 6-12hr shift strategy (manual push)
 * strategy.consolidated = AI pipeline consolidated output (StrategyContentSchema)
 * These are DIFFERENT concepts - do not confuse them!
 */
export const BlocksFastGetSuccessSchema = z.object({
  blocks: z.array(SmartBlockSchema),
  rankingId: z.string(),
  briefing: z.object({
    consolidatedStrategy: z.string().nullable(),
    strategyForNow: z.string().nullable()
  }).nullable().optional(),
  audit: z.array(AuditEntrySchema).optional()
});

/**
 * /api/blocks-fast GET - Pending response (202)
 */
export const BlocksFastGetPendingSchema = z.object({
  ok: z.literal(false),
  reason: z.string(),
  status: z.string(),
  message: z.string(),
  blocks: z.array(SmartBlockSchema).optional()
});

/**
 * /api/blocks-fast POST - Success response (200)
 */
export const BlocksFastPostSuccessSchema = z.object({
  status: z.literal('ok'),
  snapshotId: z.string(),
  blocks: z.array(SmartBlockSchema),
  rankingId: z.string().optional(),
  strategy: StrategyContentSchema.optional(),
  message: z.string().optional(),
  audit: z.array(AuditEntrySchema).optional()
});

/**
 * /api/blocks-fast POST - Pending response (202)
 */
export const BlocksFastPostPendingSchema = z.object({
  status: z.string(),
  snapshotId: z.string(),
  blocks: z.array(SmartBlockSchema),
  message: z.string().optional(),
  audit: z.array(AuditEntrySchema).optional()
});

/**
 * /api/blocks-fast POST - Error response (4xx/5xx)
 */
export const BlocksFastPostErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  snapshotId: z.string().optional(),
  audit: z.array(AuditEntrySchema).optional()
});

// ============================================================================
// /api/blocks/strategy/:snapshotId - STRATEGY POLLING
// ============================================================================

/**
 * Briefing data (events, news, traffic)
 */
export const BriefingDataSchema = z.object({
  events: z.array(z.any()).optional(),
  news: z.array(z.any()).optional(),
  traffic: z.any().optional(),
  holidays: z.array(z.any()).optional(),
  schoolClosures: z.array(z.any()).optional()
}).nullable();

/**
 * Strategy object in polling response
 */
export const StrategyPollingSchema = z.object({
  consolidated: z.string(),
  strategyForNow: z.string(),
  holiday: z.string().nullable().optional(),
  briefing: BriefingDataSchema.optional()
});

/**
 * Block in polling response (slightly different from SmartBlockSchema)
 */
export const PollingBlockSchema = SmartBlockSchema.extend({
  rankingId: z.string().optional()
});

/**
 * /api/blocks/strategy/:snapshotId - Base response fields
 */
const StrategyPollingBaseSchema = z.object({
  status: z.enum(['missing', 'pending', 'pending_blocks', 'ok', 'error']),
  snapshotId: z.string(),
  timeElapsedMs: z.number()
});

/**
 * Missing strategy response
 */
export const StrategyPollingMissingSchema = StrategyPollingBaseSchema.extend({
  status: z.literal('missing'),
  phase: z.literal('starting')
});

/**
 * Pending strategy response
 */
export const StrategyPollingPendingSchema = StrategyPollingBaseSchema.extend({
  status: z.literal('pending'),
  phase: PipelinePhaseSchema,
  timing: TimingSchema.optional(),
  waitFor: z.array(z.string()),
  strategy: StrategyPollingSchema
});

/**
 * Pending blocks response (strategy ready, blocks generating)
 */
export const StrategyPollingPendingBlocksSchema = StrategyPollingBaseSchema.extend({
  status: z.literal('pending_blocks'),
  phase: PipelinePhaseSchema,
  timing: TimingSchema.optional(),
  waitFor: z.array(z.string()),
  strategy: StrategyPollingSchema,
  blocks: z.array(PollingBlockSchema)
});

/**
 * Complete response (everything ready)
 */
export const StrategyPollingOkSchema = StrategyPollingBaseSchema.extend({
  status: z.literal('ok'),
  phase: z.literal('complete'),
  strategy: StrategyPollingSchema,
  blocks: z.array(PollingBlockSchema),
  rankingId: z.string()
});

/**
 * Error response
 */
export const StrategyPollingErrorSchema = z.object({
  status: z.literal('error'),
  error: z.string(),
  message: z.string().optional(),
  timeElapsedMs: z.number()
});

/**
 * Union of all strategy polling responses
 */
export const StrategyPollingResponseSchema = z.discriminatedUnion('status', [
  StrategyPollingMissingSchema,
  StrategyPollingPendingSchema,
  StrategyPollingPendingBlocksSchema,
  StrategyPollingOkSchema,
  StrategyPollingErrorSchema
]);

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate response data against a schema
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {unknown} data - Response data to validate
 * @returns {{ ok: boolean, data?: unknown, error?: string }}
 */
export function validateResponse(schema, data) {
  const result = schema.safeParse(data);

  if (!result.success) {
    const issues = result.error?.issues || [];
    const errorMessages = issues.map(err => {
      const field = err.path.join('.');
      return `${field}: ${err.message}`;
    });

    return {
      ok: false,
      error: errorMessages.join(', ') || 'Validation failed'
    };
  }

  return {
    ok: true,
    data: result.data
  };
}

/**
 * Assert response matches schema (throws on failure)
 * Useful for debugging/testing
 */
export function assertResponse(schema, data, context = '') {
  const result = validateResponse(schema, data);
  if (!result.ok) {
    throw new Error(`Response validation failed${context ? ` (${context})` : ''}: ${result.error}`);
  }
  return result.data;
}

// ============================================================================
// GEMINI AI RESPONSE SCHEMAS - For structured AI outputs
// ============================================================================
// 2026-01-31: Added as part of data pipeline restructure
// These schemas validate structured JSON responses from Gemini models

/**
 * Event Discovery Schema - validates Gemini event discovery responses
 * Used by: BRIEFING_EVENTS_DISCOVERY role
 *
 * Events must have ALL required date/time fields to be valid.
 * TBD/Unknown values are rejected at the schema level.
 */
export const EventDiscoverySchema = z.object({
  events: z.array(z.object({
    title: z.string().min(1),
    venue_name: z.string().min(1),
    address: z.string().optional(),
    event_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
    event_start_time: z.string().min(1), // e.g., "7:00 PM" or "19:00"
    event_end_time: z.string().min(1),   // Required - no TBD/Unknown allowed
    category: z.enum([
      'concert', 'sports', 'comedy', 'live_music', 'festival',
      'nightlife', 'community', 'theater', 'conference', 'other'
    ]).optional(),
    expected_crowd: z.enum(['high', 'medium', 'low']).optional(),
    impact: z.enum(['high', 'medium', 'low']).optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional()
  }))
});

/**
 * Traffic Summary Schema - validates AI traffic analysis responses
 * Used by: BRIEFING_TRAFFIC_MODEL (Gemini Pro)
 *
 * Provides strategic traffic summary for driver briefings.
 */
export const TrafficSummarySchema = z.object({
  briefing: z.string().max(500),  // 2-3 sentence strategic summary
  keyIssues: z.array(z.string()).max(5),  // Top traffic issues
  avoidAreas: z.array(z.string()).max(3), // Areas to avoid
  driverImpact: z.string().max(300),      // One-line strategic advice
  riskLevel: z.enum(['low', 'medium', 'high', 'severe']).optional(),
  closuresSummary: z.string().optional(),
  constructionSummary: z.string().optional()
});

/**
 * News Discovery Schema - validates Gemini news search responses
 * Used by: BRIEFING_NEWS_DISCOVERY role
 */
export const NewsDiscoverySchema = z.object({
  items: z.array(z.object({
    title: z.string().min(1),
    summary: z.string().max(500),  // Why this matters to drivers
    published_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
    impact: z.enum(['high', 'medium', 'low']),
    source: z.string().optional(),
    link: z.string().url().optional()
  })),
  reason: z.string().nullable().optional()  // Why no news found (if empty)
});

/**
 * School Closure Schema - validates school closure discovery responses
 */
export const SchoolClosureSchema = z.object({
  closures: z.array(z.object({
    name: z.string().min(1),        // School or district name
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().optional(),  // e.g., "Teacher In-Service", "Snow Day"
    type: z.enum(['district', 'school', 'university']).optional()
  }))
});
