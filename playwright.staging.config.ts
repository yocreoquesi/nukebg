import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for validating the live dev staging deploy at
 * nukebg.pages.dev. No local webServer — points at the deployed build.
 * Run via: npx playwright test --config=playwright.staging.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://nukebg.pages.dev',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
