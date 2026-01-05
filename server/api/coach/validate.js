// server/api/coach/validate.js
// Pre-flight validation for AI Coach actions
// Created: 2026-01-05
//
// Validates action payloads before execution to catch errors early.
// Used by chat.js before executing parsed action tags.

import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Market slug validation
 * Format: lowercase alphanumeric with hyphens (e.g., "dallas-tx", "new-york-ny")
 */
export const marketSlugSchema = z.string()
  .regex(/^[a-z0-9-]+$/, 'Market slug must be lowercase alphanumeric with hyphens')
  .min(3, 'Market slug must be at least 3 characters')
  .max(50, 'Market slug must be at most 50 characters');

/**
 * Note validation (for SAVE_NOTE action)
 */
export const noteSchema = z.object({
  note_type: z.enum(['preference', 'insight', 'tip', 'feedback', 'pattern', 'market_update'], {
    errorMap: () => ({ message: 'note_type must be one of: preference, insight, tip, feedback, pattern, market_update' })
  }),
  category: z.enum(['timing', 'location', 'strategy', 'vehicle', 'earnings', 'safety']).optional(),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be at most 200 characters'),
  content: z.string().min(1, 'Content is required').max(5000, 'Content must be at most 5000 characters'),
  importance: z.number().int().min(1).max(100).default(50),
  confidence: z.number().int().min(1).max(100).default(80).optional(),
  market_slug: marketSlugSchema.optional(),
  neighborhoods: z.array(z.string()).optional(),
  context: z.string().max(1000).optional()
});

/**
 * Event deactivation validation (for DEACTIVATE_EVENT action)
 */
export const eventDeactivationSchema = z.object({
  event_id: z.string().uuid('event_id must be a valid UUID').optional(),
  event_title: z.string().min(1, 'event_title is required').max(500, 'event_title must be at most 500 characters'),
  reason: z.enum(['event_ended', 'incorrect_time', 'no_longer_relevant', 'cancelled', 'duplicate', 'other'], {
    errorMap: () => ({ message: 'reason must be one of: event_ended, incorrect_time, no_longer_relevant, cancelled, duplicate, other' })
  }),
  notes: z.string().max(1000, 'notes must be at most 1000 characters').optional()
});

/**
 * Event reactivation validation (for REACTIVATE_EVENT action)
 */
export const eventReactivationSchema = z.object({
  event_id: z.string().uuid('event_id must be a valid UUID').optional(),
  event_title: z.string().min(1, 'event_title is required').max(500),
  reason: z.string().min(1, 'reason is required').max(500),
  notes: z.string().max(1000).optional()
});

/**
 * Zone intelligence validation (for ZONE_INTEL action)
 */
export const zoneIntelSchema = z.object({
  zone_type: z.enum(['dead_zone', 'danger_zone', 'honey_hole', 'surge_trap', 'staging_spot', 'event_zone'], {
    errorMap: () => ({ message: 'zone_type must be one of: dead_zone, danger_zone, honey_hole, surge_trap, staging_spot, event_zone' })
  }),
  zone_name: z.string().min(1, 'zone_name is required').max(200, 'zone_name must be at most 200 characters'),
  market_slug: marketSlugSchema,
  reason: z.string().min(1, 'reason is required').max(1000, 'reason must be at most 1000 characters'),
  time_constraints: z.string().max(500).optional(),
  address_hint: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional()
});

/**
 * System note validation (for SYSTEM_NOTE action)
 */
export const systemNoteSchema = z.object({
  type: z.enum(['feature_request', 'pain_point', 'bug_report', 'aha_moment', 'workaround', 'integration_idea'], {
    errorMap: () => ({ message: 'type must be one of: feature_request, pain_point, bug_report, aha_moment, workaround, integration_idea' })
  }),
  category: z.enum(['ui', 'strategy', 'briefing', 'venues', 'coach', 'map', 'earnings', 'general'], {
    errorMap: () => ({ message: 'category must be one of: ui, strategy, briefing, venues, coach, map, earnings, general' })
  }),
  title: z.string().min(1, 'title is required').max(200),
  description: z.string().min(1, 'description is required').max(2000),
  user_quote: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).default(50).optional()
});

/**
 * News deactivation validation (for DEACTIVATE_NEWS action)
 */
export const newsDeactivationSchema = z.object({
  news_title: z.string().min(1, 'news_title is required').max(500),
  news_source: z.string().max(200).optional(),
  reason: z.string().min(1, 'reason is required').max(500)
});

