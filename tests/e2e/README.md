# Playwright E2E Tests - CoPilot Smart Blocks

## Overview
End-to-end tests validating the complete flow: Database → API → React → DOM rendering.

## Quick Start

### 1. Install Playwright browsers (first time only)
```bash
npx playwright install chromium
```

### 2. Run all tests (recommended)
```bash
./scripts/test-all.sh
```

This runs:
1. Seeds test data
2. Jest unit tests
3. Playwright E2E tests

### 3. Run Playwright tests only
```bash
npx playwright test
```

### 4. Run with UI (interactive mode)
```bash
npx playwright test --ui
```

### 5. Run specific test file
```bash
npx playwright test tests/e2e/copilot.spec.ts
```

## Test Structure

### Test Suites

#### 1. Smart Blocks Rendering
Tests that validate block rendering from database to DOM:
- Page structure loads correctly
- Strategy section displays
- Smart blocks render from seeded data
- Retry button appears
- History panel toggle exists

#### 2. Block Schema Validation
DOM-level validation of block structure:
- Blocks have proper data-testid attributes
- List blocks render items correctly
- Block content is structured properly

#### 3. With Seeded Snapshot
Tests using the seeded snapshot directly:
- Renders specific seeded content
- Shows retry capability
- Validates expected text content

#### 4. Interactive Features
Tests for user interactions:
- History panel can be toggled
- Smart blocks section is scrollable
- UI responds to user actions

#### 5. Error States
Graceful degradation testing:
- Handles missing snapshots
- Shows loading states
- Doesn't crash on errors

## Prerequisites

### 1. Seed test data
```bash
node scripts/seed-dev.js
```

This creates:
- Snapshot: `test-snapshot-001`
- Strategy with consolidated text
- Briefing data

### 2. Start dev server
```bash
npm run dev
```

Server runs on `http://localhost:5000`

## Test Configuration

**File**: `playwright.config.ts`

Key settings:
- **Base URL**: `http://localhost:5000`
- **Test Directory**: `./tests/e2e`
- **Browser**: Chromium (Desktop Chrome)
- **Web Server**: Auto-starts dev server
- **Timeout**: 120s for server startup
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: On failure only
- **Trace**: On first retry

## Writing Tests

### Best Practices

#### 1. Use semantic selectors
```typescript
// Good - semantic HTML
const header = page.locator('h2');

// Better - with text filter
const header = page.locator('h2').filter({ hasText: /Strategy/i });

// Best - with data-testid
const header = page.locator('[data-testid="strategy-header"]');
```

#### 2. Wait for content
```typescript
// Wait for network to settle
await page.waitForLoadState('networkidle');

// Wait for specific element
await expect(element).toBeVisible({ timeout: 10000 });

// Wait for time (use sparingly)
await page.waitForTimeout(3000);
```

#### 3. Handle dynamic content
```typescript
// Check if element exists before interacting
if (await button.count() > 0) {
  await button.first().click();
}

// Use try-catch for optional elements
const isVisible = await element.isVisible({ timeout: 1000 }).catch(() => false);
```

### Example Test
```typescript
test("renders smart blocks", async ({ page }) => {
  // 1. Navigate
  await page.goto("/");
  
  // 2. Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // 3. Assert elements exist
  const header = page.locator('[data-testid="strategy-section"]');
  await expect(header).toBeVisible({ timeout: 10000 });
  
  // 4. Validate content
  const text = await header.textContent();
  expect(text).toContain('Strategy');
});
```

## Debugging Tests

### 1. Run in headed mode
```bash
npx playwright test --headed
```

### 2. Debug specific test
```bash
npx playwright test --debug tests/e2e/copilot.spec.ts
```

### 3. View trace
```bash
npx playwright show-trace trace.zip
```

### 4. Generate test code
```bash
npx playwright codegen http://localhost:5000
```

### 5. View test report
```bash
npx playwright show-report
```

## Common Issues

### Issue: "Browser not found"
**Solution**: Install Playwright browsers
```bash
npx playwright install
```

### Issue: "Connection refused"
**Solution**: Ensure dev server is running
```bash
npm run dev
```

### Issue: "Timeout waiting for element"
**Solutions**:
1. Increase timeout: `{ timeout: 15000 }`
2. Check element selector is correct
3. Verify element actually appears in browser
4. Run in headed mode to debug

### Issue: "Element not visible"
**Solutions**:
1. Wait for load state: `waitForLoadState('networkidle')`
2. Add explicit wait: `waitForTimeout(3000)`
3. Check if element is in viewport
4. Verify CSS doesn't hide element

## CI/CD Integration

### GitHub Actions
```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm install
      
      - name: Install Playwright
        run: npx playwright install --with-deps chromium
      
      - name: Seed database
        run: node scripts/seed-dev.js
      
      - name: Run E2E tests
        run: npx playwright test
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## Test Coverage

| Test Category | Tests | Status |
|--------------|-------|--------|
| Page Structure | 2 | ✅ |
| Block Rendering | 4 | ✅ |
| Block Schema | 2 | ✅ |
| Seeded Data | 2 | ✅ |
| Interactive | 2 | ✅ |
| Error Handling | 2 | ✅ |
| **Total** | **14** | ✅ |

## What This Validates

1. **Full Stack Integration**: DB → API → React → DOM
2. **Real Browser Behavior**: Tests actual user experience
3. **Visual Rendering**: Validates blocks appear correctly
4. **Interaction Flows**: Tests user actions work
5. **Error Handling**: Graceful degradation on errors

## Benefits Over Unit Tests

| Aspect | Unit Tests (Jest) | E2E Tests (Playwright) |
|--------|------------------|----------------------|
| Scope | API contract | Full user flow |
| Speed | Fast (ms) | Slower (seconds) |
| Coverage | Backend logic | Frontend + Backend |
| Browser | No | Yes (real Chrome) |
| Visual | No | Yes (screenshots) |
| User POV | No | Yes (actual UX) |

**Use both**: Jest for contracts, Playwright for user experience.

## Maintenance Tips

1. **Keep selectors stable**: Use `data-testid` attributes
2. **Update tests when UI changes**: Don't let tests block progress
3. **Run tests locally before CI**: Catch issues early
4. **Keep tests independent**: Each test should work alone
5. **Clean up test data**: Use beforeEach/afterEach hooks

## Related Files

- `playwright.config.ts` - Playwright configuration
- `tests/e2e/copilot.spec.ts` - CoPilot E2E tests
- `scripts/seed-dev.js` - Test data seeding
- `scripts/test-all.sh` - Complete test suite
- `tests/README-BLOCKS.md` - Jest unit tests

---

**Last Updated**: 2025-11-03  
**Framework**: Playwright v1.x  
**Status**: Production Ready ✅
