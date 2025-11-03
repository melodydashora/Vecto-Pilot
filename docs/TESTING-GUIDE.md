# Vecto Pilot - Complete Testing Guide

## 🎯 Testing Philosophy

Vecto Pilot uses a **three-layer testing strategy** to ensure reliability from database to user interface:

1. **Unit Tests (Jest)** - API contract validation
2. **E2E Tests (Playwright)** - Browser rendering & UX
3. **Seed Data** - Instant test fixtures

## 🚀 Quick Start

### One-Command Test Suite
```bash
./scripts/test-all.sh
```

This comprehensive script:
1. ✅ Seeds test database
2. ✅ Runs 19 Jest unit tests
3. ✅ Runs 14 Playwright E2E tests
4. ✅ Validates complete stack

**Total: 33 automated tests** in under 2 minutes.

## 📦 Test Layers

### Layer 1: Seed Data
**Purpose**: Create instant test fixtures without waiting for AI pipeline

**Script**: `scripts/seed-dev.js`

**Creates**:
- Snapshot ID: `test-snapshot-001`
- Location: San Francisco (37.7749, -122.4194)
- Strategy: Complete with consolidated text
- Briefing: Perplexity research data

**Usage**:
```bash
node scripts/seed-dev.js
```

**Output**:
```
📋 Test Data Created:
   Snapshot ID: test-snapshot-001
   User ID: <random-uuid>

🧪 Test Endpoints:
   GET /api/strategy/test-snapshot-001
   GET /api/blocks/strategy/test-snapshot-001
```

---

### Layer 2: Jest Unit Tests
**Purpose**: Validate Block Schema Contract (API → Frontend)

**File**: `tests/blocksApi.test.js`  
**Framework**: Jest with ESM support

**Coverage**: 19 tests
- ✅ API endpoint contract
- ✅ Base field validation (id, type, order)
- ✅ Type-specific fields
- ✅ Enum validation (header levels, list styles)
- ✅ Edge cases (missing fields, unknown types)

**Usage**:
```bash
# Run all Jest tests
NODE_OPTIONS='--experimental-vm-modules' npx jest

# Run block tests only
TEST_SNAPSHOT_ID=test-snapshot-001 NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js

# Watch mode
NODE_OPTIONS='--experimental-vm-modules' npx jest --watch
```

**Example Test**:
```javascript
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
```

---

### Layer 3: Playwright E2E Tests
**Purpose**: Validate real browser rendering (DB → API → React → DOM)

**File**: `tests/e2e/copilot.spec.ts`  
**Framework**: Playwright (Chromium)

**Coverage**: 14 tests
- ✅ Page structure loads
- ✅ Smart blocks render
- ✅ User interactions work
- ✅ Error handling graceful
- ✅ Loading states display

**First-time setup**:
```bash
npx playwright install chromium
```

**Usage**:
```bash
# Run all E2E tests
npx playwright test

# Run with UI (interactive)
npx playwright test --ui

# Run in headed mode (see browser)
npx playwright test --headed

# Debug specific test
npx playwright test --debug tests/e2e/copilot.spec.ts
```

**Example Test**:
```typescript
test("renders smart blocks from seeded data", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState('networkidle');
  
  const header = page.locator('h2').filter({ hasText: /Strategy/i });
  await expect(header).toBeVisible({ timeout: 10000 });
});
```

---

## 📊 Test Coverage Summary

| Layer | Framework | Tests | What It Tests |
|-------|-----------|-------|---------------|
| **Seed** | Node.js | N/A | Test data creation |
| **Unit** | Jest | 19 | API contract compliance |
| **E2E** | Playwright | 14 | Browser rendering & UX |
| **Total** | - | **33** | **Full stack validation** |

### Detailed Coverage

#### Jest Unit Tests (19)
| Category | Count | Examples |
|----------|-------|----------|
| API Endpoint | 2 | Response structure, 404 handling |
| Block Validation | 7 | Header, paragraph, list, quote, CTA, image, divider |
| Field Requirements | 3 | Missing ID, missing type fields |
| Edge Cases | 4 | Unknown types, invalid enums |
| Enum Validation | 3 | Header levels, list styles, CTA variants |

#### Playwright E2E Tests (14)
| Category | Count | Examples |
|----------|-------|----------|
| Page Structure | 2 | Header exists, tabs visible |
| Block Rendering | 4 | Strategy section, smart blocks, content |
| Block Schema | 2 | Block attributes, list items |
| Seeded Data | 2 | Specific content, retry capability |
| Interactive | 2 | History panel, scrolling |
| Error Handling | 2 | Missing snapshots, loading states |

---

## 🔧 Development Workflows

### Workflow 1: Adding New Feature
```bash
# 1. Make changes to code
vim server/routes/content-blocks.js

# 2. Run unit tests
npm run test:blocks

# 3. Run E2E tests
npx playwright test

# 4. Fix any failures
# ... iterate ...

# 5. Commit
git add .
git commit -m "Add new block type"
```