// Action type to schema mapping
const ACTION_SCHEMAS = {
  SAVE_NOTE: noteSchema,
  DEACTIVATE_EVENT: eventDeactivationSchema,
  REACTIVATE_EVENT: eventReactivationSchema,
  ZONE_INTEL: zoneIntelSchema,
  SYSTEM_NOTE: systemNoteSchema,
  DEACTIVATE_NEWS: newsDeactivationSchema
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/coach/validate
 * Validates an action payload before execution
 *
 * Request body:
 * {
 *   action_type: "SAVE_NOTE" | "DEACTIVATE_EVENT" | etc.,
 *   payload: { ... action-specific fields ... }
 * }
 *
 * Response:
 * Success: { ok: true, validated: { ... parsed data ... } }
 * Failure: { ok: false, error: "VALIDATION_ERROR", details: [...] }
 */
router.post('/', (req, res) => {
  const { action_type, payload } = req.body;

  if (!action_type) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_ACTION_TYPE',
      message: 'action_type is required'
    });
  }

  if (!payload) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_PAYLOAD',
      message: 'payload is required'
    });
  }

  const schema = ACTION_SCHEMAS[action_type];
  if (!schema) {
    return res.status(400).json({
      ok: false,
      error: 'UNKNOWN_ACTION',
      message: `Unknown action type: ${action_type}`,
      valid_actions: Object.keys(ACTION_SCHEMAS)
    });
  }

  const result = schema.safeParse(payload);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      action_type,
      details: result.error.issues.map(issue => ({
        field: issue.path.join('.') || 'root',
        message: issue.message,
        code: issue.code
      }))
    });
  }

  return res.json({
    ok: true,
    action_type,
    validated: result.data
  });
});

/**
 * GET /api/coach/validate/schemas
 * Returns documentation for all action schemas
 */
router.get('/schemas', (_req, res) => {
  const schemas = {};

  for (const [action, schema] of Object.entries(ACTION_SCHEMAS)) {
    // Extract schema shape for documentation
    schemas[action] = {
      description: getSchemaDescription(action),
      fields: extractSchemaFields(schema)
    };
  }

  res.json({ ok: true, schemas });
});

/**
 * POST /api/coach/validate/batch
 * Validates multiple actions at once
 */
router.post('/batch', (req, res) => {
  const { actions } = req.body;

  if (!Array.isArray(actions)) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_FORMAT',
      message: 'actions must be an array'
    });
  }

  const results = actions.map((action, index) => {
    const { action_type, payload } = action;
    const schema = ACTION_SCHEMAS[action_type];

    if (!schema) {
      return {
        index,
        action_type,
        ok: false,
        error: `Unknown action type: ${action_type}`
      };
    }

    const result = schema.safeParse(payload);
    if (!result.success) {
      return {
        index,
        action_type,
        ok: false,
        errors: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message
        }))
      };
    }

    return {
      index,
      action_type,
      ok: true,
      validated: result.data
    };
  });

  const allValid = results.every(r => r.ok);

  res.json({
    ok: allValid,
    total: actions.length,
    valid: results.filter(r => r.ok).length,
    invalid: results.filter(r => !r.ok).length,
    results
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSchemaDescription(action) {
  const descriptions = {
    SAVE_NOTE: 'Save a note about driver preferences, tips, or insights',
    DEACTIVATE_EVENT: 'Mark an event as inactive (ended, cancelled, etc.)',
    REACTIVATE_EVENT: 'Restore a previously deactivated event',
    ZONE_INTEL: 'Capture crowd-sourced zone knowledge',
    SYSTEM_NOTE: 'Log a system observation for developers',
    DEACTIVATE_NEWS: 'Hide a news item from the user'
  };
  return descriptions[action] || 'Unknown action';
}

function extractSchemaFields(schema) {
  // Simplified extraction - in practice you'd use zod's introspection
  const shape = schema._def?.shape?.();
  if (!shape) return {};

  const fields = {};
  for (const [key, def] of Object.entries(shape)) {
    fields[key] = {
      type: getZodType(def),
      required: !def.isOptional?.(),
      description: def._def?.description
    };
  }
  return fields;
}

function getZodType(def) {
  const typeName = def._def?.typeName;
  if (typeName === 'ZodEnum') return `enum: ${def._def.values.join(' | ')}`;
  if (typeName === 'ZodString') return 'string';
  if (typeName === 'ZodNumber') return 'number';
  if (typeName === 'ZodBoolean') return 'boolean';
  if (typeName === 'ZodArray') return 'array';
  if (typeName === 'ZodOptional') return `optional(${getZodType(def._def.innerType)})`;
  if (typeName === 'ZodDefault') return `default(${getZodType(def._def.innerType)})`;
  return 'unknown';
}

// ============================================================================
// EXPORTS (for use in chat.js action execution)
// ============================================================================

/**
 * Validate an action programmatically (for use in chat.js)
 *
 * @param {string} actionType - Action type (e.g., "SAVE_NOTE")
 * @param {object} payload - Action payload
 * @returns {{ ok: boolean, data?: object, errors?: array }}
 */
export function validateAction(actionType, payload) {
  const schema = ACTION_SCHEMAS[actionType];
  if (!schema) {
    return { ok: false, errors: [{ field: 'action_type', message: `Unknown action: ${actionType}` }] };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(i => ({
        field: i.path.join('.') || 'root',
        message: i.message
      }))
    };
  }

  return { ok: true, data: result.data };
}

export default router;
