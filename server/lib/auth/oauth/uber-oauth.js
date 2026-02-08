/**
 * Uber OAuth Integration
 * Handles OAuth 2.0 flow for Uber Driver API
 */

import crypto from 'crypto';

// Uber OAuth endpoints
const UBER_AUTH_URL = 'https://login.uber.com/oauth/v2/authorize';
const UBER_TOKEN_URL = 'https://login.uber.com/oauth/v2/token';
const UBER_REVOKE_URL = 'https://login.uber.com/oauth/v2/revoke';

// Required scopes for driver data access
const DEFAULT_SCOPES = [
  'partner.payments',      // Access to earnings data
  'partner.trips',         // Access to trip history
  'profile',               // Basic profile info
];

// Encryption algorithm for token storage
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment
 * @returns {Buffer}
 */
function getEncryptionKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
  }
  // Key should be 32 bytes (64 hex characters)
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a token for secure storage
 * @param {string} token - Plain text token
 * @returns {string} - Encrypted token (iv:authTag:ciphertext in base64)
 */
export function encryptToken(token) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(token, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a stored token
 * @param {string} encryptedToken - Encrypted token from storage
 * @returns {string} - Plain text token
 */
export function decryptToken(encryptedToken) {
  const key = getEncryptionKey();
  const parts = encryptedToken.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a cryptographically secure state parameter
 * @returns {string}
 */
export function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build the Uber authorization URL
 * @param {Object} options
 * @param {string} options.state - CSRF state parameter
 * @param {string[]} [options.scopes] - OAuth scopes
 * @returns {string}
 */
export function getAuthorizationUrl(options = {}) {
  const clientId = process.env.UBER_CLIENT_ID;
  const redirectUri = process.env.UBER_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('UBER_CLIENT_ID and UBER_REDIRECT_URI are required');
  }

  const scopes = options.scopes || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: options.state,
  });

  return `${UBER_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from callback
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number, scope: string}>}
 */
export async function exchangeCodeForTokens(code) {
  const clientId = process.env.UBER_CLIENT_ID;
  const clientSecret = process.env.UBER_CLIENT_SECRET;
  const redirectUri = process.env.UBER_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Uber OAuth credentials are not configured');
  }

  const response = await fetch(UBER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token
 * @param {string} refreshToken - The refresh token
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 */
export async function refreshAccessToken(refreshToken) {
  const clientId = process.env.UBER_CLIENT_ID;
  const clientSecret = process.env.UBER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Uber OAuth credentials are not configured');
  }

  const response = await fetch(UBER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

/**
 * Revoke OAuth tokens (disconnect integration)
 * @param {string} accessToken - The access token to revoke
 * @returns {Promise<void>}
 */
export async function revokeToken(accessToken) {
  const clientId = process.env.UBER_CLIENT_ID;
  const clientSecret = process.env.UBER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Uber OAuth credentials are not configured');
  }

  const response = await fetch(UBER_REVOKE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: accessToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.warn(`Token revocation warning: ${error}`);
    // Don't throw - revocation failures shouldn't block disconnect
  }
}

/**
 * Calculate token expiration timestamp
 * @param {number} expiresIn - Seconds until expiration
 * @returns {Date}
 */
export function calculateExpiresAt(expiresIn) {
  return new Date(Date.now() + (expiresIn * 1000));
}

/**
 * Check if a token is expired or about to expire
 * @param {Date} expiresAt - Token expiration timestamp
 * @param {number} [bufferSeconds=300] - Buffer before expiration (default 5 min)
 * @returns {boolean}
 */
export function isTokenExpired(expiresAt, bufferSeconds = 300) {
  const expirationDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const bufferMs = bufferSeconds * 1000;
  return Date.now() >= (expirationDate.getTime() - bufferMs);
}

export default {
  encryptToken,
  decryptToken,
  generateState,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  calculateExpiresAt,
  isTokenExpired,
  DEFAULT_SCOPES,
};
