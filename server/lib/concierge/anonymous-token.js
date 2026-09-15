// Anonymous bookmarks carry a random identifier, never a driver/profile identifier.
// They have no time expiry; rotating the signing secret invalidates old bookmarks.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeCoordinates } from '../../../shared/coordinates.js';

function signingSecret() {
  const secret = process.env.JWT_SECRET
    || (process.env.REPLIT_DEPLOYMENT !== '1' && process.env.REPLIT_DEVSERVER_INTERNAL_ID);
  if (!secret) throw new Error('Concierge bookmark signing is not configured');
  return secret;
}

function signature(id) {
  return createHmac('sha256', signingSecret()).update(`concierge-bookmark-v1:${id}`).digest('base64url');
}

export function createAnonymousToken() {
  const id = randomBytes(24).toString('base64url');
  return `c1.${id}.${signature(id)}`;
}

export function validateAnonymousToken(token) {
  if (typeof token !== 'string' || !/^c1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [, id, supplied] = token.split('.');
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(id)));
}

export function parseConciergeCoordinates(lat, lng) {
  const coords = normalizeCoordinates(lat, lng);
  if (!coords) throw new Error('Valid GPS coordinates are required');
  return coords;
}
