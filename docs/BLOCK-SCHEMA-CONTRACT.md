# Block Schema Contract - Implementation Guide

## 🎯 Overview

The Block Schema Contract is a strict data format specification ensuring consistency between:
- **Backend**: Content Blocks API (`/api/blocks/strategy/:snapshotId`)
- **Frontend**: SmartBlock Component
- **Tests**: Jest validation suite

## 📦 Components

### 1. SmartBlock Component
**Location**: `client/src/components/SmartBlock.tsx`

Renders all 7 block types with TypeScript type safety:
- header, paragraph, list, image, quote, cta, divider

```tsx
<SmartBlock block={block} />
```

### 2. Content Blocks API
**Location**: `server/routes/content-blocks.js`

**Endpoint**: `GET /api/blocks/strategy/:snapshotId`

**Response**:
```json
{
  "snapshot_id": "sid-123",
  "blocks": [
    {
      "id": "b1",
      "type": "header",
      "order": 1,
      "text": "Morning Strategy",
      "level": 2
    }
  ]
}
```

### 3. Jest Test Suite
**Location**: `tests/blocksApi.test.js`

19 unit tests covering:
- API contract validation
- Schema enforcement
- Edge cases
- Type-specific field requirements

### 4. Playwright E2E Tests
**Location**: `tests/e2e/copilot.spec.ts`

14 end-to-end tests covering:
- Full-stack integration (DB → API → React → DOM)
- Smart blocks rendering in browser
- User interactions (retry, history panel)
- Error handling and loading states

### 5. Seed Script
**Location**: `scripts/seed-dev.js`

Seeds test data:
- Snapshot (San Francisco location)
- Strategy (complete with consolidated text)
- Briefing (Perplexity research)

## 🔒 Schema Contract

### Base Fields (Required for ALL blocks)
```typescript
{
  id: string;      // Unique identifier
  type: string;    // Block type
  order: number;   // Display order (1-based)
}
```

### Block Types

#### Header
```typescript
{
  id: string;
  type: "header";
  order: number;
  text: string;
  level?: 1 | 2 | 3;  // Optional, default: 2
}
```

#### Paragraph
```typescript
{
  id: string;
  type: "paragraph";
  order: number;
  text: string;
}
```

#### List
```typescript
{
  id: string;
  type: "list";
  order: number;
  items: string[];
  style?: "bullet" | "number";  // Optional
}
```

#### Image
```typescript
{
  id: string;
  type: "image";
  order: number;
  url: string;
  caption?: string;  // Optional
}
```

#### Quote
```typescript
{
  id: string;
  type: "quote";
  order: number;
  text: string;
  author: string;
}
```

#### CTA (Call-to-Action)
```typescript
{
  id: string;
  type: "cta";
  order: number;
  label: string;
  action: string;
  variant?: "primary" | "secondary";  // Optional
}
```

#### Divider
```typescript
{
  id: string;
  type: "divider";
  order: number;
}
```

## 🚀 Quick Start

### 1. Run all tests (recommended)
```bash
./scripts/test-all.sh
```

This runs:
1. Seeds test data
2. Jest unit tests (API contract)
3. Playwright E2E tests (browser rendering)

### 2. Run tests separately

#### Seed + Unit Tests
```bash
./scripts/test-with-seed.sh
```

#### E2E Tests Only
```bash
npx playwright test
```

#### Install Playwright (first time)
```bash
npx playwright install chromium
```

### 3. Test endpoints manually
```bash
curl http://localhost:5000/api/strategy/test-snapshot-001
curl http://localhost:5000/api/blocks/strategy/test-snapshot-001
```

## ✅ What This Ensures

### Unit Tests (Jest)
1. **Type Safety**: Frontend can trust block structure
2. **Contract Enforcement**: Backend always returns valid blocks
3. **Regression Prevention**: Schema drift breaks CI tests
4. **Self-Documentation**: Tests serve as living API docs

### E2E Tests (Playwright)
1. **Full Stack Validation**: DB → API → React → DOM rendering
2. **Real Browser Testing**: Actual Chrome browser behavior
3. **Visual Verification**: Blocks render correctly on screen
4. **User Experience**: Interactions work as expected
5. **Error Handling**: Graceful degradation verified

### Combined Benefits
- **CI/CD Ready**: Automated validation in build pipeline
- **Comprehensive Coverage**: Contract + UX validation
- **Confidence**: Know code works from database to display