### Workflow 2: Testing UI Changes
```bash
# 1. Seed fresh data
node scripts/seed-dev.js

# 2. Start dev server
npm run dev

# 3. Run Playwright in UI mode
npx playwright test --ui

# 4. Interact with tests visually
# ... debug visually ...
```

### Workflow 3: CI/CD Pipeline
```bash
# Complete test suite (for CI)
./scripts/test-all.sh
```

---

## 🐛 Debugging

### Jest Tests Failing

**Issue**: "Missing base field: id"
```bash
# Solution: Check API response structure
curl http://localhost:5000/api/blocks/strategy/test-snapshot-001 | jq
```

**Issue**: "Unknown block type"
```javascript
// Solution: Add type to schema in tests/blocksApi.test.js
const blockSchema = {
  types: {
    newType: ["requiredField"]
  }
};
```

### Playwright Tests Failing

**Issue**: "Timeout waiting for element"
```typescript
// Solution 1: Increase timeout
await expect(element).toBeVisible({ timeout: 15000 });

// Solution 2: Wait for network
await page.waitForLoadState('networkidle');

// Solution 3: Run in headed mode to debug
npx playwright test --headed
```

**Issue**: "Element not visible"
```bash
# Solution: Run with trace
npx playwright test --trace on
npx playwright show-trace trace.zip
```

### Seed Script Failing

**Issue**: "Database connection refused"
```bash
# Solution: Check DATABASE_URL
echo $DATABASE_URL

# Verify database is running
psql $DATABASE_URL -c "SELECT 1"
```

---

## 🎓 Best Practices

### Writing Tests

1. **Keep tests independent**: Each test should work alone
2. **Use semantic selectors**: Prefer `data-testid` over CSS classes
3. **Add helpful assertions**: Clear error messages
4. **Mock external APIs**: Don't hit real services in tests
5. **Clean up after tests**: Reset state in afterEach

### Maintaining Tests

1. **Update tests when features change**: Don't let tests block progress
2. **Run tests locally before CI**: Catch issues early
3. **Fix broken tests immediately**: Don't accumulate test debt
4. **Document test requirements**: Update README when needed
5. **Review test coverage**: Ensure new code is tested

### CI/CD Integration

**GitHub Actions Example**:
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: npm install
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Seed database
        run: node scripts/seed-dev.js
      
      - name: Run Jest tests
        run: TEST_SNAPSHOT_ID=test-snapshot-001 NODE_OPTIONS='--experimental-vm-modules' npx jest
      
      - name: Run Playwright tests
        run: npx playwright test
      
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: |
            playwright-report/
            coverage/
```

---

## 📚 Documentation

### Main Docs
- **Testing Guide** (this file): Complete testing overview
- **[Block Schema Contract](BLOCK-SCHEMA-CONTRACT.md)**: Contract specification
- **[Jest Tests README](../tests/README-BLOCKS.md)**: Unit test details
- **[Playwright Tests README](../tests/e2e/README.md)**: E2E test details

### Test Files
- `tests/blocksApi.test.js` - Jest unit tests
- `tests/e2e/copilot.spec.ts` - Playwright E2E tests
- `scripts/seed-dev.js` - Seed script
- `jest.config.js` - Jest configuration
- `playwright.config.ts` - Playwright configuration

### Helper Scripts
- `scripts/test-all.sh` - Complete test suite
- `scripts/test-with-seed.sh` - Seed + Jest tests

---

## ✅ Success Criteria

Your tests should:
- ✅ Run in under 2 minutes locally
- ✅ Pass consistently (no flaky tests)
- ✅ Cover critical user paths
- ✅ Catch regressions before deployment
- ✅ Provide clear failure messages
- ✅ Be easy to maintain and update

## 🎉 Benefits

### For Developers
- **Fast feedback**: Know if code works in seconds
- **Confidence**: Ship without fear of breaking things
- **Documentation**: Tests show how code should work
- **Debugging**: Tests isolate problems quickly

### For Product
- **Quality**: Fewer bugs reach production
- **Speed**: Ship features faster with confidence
- **Reliability**: Consistent user experience
- **Maintenance**: Easier to refactor code

### For Business
- **Lower costs**: Catch bugs before they reach users
- **Faster delivery**: Less time fixing production issues
- **Better UX**: More reliable product
- **Scalability**: Safe to make changes

---

## 🔗 Quick Reference

```bash
# Complete test suite
./scripts/test-all.sh

# Seed only
node scripts/seed-dev.js

# Jest only
npm run test:blocks

# Playwright only
npx playwright test

# Playwright UI mode
npx playwright test --ui

# Playwright headed
npx playwright test --headed

# Playwright debug
npx playwright test --debug
```

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-03  
**Status**: Production Ready ✅  
**Total Tests**: 33 (19 Jest + 14 Playwright)
