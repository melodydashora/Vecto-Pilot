/**
 * Google OAuth Integration
 * 2026-02-13: Implements OAuth 2.0 Authorization Code flow for Google Sign-In
 *
 * Follows the same pattern as uber-oauth.js:
 * - generateState() for CSRF protection (reused from uber-oauth.js)
 * - Code exchange via Google's token endpoint
 * - ID token verification via google-auth-library
 */

import { OAuth2Client } from 'google-auth-library';
import { generateState } from './uber-oauth.js';

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Scopes: openid for ID token, email + profile for user info
const SCOPES = ['openid', 'email', 'profile'];

/**
 * Get Google OAuth client credentials from environment
 * 2026-02-13: Accepts optional baseUrl to derive redirect URI from the request.
 * Falls back to CLIENT_URL env var, then REPLIT_DEV_DOMAIN.
 * @param {string} [baseUrl] - Base URL from request (e.g., 'https://vectopilot.com')
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string }}
 */
function getGoogleConfig(baseUrl) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Derive base URL: explicit param > CLIENT_URL env > REPLIT_DEV_DOMAIN
  const resolvedBase = baseUrl
    || process.env.CLIENT_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');
  const redirectUri = `${resolvedBase}/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the Google OAuth consent URL
 * @param {{ state: string, mode?: string, baseUrl?: string }} options
 * @returns {string} Google consent URL
 */
export function getGoogleAuthUrl({ state, mode, baseUrl }) {
  const { clientId, redirectUri } = getGoogleConfig(baseUrl);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    access_type: 'offline', // Get refresh token
    prompt: 'select_account', // Always show account picker
  });

  // Pass mode (login/signup) through state isn't needed since
  // both flows hit the same exchange endpoint

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from Google callback
 * @param {string} [baseUrl] - Base URL to derive redirect URI (must match what was used in auth URL)
 * @returns {Promise<{ access_token: string, id_token: string, refresh_token?: string, expires_in: number }>}
 */
export async function exchangeGoogleCode(code, baseUrl) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig(baseUrl);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Verify and decode a Google ID token
 * Uses google-auth-library for cryptographic verification against Google's public keys
 *
 * @param {string} idToken - JWT ID token from Google
 * @returns {Promise<{ sub: string, email: string, email_verified: boolean, name: string, given_name: string, family_name: string, picture: string }>}
 */
export async function verifyGoogleIdToken(idToken) {
  const { clientId } = getGoogleConfig();

  const client = new OAuth2Client(clientId);

  const ticket = await client.verifyIdToken({
    idToken,
    audience: clientId,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error('Google ID token verification failed: empty payload');
  }

  if (!payload.email_verified) {
    throw new Error('Google email is not verified');
  }

  return {
    sub: payload.sub,           // Permanent Google user ID
    email: payload.email,       // Verified email
    email_verified: payload.email_verified,
    name: payload.name || '',
    given_name: payload.given_name || '',
    family_name: payload.family_name || '',
    picture: payload.picture || '',
  };
}

// Re-export generateState for convenience (from uber-oauth.js)
export { generateState };

export default {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  generateState,
};
