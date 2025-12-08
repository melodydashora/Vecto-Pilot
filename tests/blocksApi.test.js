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

// Define schema contract
const blockSchema = {
  base: ["id", "type", "order"],
  types: {
    header: ["text"],
    paragraph: ["text"],
    list: ["items"],
    image: ["url"],
    quote: ["text", "author"],
    cta: ["label", "action"],
    divider: [],
  },
};

/**
 * Validate a block against the schema contract
 * @param {Object} block - Block object to validate
 * @throws {Error} if validation fails
 */
function validateBlock(block) {
  // Validate base fields (id, type, order)
  blockSchema.base.forEach((field) => {
    if (!(field in block)) {
      throw new Error(`Missing base field: ${field}`);
    }
  });

  // Validate type-specific required fields
  const requiredFields = blockSchema.types[block.type];
  if (!requiredFields) {
    throw new Error(`Unknown block type: ${block.type}`);
  }
  
  requiredFields.forEach((field) => {
    if (!(field in block)) {
      throw new Error(`Missing ${block.type} field: ${field}`);
    }
  });

  // Additional type-specific validations
  switch (block.type) {
    case 'header':
      if (block.level && ![1, 2, 3].includes(block.level)) {
        throw new Error(`Invalid header level: ${block.level}`);
      }
      break;
    case 'list':
      if (!Array.isArray(block.items)) {
        throw new Error('List items must be an array');
      }
      if (block.style && !['bullet', 'number'].includes(block.style)) {
        throw new Error(`Invalid list style: ${block.style}`);
      }
      break;
    case 'cta':
      if (block.variant && !['primary', 'secondary'].includes(block.variant)) {
        throw new Error(`Invalid CTA variant: ${block.variant}`);
      }
      break;
  }
}

describe("Blocks API Contract", () => {
  describe("GET /api/blocks/strategy/:snapshotId", () => {
    it("returns valid blocks structure with seeded data", async () => {
      // Use seeded snapshot ID from environment
      const testSnapshotId = process.env.TEST_SNAPSHOT_ID || "test-snapshot-001";
      
      const res = await request(app)
        .get(`/api/blocks/strategy/${testSnapshotId}`)
        .set('Accept', 'application/json');

      // Should return 200 with seeded data
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('snapshot_id');
      expect(res.body.snapshot_id).toBe(testSnapshotId);
      expect(res.body).toHaveProperty('blocks');
      expect(Array.isArray(res.body.blocks)).toBe(true);
      expect(res.body.blocks.length).toBeGreaterThan(0);

      // Validate each block against schema
      res.body.blocks.forEach((block) => {
        expect(() => validateBlock(block)).not.toThrow();
      });

      // Blocks should be ordered
      const orders = res.body.blocks.map(b => b.order);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);

      // All block IDs should be unique
      const ids = res.body.blocks.map(b => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("returns 404 for non-existent snapshot", async () => {
      const res = await request(app)
        .get('/api/blocks/strategy/00000000-0000-0000-0000-000000000000')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
    });
  });

  describe("Block validation function", () => {
    it("validates header block with all required fields", () => {
      const validHeader = {
        id: "b1",
        type: "header",
        order: 1,
        text: "Test Header",
        level: 2
      };

      expect(() => validateBlock(validHeader)).not.toThrow();
    });

    it("validates paragraph block", () => {
      const validParagraph = {
        id: "b2",
        type: "paragraph",
        order: 2,
        text: "Test paragraph content"
      };

      expect(() => validateBlock(validParagraph)).not.toThrow();
    });

    it("validates list block with items array", () => {
      const validList = {
        id: "b3",
        type: "list",
        order: 3,
        items: ["Item 1", "Item 2"],
        style: "bullet"
      };

      expect(() => validateBlock(validList)).not.toThrow();
    });

    it("validates quote block", () => {
      const validQuote = {
        id: "b4",
        type: "quote",
        order: 4,
        text: "Test quote",
        author: "Test Author"
      };

      expect(() => validateBlock(validQuote)).not.toThrow();
    });

    it("validates CTA block", () => {
      const validCTA = {
        id: "b5",
        type: "cta",
        order: 5,
        label: "Click Me",
        action: "/test",
        variant: "primary"
      };

      expect(() => validateBlock(validCTA)).not.toThrow();
    });

    it("validates divider block", () => {
      const validDivider = {
        id: "b6",
        type: "divider",
        order: 6
      };

      expect(() => validateBlock(validDivider)).not.toThrow();
    });

    it("rejects block missing base field (id)", () => {
      const invalidBlock = {
        type: "paragraph",
        order: 1,
        text: "Test"
      };

      expect(() => validateBlock(invalidBlock)).toThrow("Missing base field: id");
    });

    it("rejects block missing type-specific field", () => {
      const invalidBlock = {
        id: "b1",
        type: "paragraph",
        order: 1
        // Missing 'text' field
      };

      expect(() => validateBlock(invalidBlock)).toThrow("Missing paragraph field: text");
    });

    it("rejects unknown block type", () => {
      const invalidBlock = {
        id: "b1",
        type: "unknown-type",
        order: 1
      };

      expect(() => validateBlock(invalidBlock)).toThrow("Unknown block type: unknown-type");
    });

    it("rejects invalid header level", () => {
      const invalidBlock = {
        id: "b1",
        type: "header",
        order: 1,
        text: "Test",
        level: 5 // Invalid - must be 1, 2, or 3
      };

      expect(() => validateBlock(invalidBlock)).toThrow("Invalid header level: 5");
    });

    it("rejects non-array list items", () => {
      const invalidBlock = {
        id: "b1",
        type: "list",
        order: 1,
        items: "not an array"
      };

      expect(() => validateBlock(invalidBlock)).toThrow("List items must be an array");
    });

    it("rejects invalid list style", () => {
      const invalidBlock = {
        id: "b1",
        type: "list",
        order: 1,
        items: ["test"],
        style: "invalid"
      };

      expect(() => validateBlock(invalidBlock)).toThrow("Invalid list style: invalid");
    });
  });

  describe("Block ordering", () => {
    it("ensures blocks can be sorted by order field", () => {
      const blocks = [
        { id: "b3", type: "divider", order: 3 },
        { id: "b1", type: "header", order: 1, text: "Test" },
        { id: "b2", type: "paragraph", order: 2, text: "Test" }
      ];

      const sorted = blocks.sort((a, b) => a.order - b.order);
      
      expect(sorted[0].id).toBe("b1");
      expect(sorted[1].id).toBe("b2");
      expect(sorted[2].id).toBe("b3");
    });
  });
});
