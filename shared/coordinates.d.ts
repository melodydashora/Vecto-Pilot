export const GPS_MAX_AGE_MS: number;
export const GPS_MAX_ACCURACY_METERS: number;
export function normalizeCoordinates(latitude: unknown, longitude: unknown): { lat: number; lng: number } | null;
export function validateGpsFix(fix: { latitude: unknown; longitude: unknown; accuracy: unknown; timestamp: unknown }, nowMs?: number):
  | { ok: true; lat: number; lng: number; accuracy: number; timestamp: number }
  | { ok: false; error: string };
