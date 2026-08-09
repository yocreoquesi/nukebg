import { test, expect } from '@playwright/test';

/**
 * Visual regression seed for the landing page (#81).
 *
 * Runs on every Playwright project — `chromium`, `webkit`, `iphone` —
 * and each captures its own baseline so hinting / kerning drift
 * between engines doesn't flag a false positive. `maxDiffPixelRatio`
 * allows ~1.5 % pixel noise to tolerate anti-aliasing differences
 * between CI runs.
 *
 * Regenerate baselines after intentional landing changes:
 *   npx playwright test --project=chromium --update-snapshots
 *   npx playwright test --project=webkit --update-snapshots
 *   npx playwright test --project=iphone --update-snapshots
 */
test.describe('landing visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for fonts + the marquee opening paint so the snapshot is stable.
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(500);
    // Pause the marquee animation so snapshots are deterministic across
    // runs. CSS animations tick at different phases otherwise.
    await page.addStyleTag({
      content: `
        .marquee-bleed span,
        .precision-marquee span { animation: none !important; }
        .cmd-state-dot { animation: none !important; }
      `,
    });
  });

  test('above-the-fold landing matches baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('landing-above-fold.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.015,
      animations: 'disabled',
    });
  });
});
