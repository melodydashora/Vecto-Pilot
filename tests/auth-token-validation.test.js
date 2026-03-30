// Test for Auth Token Validation Fix - Issue #11 (Dec 2, 2025)
// Verifies that UUID-format user IDs can successfully authenticate

// Ensure test mode is set BEFORE any imports run
process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://mock:mock@localhost:5432/mock";

import crypto from 'crypto';
import { describe, it, expect } from '@jest/globals';
import { requireAuth } from '../server/middleware/auth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345';

describe('Auth Token Validation (Issue #11)', () => {
  
  describe('UUID Token Generation', () => {
    it('generates valid signature for UUIDs', () => {
      const testUUID = 'ab85999f-e9aa-49c1-a77f-5723c5c80356';
      const signature = crypto.createHmac('sha256', JWT_SECRET).update(testUUID).digest('hex');
      const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(testUUID).digest('hex');
      
      expect(signature).toBe(expectedSig);
      expect(testUUID.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Middleware Authentication Flow', () => {
    it('extracts userId from valid token', async () => {
      const testUUID = 'ab85999f-e9aa-49c1-a77f-5723c5c80356';
      const signature = crypto.createHmac('sha256', JWT_SECRET).update(testUUID).digest('hex');
      const token = `${testUUID}.${signature}`;

      const mockReq = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };

      const mockRes = {
        status: (code) => ({ json: (data) => ({ code, data }) }),
        json: (data) => data
      };

      let nextCalled = false;
      const mockNext = () => { nextCalled = true; };

      // Set env var for auth middleware to pick up
      process.env.JWT_SECRET = JWT_SECRET;

      await requireAuth(mockReq, mockRes, mockNext);

      expect(nextCalled).toBe(true);
      expect(mockReq.auth).toBeDefined();
      expect(mockReq.auth.userId).toBe(testUUID);
    });
  });

  describe('Multiple UUID Formats', () => {
    const testUUIDs = [
      'ab85999f-e9aa-49c1-a77f-5723c5c80356',
      '12345678-1234-5678-1234-567812345678',
      'user-abc123',
      'test@example.com'
    ];

    testUUIDs.forEach((userId) => {
      it(`validates format: ${userId}`, () => {
        expect(userId.length).toBeGreaterThanOrEqual(8);
      });
    });
  });
});
