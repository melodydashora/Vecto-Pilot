// tests/blocksApi.test.js
// Block Schema Contract validation tests

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Import gateway-server which will set globalThis.testApp
await import("../gateway-server.js");

// Wait for app to be ready (max 10 seconds)
const waitForApp = async () => {
  const maxWait = 10000;
  const start = Date.now();
  while (!globalThis.testApp && (Date.now() - start) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!globalThis.testApp) {
    throw new Error("App did not initialize within 10 seconds");
  }
  return globalThis.testApp;
};

const app = await waitForApp();

// Define schema contract for venue blocks
const venueBlockSchema = {
  required: ["name", "coordinates"],
  optional: ["address", "placeId", "estimated_distance_miles", "driveTimeMinutes", "value_per_min", "value_grade", "not_worth", "proTips", "closed_venue_reasoning", "stagingArea", "businessHours", "isOpen", "eventBadge", "eventSummary"]
};

// Generate a valid JWT token for testing
import crypto from 'crypto';

function generateTestToken(userId = 'test-user-12345678') {
  const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';
  const signature = crypto.createHmac('sha256', secret).update(userId).digest('hex');
  return `${userId}.${signature}`;
}

const testToken = generateTestToken();

/**
 * Validate a venue block against the schema contract
 * @param {Object} block - Venue block object to validate
 * @throws {Error} if validation fails
 */
function validateVenueBlock(block) {
  // Validate required fields
  venueBlockSchema.required.forEach((field) => {
    if (!(field in block)) {
      throw new Error(`Missing required field: ${field}`);
    }
  });

  // Validate coordinates structure
  if (!block.coordinates || typeof block.coordinates.lat !== 'number' || typeof block.coordinates.lng !== 'number') {
    throw new Error('Invalid coordinates structure');
  }

  // Validate optional fields if present
  if (block.value_grade && !['A', 'B', 'C'].includes(block.value_grade)) {
    throw new Error(`Invalid value_grade: ${block.value_grade}`);
  }

  if (block.not_worth !== undefined && typeof block.not_worth !== 'boolean') {
    throw new Error('not_worth must be a boolean');
  }
}

describe("Blocks API Contract", () => {
  describe("GET /api/blocks-fast", () => {
    it("returns valid venue blocks structure", async () => {
      // Use a valid UUID format
      const testSnapshotId = process.env.TEST_SNAPSHOT_ID || "12345678-1234-5678-1234-567812345678";

      const res = await request(app)
        .get(`/api/blocks-fast?snapshotId=${testSnapshotId}`)
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${testToken}`);

      // Should return 200 or 202 (if strategy is still pending)
      expect([200, 202]).toContain(res.status);
      expect(res.body).toHaveProperty('blocks');
      expect(Array.isArray(res.body.blocks)).toBe(true);

      // Only validate blocks if they exist (200 status)
      if (res.status === 200 && res.body.blocks.length > 0) {
        // Validate each block against schema
        res.body.blocks.forEach((block) => {
          expect(() => validateVenueBlock(block)).not.toThrow();
        });

        // All block names should be unique
        const names = res.body.blocks.map(b => b.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
      }
    });

    it("returns 202 or empty blocks for non-existent snapshot", async () => {
      const fakeSnapshotId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/blocks-fast?snapshotId=${fakeSnapshotId}`)
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${testToken}`);

      // API returns 202 if strategy pending, or 200 with empty blocks
      expect([200, 202]).toContain(res.status);
      expect(res.body).toHaveProperty('blocks');
      expect(Array.isArray(res.body.blocks)).toBe(true);
    });

    it("returns 400 for missing snapshotId", async () => {
      const res = await request(app)
        .get('/api/blocks-fast')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('snapshot_required');
    });
  });

  describe("Venue block validation function", () => {
    it("validates venue block with all required fields", () => {
      const validVenue = {
        name: "Test Venue",
        coordinates: { lat: 33.128, lng: -96.875 },
        address: "123 Test St, Frisco, TX",
        placeId: "ChIJtest123",
        estimated_distance_miles: 5.2,
        driveTimeMinutes: 12,
        value_per_min: 0.75,
        value_grade: "B",
        not_worth: false
      };

      expect(() => validateVenueBlock(validVenue)).not.toThrow();
    });

    it("validates minimal venue block", () => {
      const minimalVenue = {
        name: "Test Venue",
        coordinates: { lat: 33.128, lng: -96.875 }
      };

      expect(() => validateVenueBlock(minimalVenue)).not.toThrow();
    });

    it("rejects venue missing name", () => {
      const invalidVenue = {
        coordinates: { lat: 33.128, lng: -96.875 }
      };

      expect(() => validateVenueBlock(invalidVenue)).toThrow("Missing required field: name");
    });

    it("rejects venue missing coordinates", () => {
      const invalidVenue = {
        name: "Test Venue"
      };

      expect(() => validateVenueBlock(invalidVenue)).toThrow("Missing required field: coordinates");
    });

    it("rejects venue with invalid coordinates", () => {
      const invalidVenue = {
        name: "Test Venue",
        coordinates: { lat: "invalid", lng: -96.875 }
      };

      expect(() => validateVenueBlock(invalidVenue)).toThrow("Invalid coordinates structure");
    });

    it("rejects invalid value_grade", () => {
      const invalidVenue = {
        name: "Test Venue",
        coordinates: { lat: 33.128, lng: -96.875 },
        value_grade: "F"
      };

      expect(() => validateVenueBlock(invalidVenue)).toThrow("Invalid value_grade: F");
    });

    it("rejects non-boolean not_worth", () => {
      const invalidVenue = {
        name: "Test Venue",
        coordinates: { lat: 33.128, lng: -96.875 },
        not_worth: "false"
      };

      expect(() => validateVenueBlock(invalidVenue)).toThrow("not_worth must be a boolean");
    });
  });
});