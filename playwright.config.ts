import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for end-to-end testing
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 2026-04-18: Replit injects a pre-built Chromium (140.0.7339.16) linked against this
        // Nix env's libgbm/nss/dbus. Using it avoids the libgbm.so.1 load failure we hit with
        // the chrome-headless-shell that `npx playwright install chromium` pulls down.
        launchOptions: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],

  // 2026-04-18: webServer disabled — the dev gateway is managed externally
  // (via Replit's Play button or bin/vecto-runner). Tests assume port 5000 is already up.
});
