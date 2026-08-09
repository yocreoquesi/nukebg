import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for NukeBG end-to-end tests.
 *
 * WebKit approximates Safari on desktop but is NOT iOS Safari. The iOS Safari
 * hang at 96% (warmup inference) is NOT reproducible here — keep these tests
 * for smoke coverage and regression on Chromium/WebKit, not as a substitute
 * for a real device.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 15 Pro'] },
    },
  ],
});
