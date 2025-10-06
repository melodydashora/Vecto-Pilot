
import { z } from 'zod';

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

export const validateRequest = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
  try {
    req.validatedData = schema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: 'Validation failed' });
  }
};
