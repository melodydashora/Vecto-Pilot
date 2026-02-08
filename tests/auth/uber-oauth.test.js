// tests/auth/uber-oauth.test.js
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import {
  generateState,
  getAuthorizationUrl,
  encryptToken,
  decryptToken,
  calculateExpiresAt,
  isTokenExpired
} from '../../server/lib/auth/oauth/uber-oauth.js';

describe('Uber OAuth Logic', () => {
  // Mock env vars
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      UBER_CLIENT_ID: 'test-client-id',
      UBER_REDIRECT_URI: 'http://localhost:5000/api/auth/uber/callback',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 64 hex chars
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('generateState', () => {
    it('returns a hex string', () => {
      const state = generateState();
      expect(typeof state).toBe('string');
      expect(state).toMatch(/^[0-9a-f]+$/);
    });

    it('returns unique values', () => {
      const state1 = generateState();
      const state2 = generateState();
      expect(state1).not.toBe(state2);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('constructs correct URL', () => {
      const state = 'test-state';
      const url = getAuthorizationUrl({ state });
      const parsed = new URL(url);
      
      expect(parsed.origin).toBe('https://login.uber.com');
      expect(parsed.pathname).toBe('/oauth/v2/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:5000/api/auth/uber/callback');
      expect(parsed.searchParams.get('state')).toBe('test-state');
      expect(parsed.searchParams.get('response_type')).toBe('code');
    });
  });

  describe('encrypt/decryptToken', () => {
    it('encrypts and decrypts correctly', () => {
      const secret = 'my-secret-token-123';
      const encrypted = encryptToken(secret);
      
      expect(encrypted).not.toBe(secret);
      expect(encrypted).toContain(':'); // iv:tag:ciphertext
      
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(secret);
    });
  });

  describe('Token Expiration', () => {
    it('calculates expiration date correctly', () => {
      const now = Date.now();
      const expiresInSeconds = 3600;
      const expiresAt = calculateExpiresAt(expiresInSeconds);
      
      // Should be roughly 1 hour from now (allow 1s variance)
      const diff = expiresAt.getTime() - now;
      expect(Math.abs(diff - 3600000)).toBeLessThan(1000);
    });

    it('identifies expired tokens', () => {
      const pastDate = new Date(Date.now() - 10000);
      expect(isTokenExpired(pastDate)).toBe(true);
    });

    it('identifies valid tokens', () => {
      // Future date > 5 min buffer (300000ms)
      const futureDate = new Date(Date.now() + 400000);
      expect(isTokenExpired(futureDate)).toBe(false);
    });
  });
});
