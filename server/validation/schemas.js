// server/validation/schemas.js
// Zod validation schemas for API request validation
// Provides type-safe input validation with detailed error messages

import { z } from 'zod';

// Coordinate validation (GPS latitude/longitude)
const coordinateSchema = z.object({
  lat: z.number()
    .min(-90, 'Latitude must be >= -90')
    .max(90, 'Latitude must be <= 90')
    .finite('Latitude must be a finite number'),
  lng: z.number()
    .min(-180, 'Longitude must be >= -180')
    .max(180, 'Longitude must be <= 180')
    .finite('Longitude must be a finite number')
});

// UUID validation (snapshot IDs, user IDs, etc.)
const uuidSchema = z.string()
  .uuid('Must be a valid UUID')
  .min(36)
  .max(36);

// Optional UUID (can be null/undefined)
const optionalUuidSchema = z.string()
  .uuid('Must be a valid UUID')
  .min(36)
  .max(36)
  .optional()
  .nullable();

// Snapshot creation validation (supports both minimal and full SnapshotV1 formats)
// Minimal format: {lat: 37.77, lng: -122.41}
// Full SnapshotV1: {coord: {lat: 37.77, lng: -122.41}, resolved, time_context, ...}
export const snapshotMinimalSchema = z.union([
  // Format 1: Minimal mode - flat lat/lng (for curl tests)
  z.object({
    lat: z.number()
      .min(-90, 'Latitude must be >= -90')
      .max(90, 'Latitude must be <= 90')
      .finite('Latitude must be a finite number'),
    lng: z.number()
      .min(-180, 'Longitude must be >= -180')
      .max(180, 'Longitude must be <= 180')
      .finite('Longitude must be a finite number'),
    userId: optionalUuidSchema,
    device_id: optionalUuidSchema,
    session_id: optionalUuidSchema
  }).passthrough(),
  
  // Format 2: Full SnapshotV1 - nested coord.lat/coord.lng (from frontend)
  z.object({
    coord: z.object({
      lat: z.number()
        .min(-90, 'Latitude must be >= -90')
        .max(90, 'Latitude must be <= 90')
        .finite('Latitude must be a finite number'),
      lng: z.number()
        .min(-180, 'Longitude must be >= -180')
        .max(180, 'Longitude must be <= 180')
        .finite('Longitude must be a finite number')
    }).passthrough(),
    user_id: optionalUuidSchema,
    device_id: optionalUuidSchema,
    session_id: optionalUuidSchema
  }).passthrough()
]).transform(data => {
  // Normalize both formats to include top-level lat/lng for backward compatibility
  if (data.coord) {
    // Full SnapshotV1 format - add flat lat/lng for route handler
    return { ...data, lat: data.coord.lat, lng: data.coord.lng };
  }
  return data; // Minimal format already has flat lat/lng
});

// Location resolve validation
export const locationResolveSchema = z.object({
  lat: z.string()
    .transform(val => parseFloat(val))
    .pipe(z.number().min(-90).max(90).finite()),
  lng: z.string()
    .transform(val => parseFloat(val))
    .pipe(z.number().min(-180).max(180).finite())
});

// Strategy request validation
export const strategyRequestSchema = z.object({
  snapshot_id: uuidSchema
});

// Blocks request validation
export const blocksRequestSchema = z.object({
  snapshotId: uuidSchema,
  userId: optionalUuidSchema,
  maxBlocks: z.number()
    .int('Must be an integer')
    .min(1, 'Must request at least 1 block')
    .max(20, 'Cannot request more than 20 blocks')
    .optional()
    .default(10)
}).passthrough(); // Allow other fields

// Query parameter validation (GET requests)
export const snapshotIdQuerySchema = z.object({
  snapshotId: uuidSchema.optional(),
  snapshot_id: uuidSchema.optional()
}).refine(
  data => data.snapshotId || data.snapshot_id,
  'Either snapshotId or snapshot_id query parameter is required'
);

// Coach chat validation
export const coachChatSchema = z.object({
  snapshot_id: uuidSchema,
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message cannot exceed 2000 characters')
});

// News briefing validation
export const newsBriefingSchema = z.object({
  latitude: z.number().min(-90).max(90).finite(),
  longitude: z.number().min(-180).max(180).finite(),
  address: z.string().min(1, 'Address is required'),
  city: z.string().optional(),
  state: z.string().optional(),
  radius: z.number()
    .int()
    .min(1, 'Radius must be at least 1 mile')
    .max(50, 'Radius cannot exceed 50 miles')
    .optional()
    .default(10)
});

// Helper: Format Zod errors into user-friendly messages
export function formatZodError(error) {
  // Zod v4 uses 'issues', older versions used 'errors'
  const issues = error?.issues || error?.errors || [];
  
  if (issues.length === 0) {
    return 'Validation failed';
  }

  const messages = issues.map(err => {
    const field = err.path.join('.');
    return `${field}: ${err.message}`;
  });

  return messages.join(', ');
}

// Helper: Safe parse with error formatting
export function validateRequest(schema, data) {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const issues = result.error?.issues || result.error?.errors || [];
    return {
      ok: false,
      error: formatZodError(result.error),
      details: issues
    };
  }
  
  return {
    ok: true,
    data: result.data
  };
}
