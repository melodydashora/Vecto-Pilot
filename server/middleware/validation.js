
// server/middleware/validation.js
import { z } from 'zod';

// Common schemas
export const schemas = {
  uuid: z.string().uuid(),
  
  action: z.object({
    // Support both 'action' (used by client) and 'action_type' for flexibility
    action: z.enum(['view', 'dwell', 'click', 'block_clicked', 'dismiss', 'navigate']).optional(),
    action_type: z.enum(['view', 'dwell', 'click', 'block_clicked', 'dismiss', 'navigate']).optional(),
    snapshot_id: z.string().uuid().optional(),
    ranking_id: z.string().uuid().optional(),
    block_id: z.string().optional(),
    venue_id: z.string().optional(),
    dwell_ms: z.number().int().min(0).max(3600000).nullable().optional(),
    from_rank: z.number().int().optional(),
    user_id: z.string().optional(),
    raw: z.any().optional(),
    metadata: z.record(z.any()).optional()
  }).strict(false),
  
  feedback: z.object({
    venue_id: z.string(),
    snapshot_id: z.string().uuid().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(1000).optional(),
    feedback_type: z.enum(['rating', 'comment', 'report']).optional()
  }).strict(false),
  
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional()
  }).strict(false),
  
  snapshot: z.object({
    user_lat: z.number().min(-90).max(90),
    user_lng: z.number().min(-180).max(180),
    timezone: z.string().optional(),
    weather: z.object({}).passthrough().optional()
  }).strict(false)
};

// Validation middleware factory
export function validate(schema) {
  return (req, res, next) => {
    try {
      req.validatedBody = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        // Always return 400 for validation errors - don't pass to next()
        const errors = err.errors || err.issues || [];
        const errorSummary = errors.length > 0
          ? errors.map(e => `${e.path?.join('.') || 'root'}=${e.message}`).join(', ')
          : err.message || 'Unknown validation error';
        console.warn(`[validation] ZodError: ${errorSummary}`);
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: errors.map(e => ({
            field: e.path?.join('.') || 'unknown',
            message: e.message
          }))
        });
      }
      // For non-ZodErrors, pass to error handler
      next(err);
    }
  };
}

export default { schemas, validate };
