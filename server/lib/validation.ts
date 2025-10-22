
import { z } from 'zod';

// Existing schemas
export const agendaSchema = z.object({
  currentLocation: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  duration: z.number()
});

export const sessionSchema = z.object({
  userId: z.string()
});

export const smartBlocksSchema = z.object({
  currentLocation: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  noGoZones: z.array(z.any())
});

// New comprehensive schemas
export const snapshotV1Schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  city: z.string().min(1),
  address: z.string().optional(),
  timezone: z.string().min(1),
  dayPart: z.enum(['morning', 'afternoon', 'evening', 'night']),
  isWeekend: z.boolean(),
  weather: z.string().optional(),
  airQuality: z.string().optional(),
  user_id: z.string().uuid().nullable().optional()
});

export const blocksQuerySchema = z.object({
  lat: z.string().transform(Number).pipe(z.number().min(-90).max(90)),
  lng: z.string().transform(Number).pipe(z.number().min(-180).max(180)),
  minDistance: z.string().transform(Number).pipe(z.number().min(0)).optional(),
  maxDistance: z.string().transform(Number).pipe(z.number().max(50)).optional()
});

export const feedbackSchema = z.object({
  blockName: z.string().min(1),
  rating: z.enum(['up', 'down']),
  snapshot_id: z.string().uuid(),
  user_id: z.string().uuid().nullable().optional()
});

// Validation middleware factory
export const validateRequest = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
  try {
    req.validatedData = schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'validation_failed',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    res.status(400).json({ error: 'Validation failed' });
  }
};

// Query validation middleware
export const validateQuery = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'validation_failed',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    res.status(400).json({ error: 'Query validation failed' });
  }
};
