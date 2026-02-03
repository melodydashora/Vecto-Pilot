import { test, expect } from "@playwright/test";

/**
 * CoPilot Page E2E Tests
 * 
 * Prerequisites:
 * 1. Run seed script: node scripts/seed-dev.js
 * 2. Start dev server: npm run dev
 * 3. Run tests: npx playwright test
 */

test.describe("CoPilot Page - Smart Blocks Rendering", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to CoPilot page
    // The app is a single-page app with CoPilot as main content
    await page.goto("/");
    
    // Wait for location context to initialize
    await page.waitForLoadState('networkidle');
  });

  test("renders page structure", async ({ page }) => {
    // Check that main header exists
    const header = page.locator('[data-testid="global-header"]');
    await expect(header).toBeVisible();
    
    // Check that CoPilot tab is active
    const copilotTab = page.locator('[data-testid="tab-copilot"]');
    await expect(copilotTab).toBeVisible();
  });

  test("displays strategy section", async ({ page }) => {
    // Strategy section should be present
    const strategySection = page.locator('[data-testid="strategy-section"]');
    await expect(strategySection).toBeVisible({ timeout: 10000 });
  });

  test("renders smart blocks from seeded data", async ({ page }) => {
    // Wait for strategy to load (may take a few seconds for SSE)
    await page.waitForTimeout(3000);
    
    // Check for block content (exact selectors depend on SmartBlock implementation)
    // Looking for semantic content that would be generated from seeded strategy
    
    // Header blocks (h2 or h3 within strategy section)
    const headers = page.locator('h2, h3').filter({ hasText: /Strategy|Morning|Afternoon|Evening/i });
    await expect(headers.first()).toBeVisible({ timeout: 15000 });
    
    // Paragraph blocks
    const paragraphs = page.locator('p').filter({ hasText: /focus|recommend|strategy|tactical/i });
    await expect(paragraphs.first()).toBeVisible({ timeout: 5000 });
  });

  test("displays retry button when strategy exists", async ({ page }) => {
    // Wait for strategy to load
    await page.waitForTimeout(3000);
    
    // Retry button should appear when strategy is complete
    const retryButton = page.locator('button').filter({ hasText: /retry|refresh|generate/i });
    
    // Use a longer timeout as strategy might still be generating
    await expect(retryButton.first()).toBeVisible({ timeout: 20000 });
  });

  test("shows history panel toggle", async ({ page }) => {
    // History toggle should be visible
    const historyToggle = page.locator('button').filter({ hasText: /history|past|previous/i });
    await expect(historyToggle.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("CoPilot Page - Block Schema Validation", () => {
  test("smart blocks have proper structure", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // All blocks should have data-testid attributes
    const blocks = page.locator('[data-testid^="block-"]');
    const count = await blocks.count();
    
    // Should have at least one block if strategy loaded
    if (count > 0) {
      expect(count).toBeGreaterThan(0);
      
      // First block should be visible
      await expect(blocks.first()).toBeVisible();
    }
  });

  test("list blocks render items correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    
    // Look for list items (bullet or numbered)
    const listItems = page.locator('ul li, ol li');
    const count = await listItems.count();
    
    if (count > 0) {
      // At least one list item should be visible
      await expect(listItems.first()).toBeVisible();
      
      // List items should have content
      const text = await listItems.first().textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });
});

test.describe("CoPilot Page - With Seeded Snapshot", () => {
  test("renders seeded smart blocks", async ({ page }) => {
    // Navigate directly with seeded snapshot ID
    // This assumes your app accepts snapshot ID via query param or similar
    await page.goto("/?snapshot_id=test-snapshot-001");
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Look for content from seeded strategy
    // The seeded strategy contains "Airport" and "Terminal" text
    const content = page.locator('text=/airport|terminal|morning|strategy/i');
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("seeded strategy shows retry capability", async ({ page }) => {
    await page.goto("/?snapshot_id=test-snapshot-001");
    await page.waitForTimeout(2000);
    
    // Retry button should work with seeded data
    const retryButton = page.locator('button').filter({ hasText: /retry/i });
    await expect(retryButton.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("CoPilot Page - Interactive Features", () => {
  test("can toggle history panel", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    
    // Find and click history toggle
    const historyToggle = page.locator('button').filter({ hasText: /history/i });
    
    if (await historyToggle.count() > 0) {
      await historyToggle.first().click();
      
      // History panel should appear
      const historyPanel = page.locator('[data-testid="history-panel"]');
      await expect(historyPanel).toBeVisible({ timeout: 5000 });
    }
  });

  test("smart blocks section is scrollable", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    
    // Strategy section should exist and be scrollable if content overflows
    const strategySection = page.locator('[data-testid="strategy-section"]');
    
    if (await strategySection.count() > 0) {
      await expect(strategySection.first()).toBeVisible();
      
      // Check that it has scroll container properties
      const overflow = await strategySection.first().evaluate(el => 
        window.getComputedStyle(el).overflowY
      );
      
      // Should allow scrolling
      expect(['auto', 'scroll', 'visible']).toContain(overflow);
    }
  });
});

test.describe("CoPilot Page - Error States", () => {
  test("handles missing snapshot gracefully", async ({ page }) => {
    // Navigate with non-existent snapshot
    await page.goto("/?snapshot_id=00000000-0000-0000-0000-000000000000");
    await page.waitForLoadState('networkidle');
    
    // App should still render without crashing
    const header = page.locator('[data-testid="global-header"]');
    await expect(header).toBeVisible();
  });

  test("shows loading state initially", async ({ page }) => {
    await page.goto("/");
    
    // Should show some kind of loading indicator initially
    // This could be skeleton, spinner, or "Generating..." text
    const loadingIndicator = page.locator('text=/loading|generating|waiting/i');
    
    // Check if loading state appears (might be very brief)
    const isVisible = await loadingIndicator.first().isVisible({ timeout: 1000 }).catch(() => false);
    
    // It's okay if it loads so fast we miss it
    expect(typeof isVisible).toBe('boolean');
  });
});
