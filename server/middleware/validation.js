
// server/middleware/validation.js
import { z } from 'zod';

// Common schemas
export const schemas = {
  uuid: z.string().uuid(),
  
  action: z.object({
    action_type: z.enum(['view', 'dwell', 'block_clicked', 'dismiss', 'navigate']),
    snapshot_id: z.string().uuid(),
    ranking_id: z.string().uuid().optional(),
    venue_id: z.string().optional(),
    dwell_ms: z.number().int().min(0).max(3600000).optional(),
    metadata: z.record(z.any()).optional()
  }),
  
  feedback: z.object({
    venue_id: z.string(),
    snapshot_id: z.string().uuid().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(1000).optional(),
    feedback_type: z.enum(['rating', 'comment', 'report']).optional()
  }),
  
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional()
  }),
  
  snapshot: z.object({
    user_lat: z.number().min(-90).max(90),
    user_lng: z.number().min(-180).max(180),
    timezone: z.string().optional(),
    weather: z.object({}).passthrough().optional()
  })
};

// Validation middleware factory
export function validate(schema) {
  return (req, res, next) => {
    try {
      req.validatedBody = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      next(err);
    }
  };
}

export default { schemas, validate };
