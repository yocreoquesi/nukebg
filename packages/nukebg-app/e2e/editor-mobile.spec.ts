import { test, chromium, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The advanced editor is usable with a thumb (#154).
 *
 * Two of that issue's acceptance criteria, checked against the rendered
 * layout rather than the stylesheet — the stylesheet cannot tell you that a
 * range input's 44px box still presents a 16px track, or that a rule was
 * written but overridden.
 *
 * WHY A REAL VIEWPORT AND NOT A SOURCE ASSERTION
 *
 * `min-height: 44px` on a rule proves nothing about the element. The size
 * slider carried a perfectly good box and a 16px thumb; the five background
 * swatches were 22×22 because a `width`/`height` pair further up won. Only
 * measuring the boxes catches either.
 *
 * WHY CHROMIUM WITH A PHONE VIEWPORT RATHER THAN THE `iphone` PROJECT
 *
 * The iphone project is WebKit, where the ML pipeline is skipped — see
 * pipeline.spec.ts. The editor needs a processed image to open at all, so
 * this emulates the viewport and `hasTouch` on Chromium instead. That is
 * enough: everything under test is gated on `@media (pointer: coarse)`,
 * which `hasTouch` triggers.
 *
 * A NOTE ON MEASURING TOO EARLY
 *
 * The app scroll-into-views the editor when it opens. Measuring before that
 * settles reports the canvas ~1000px below the fold and the layout as
 * broken. It is not — after the scroll everything fits in 852px with room
 * to spare. Hence the settle wait below; without it this file would have
 * been a bug report about a bug that does not exist.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/fiat-clean.png');

/** WCAG 2.5.5 target size (enhanced), and the floor #154 asks for. */
const MIN_TAP = 44;

test.describe('advanced editor on a phone (#154)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'needs the ML pipeline');

  test('every control is thumb-sized and the dock does not overflow', async () => {
    test.setTimeout(300_000);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, // iPhone 15 Pro, CSS px
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();

    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
    await page.locator('ar-dropzone').locator('input[type="file"]').setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => {
        const dl = document.querySelector('ar-app')?.shadowRoot?.querySelector('ar-download');
        const a = dl?.shadowRoot?.querySelector('#dl-png') as HTMLAnchorElement | null;
        return !!a?.href?.startsWith('blob:');
      },
      { timeout: 200_000 },
    );

    await page.locator('ar-app').locator('#advanced-cta').click();
    await page.locator('ar-editor-advanced').locator('canvas').waitFor();
    await page.waitForTimeout(1500);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );

    const audit = await page.evaluate((floor) => {
      const root = document
        .querySelector('ar-app')!
        .shadowRoot!.querySelector('ar-editor-advanced')!.shadowRoot!;

      const tooSmall: string[] = [];
      let measured = 0;
      root.querySelectorAll('button, input[type="range"], .bg-btn').forEach((node) => {
        const el = node as HTMLElement;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // not rendered in this state
        measured++;
        if (r.height < floor || r.width < floor) {
          tooSmall.push(`${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });

      const rail = root.querySelector('.editor-rail') as HTMLElement | null;
      return {
        measured,
        tooSmall,
        railOverflows: rail ? rail.scrollWidth > rail.clientWidth + 1 : null,
      };
    }, MIN_TAP);

    // Guards the guard: if the selector stops matching, everything below
    // passes trivially.
    expect(audit.measured, 'measured no controls — did the editor fail to open?').toBeGreaterThan(
      10,
    );

    expect(audit.tooSmall, `controls below the ${MIN_TAP}px tap floor`).toEqual([]);
    expect(audit.railOverflows, 'the bottom dock scrolls horizontally').toBe(false);

    await browser.close();
  });
});
