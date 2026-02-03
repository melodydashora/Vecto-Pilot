/**
 * Uber OAuth Tests
 * Tests for Uber OAuth integration
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  encryptToken,
  decryptToken,
  generateState,
  getAuthorizationUrl,
  calculateExpiresAt,
  isTokenExpired,
} from '../../server/lib/auth/oauth/uber-oauth.js';

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    UBER_CLIENT_ID: 'test-client-id',
    UBER_CLIENT_SECRET: 'test-client-secret',
    UBER_REDIRECT_URI: 'https://test.com/callback',
    TOKEN_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('Token Encryption', () => {
  it('should encrypt and decrypt tokens correctly', () => {
    const originalToken = 'test-access-token-12345';
    const encrypted = encryptToken(originalToken);

    // Encrypted should be different from original
    expect(encrypted).not.toBe(originalToken);

    // Should be in format iv:authTag:ciphertext
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);

    // Should decrypt back to original
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(originalToken);
  });

  it('should produce different ciphertexts for same token', () => {
    const token = 'same-token';
    const encrypted1 = encryptToken(token);
    const encrypted2 = encryptToken(token);

    // Different IVs should produce different ciphertexts
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to same value
    expect(decryptToken(encrypted1)).toBe(token);
    expect(decryptToken(encrypted2)).toBe(token);
  });

  it('should throw on invalid encrypted format', () => {
    expect(() => decryptToken('invalid')).toThrow();
    expect(() => decryptToken('only:two')).toThrow();
  });
});

describe('State Generation', () => {
  it('should generate unique state parameters', () => {
    const state1 = generateState();
    const state2 = generateState();

    expect(state1).not.toBe(state2);
    expect(state1.length).toBe(64); // 32 bytes as hex
  });
});

describe('Authorization URL', () => {
  it('should build correct authorization URL', () => {
    const state = 'test-state-123';
    const url = getAuthorizationUrl({ state });

    expect(url).toContain('https://login.uber.com/oauth/v2/authorize');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('state=test-state-123');
    expect(url).toContain('response_type=code');
  });

  it('should include default scopes', () => {
    const url = getAuthorizationUrl({ state: 'test' });

    expect(url).toContain('scope=');
    expect(url).toContain('partner.payments');
    expect(url).toContain('partner.trips');
    expect(url).toContain('profile');
  });

  it('should allow custom scopes', () => {
    const url = getAuthorizationUrl({
      state: 'test',
      scopes: ['custom.scope'],
    });

    expect(url).toContain('scope=custom.scope');
    expect(url).not.toContain('partner.payments');
  });

  it('should throw without required env vars', () => {
    delete process.env.UBER_CLIENT_ID;

    expect(() => getAuthorizationUrl({ state: 'test' })).toThrow();
  });
});

describe('Token Expiration', () => {
  it('should calculate expiration correctly', () => {
    const now = Date.now();
    const expiresIn = 3600; // 1 hour

    const expiresAt = calculateExpiresAt(expiresIn);

    // Should be approximately 1 hour from now
    const diff = expiresAt.getTime() - now;
    expect(diff).toBeGreaterThan(3599000); // At least 3599 seconds
    expect(diff).toBeLessThan(3601000); // At most 3601 seconds
  });

  it('should detect expired tokens', () => {
    const pastDate = new Date(Date.now() - 1000); // 1 second ago
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it('should detect valid tokens', () => {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
    expect(isTokenExpired(futureDate)).toBe(false);
  });

  it('should consider buffer time', () => {
    // Token expires in 4 minutes, but buffer is 5 minutes
    const almostExpired = new Date(Date.now() + 240000); // 4 minutes
    expect(isTokenExpired(almostExpired, 300)).toBe(true); // 5 min buffer

    // Token expires in 6 minutes, buffer is 5 minutes
    const stillValid = new Date(Date.now() + 360000); // 6 minutes
    expect(isTokenExpired(stillValid, 300)).toBe(false);
  });
});