## 🔧 Development Workflow

### Adding a New Block Type

1. **Update schema** in `tests/blocksApi.test.js`:
```javascript
const blockSchema = {
  base: ["id", "type", "order"],
  types: {
    // ... existing types
    newType: ["requiredField1", "requiredField2"]
  }
};
```

2. **Update SmartBlock** (`client/src/components/SmartBlock.tsx`):
```tsx
case 'newType':
  return <div>{block.requiredField1}</div>;
```

3. **Update API** (`server/routes/content-blocks.js`):
```javascript
blocks.push({
  id: `b${order++}`,
  type: 'newType',
  order: blocks.length + 1,
  requiredField1: 'value',
  requiredField2: 'value'
});
```

4. **Run tests** to validate:
```bash
npm test
```

## 📊 Test Coverage

### Jest Unit Tests (API Contract)

| Category | Tests | Status |
|----------|-------|--------|
| API Endpoint | 2 | ✅ |
| Block Validation | 7 | ✅ |
| Field Requirements | 3 | ✅ |
| Edge Cases | 4 | ✅ |
| Enum Validation | 3 | ✅ |
| **Subtotal** | **19** | ✅ |

### Playwright E2E Tests (Browser Rendering)

| Category | Tests | Status |
|----------|-------|--------|
| Page Structure | 2 | ✅ |
| Block Rendering | 4 | ✅ |
| Block Schema | 2 | ✅ |
| Seeded Data | 2 | ✅ |
| Interactive | 2 | ✅ |
| Error Handling | 2 | ✅ |
| **Subtotal** | **14** | ✅ |

### Total Coverage
**33 automated tests** covering contract + user experience

## 🔗 Integration Points

### Backend
```javascript
// server/routes/content-blocks.js
import { strategies, snapshots } from '../../shared/schema.js';
// Generates blocks from strategy.consolidated_strategy
```

### Frontend
```tsx
// client/src/components/StrategySection.tsx
import { SmartBlock } from '@/components/SmartBlock';
// Renders blocks in sorted order
```

### SDK Router
```javascript
// sdk-embed.js
import contentBlocksRoutes from "./server/routes/content-blocks.js";
r.use('/blocks', contentBlocksRoutes);
```

## 📝 Files Modified/Created

### Created
- ✅ `client/src/components/SmartBlock.tsx` - Block renderer
- ✅ `server/routes/content-blocks.js` - API endpoint
- ✅ `tests/blocksApi.test.js` - Jest unit tests (19 tests)
- ✅ `tests/e2e/copilot.spec.ts` - Playwright E2E tests (14 tests)
- ✅ `tests/README-BLOCKS.md` - Jest test documentation
- ✅ `tests/e2e/README.md` - Playwright test documentation
- ✅ `scripts/seed-dev.js` - Seed script
- ✅ `scripts/test-with-seed.sh` - Jest test helper
- ✅ `scripts/test-all.sh` - Complete test suite (seed + Jest + Playwright)
- ✅ `jest.config.js` - Jest configuration
- ✅ `playwright.config.ts` - Playwright configuration
- ✅ `docs/BLOCK-SCHEMA-CONTRACT.md` - This document

### Modified
- ✅ `sdk-embed.js` - Added content-blocks route

## 🎓 Best Practices

1. **Always validate blocks** before rendering
2. **Use TypeScript types** for compile-time safety
3. **Run tests** after schema changes
4. **Seed test data** for consistent testing
5. **Document new types** immediately

## 🐛 Troubleshooting

### Test fails: "Missing base field"
- Check that all blocks have `id`, `type`, `order`
- Verify backend generates these fields

### Test fails: "Unknown block type"
- Add new type to `blockSchema.types` in test file
- Update SmartBlock component

### Test fails: "Invalid list style"
- Ensure list `style` is "bullet" or "number"
- Check enum validation in test

### ESM Import Errors
- Set `NODE_OPTIONS='--experimental-vm-modules'`
- Verify `jest.config.js` has `transform: {}`

## 📚 References

- [SmartBlock Component](../client/src/components/SmartBlock.tsx)
- [Content Blocks API](../server/routes/content-blocks.js)
- [Test Suite](../tests/blocksApi.test.js)
- [Seed Script](../scripts/seed-dev.js)
- [Test Documentation](../tests/README-BLOCKS.md)

---

**Contract Version**: 1.0.0  
**Last Updated**: 2025-11-03  
**Status**: Production Ready ✅
