# Block Schema Contract Tests

## Overview
This test suite validates the Block Schema Contract ensuring consistency between backend API responses and frontend rendering.

## Running the Tests

### Run all tests
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest
```

### Run block schema tests only
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js
```

### Run tests in watch mode
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest --watch
```

### Run with coverage
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest --coverage
```

## Test Coverage

### API Endpoint Tests
- ✅ Validates `/api/blocks/strategy/:snapshotId` response structure
- ✅ Ensures blocks array is properly formatted
- ✅ Verifies all blocks conform to schema contract
- ✅ Tests block ordering (sorted by `order` field)
- ✅ Validates unique block IDs
- ✅ Rejects invalid snapshot ID formats

### Schema Validation Tests
- ✅ **Base fields** (id, type, order) present on all blocks
- ✅ **Type-specific fields** enforced per block type
- ✅ **Header blocks**: text + level (1-3)
- ✅ **Paragraph blocks**: text
- ✅ **List blocks**: items array + style (bullet/number)
- ✅ **Quote blocks**: text + author
- ✅ **CTA blocks**: label + action + variant
- ✅ **Divider blocks**: minimal structure
- ✅ Rejects unknown block types
- ✅ Rejects missing required fields
- ✅ Validates enum values (header level, list style, etc.)

## Block Schema Contract

### Base Structure (All Blocks)
```typescript
{
  id: string;        // Unique identifier
  type: BlockType;   // Block type
  order: number;     // Display order
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
  level?: 1 | 2 | 3;  // Optional, defaults to 2
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

## Example API Response
```json
{
  "snapshot_id": "abc123",
  "blocks": [
    {
      "id": "b1",
      "type": "header",
      "order": 1,
      "text": "Morning Strategy",
      "level": 2
    },
    {
      "id": "b2",
      "type": "paragraph",
      "order": 2,
      "text": "Focus on high-demand areas during rush hour."
    },
    {
      "id": "b3",
      "type": "list",
      "order": 3,
      "items": [
        "Airport zone: 6-9 AM",
        "Business district: 4-7 PM"
      ],
      "style": "bullet"
    }
  ]
}
```

## CI/CD Integration

### Add to GitHub Actions
```yaml
- name: Run Block Schema Tests
  run: NODE_OPTIONS='--experimental-vm-modules' npm test
```

### Pre-commit Hook
```bash
#!/bin/sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js
```

## What This Ensures
1. **Contract Enforcement**: Backend always returns valid block structures
2. **Type Safety**: Frontend can trust block types without runtime checks
3. **Regression Prevention**: Schema changes break tests immediately
4. **Documentation**: Tests serve as living documentation of the API

## Extending the Schema

### Adding a New Block Type

1. **Update schema contract** in test file:
```javascript
const blockSchema = {
  base: ["id", "type", "order"],
  types: {
    // ... existing types
    newType: ["requiredField1", "requiredField2"]
  }
};
```

2. **Update SmartBlock component** (`client/src/components/SmartBlock.tsx`)
3. **Update content-blocks API** (`server/routes/content-blocks.js`)
4. **Run tests** to verify

## Troubleshooting

### Test fails: "Unknown block type"
- Check that all block types are registered in `blockSchema.types`
- Verify backend is emitting valid type names

### Test fails: "Missing field"
- Ensure backend includes all required fields for the block type
- Check for typos in field names

### ESM Import Errors
- Make sure `NODE_OPTIONS='--experimental-vm-modules'` is set
- Verify `jest.config.js` has `transform: {}`

## Related Files
- `tests/blocksApi.test.js` - Test suite
- `client/src/components/SmartBlock.tsx` - Frontend renderer
- `server/routes/content-blocks.js` - Backend API
- `jest.config.js` - Jest configuration
