import { test, expect, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * An eraser stroke in the advanced editor reaches the exported image (#387).
 *
 * The unit suite in tests/components/ar-editor-advanced-drawing.test.ts pins
 * the ordered sequence of canvas operations a stroke produces. That is enough
 * to refactor the painting safely — it caught seven mutations and held through
 * the extraction in #395 — but it cannot prove those calls paint anything. The
 * canvas is fully mocked there: `getContext` returns a recording stub and
 * `getImageData` returns `new ImageData(1, 1)`. Every assertion in that file
 * would pass against a canvas that renders nothing at all.
 *
 * WHAT THIS ASSERTS, AND WHY NOT THE OBVIOUS THING
 *
 * The obvious test is: sample the editor canvas, drag, sample again, expect a
 * difference. That was the first version of this file, and it passed with the
 * painting entirely disabled.
 *
 * `redrawDisplay()` also paints the cursor preview — the dashed brush outline
 * tracking the pointer — onto the same canvas. So moving the mouse changes
 * those pixels whether or not the stroke painted anything. The test measured
 * "did the canvas change" when the question was "did the user's edit change".
 * Only mutation-testing it revealed that: it looked correct and would have
 * cost 20 seconds of CI per run to assert nothing.
 *
 * So this measures the artefact instead: erase across the subject, commit, and
 * check the exported PNG has meaningfully less subject left in it. That covers
 * the whole chain — stroke, working canvas, commit, re-export — has no cursor
 * preview anywhere in it, and needs no screenshot baseline. See
 * refresh-visual-baselines.yml for why those are worth avoiding: per-platform,
 * Linux-only regeneration, and silently stale when nobody refreshes them.
 *
 * The second version compared a hash of the exported bytes, and was also
 * vacuous: the first export comes from the pipeline and the second from the
 * editor's commit, so the encoded bytes differ even with nothing edited. Three
 * versions of this file, two of them asserting nothing, and the only thing
 * that told them apart was disabling the painting and re-running.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/fiat-clean.png');

/**
 * Decode the PNG the download button points at, and count how much subject
 * survives in it.
 *
 * Opaque-pixel count rather than a hash of the bytes: the first export comes
 * from the pipeline and the second from the editor's commit, so the encoded
 * bytes differ even when nothing was edited. Measured, with the painting
 * disabled: 147932 bytes before, 146828 after — a byte comparison "passes"
 * on that alone. The pixel count does not move (54165 -> 54546, +0.7%).
 */
async function exportedSubject(page: Page): Promise<{ w: number; h: number; opaque: number }> {
  return page.evaluate(async () => {
    const dl = document.querySelector('ar-app')!.shadowRoot!.querySelector('ar-download')!;
    const a = dl.shadowRoot!.querySelector('#dl-png') as HTMLAnchorElement;
    const bitmap = await createImageBitmap(await (await fetch(a.href)).blob());
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opaque++;
    return { w: bitmap.width, h: bitmap.height, opaque };
  });
}

/** Resolves once the download button exposes a blob URL — "pipeline done". */
async function waitForExport(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const dl = document.querySelector('ar-app')?.shadowRoot?.querySelector('ar-download');
      const a = dl?.shadowRoot?.querySelector('#dl-png') as HTMLAnchorElement | null;
      return !!a?.href?.startsWith('blob:');
    },
    { timeout },
  );
}

test.describe('advanced editor — strokes reach the exported image (#387)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Needs a full pipeline run first; same Chromium-only constraint as pipeline.spec.ts',
  );

  test('erasing part of the subject changes the PNG the user downloads', async ({ page }) => {
    // Cold model download dominates: same budget as the pipeline spec.
    test.setTimeout(240_000);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('ar-dropzone').locator('input[type="file"]').setInputFiles(FIXTURE);
    await waitForExport(page, 200_000);

    const before = await exportedSubject(page);

    await page.locator('ar-app').locator('#advanced-cta').click();
    const canvas = page.locator('ar-editor-advanced').locator('canvas');
    await expect(canvas).toBeVisible();

    // page.mouse works in viewport coordinates and does NOT scroll, unlike
    // locator.click(). The editor sits well below the fold — its canvas was at
    // y=765 in a 720-tall viewport on the first run of this test, so the drag
    // dispatched into empty space and failed against the app rather than
    // against a bug.
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box, 'editor canvas has no layout box').not.toBeNull();
    const { x, y, width, height } = box!;
    const viewport = page.viewportSize()!;
    expect(y + height, 'canvas is below the fold; page.mouse would miss it').toBeLessThanOrEqual(
      viewport.height,
    );

    // Erasing transparent background is a no-op, so the stroke has to cross
    // the subject. Find it rather than assume where it is: scan for the widest
    // opaque run and drag along that row.
    const subject = await canvas.evaluate((el: HTMLCanvasElement) => {
      const { data } = el.getContext('2d')!.getImageData(0, 0, el.width, el.height);
      let best = { row: 0, from: 0, to: 0 };
      for (let row = 0; row < el.height; row += 4) {
        let from = -1;
        for (let col = 0; col <= el.width; col++) {
          const opaque = col < el.width && data[(row * el.width + col) * 4 + 3] > 200;
          if (opaque && from === -1) from = col;
          if (!opaque && from !== -1) {
            if (col - from > best.to - best.from) best = { row, from, to: col };
            from = -1;
          }
        }
      }
      return { ...best, w: el.width, h: el.height };
    });
    expect(
      subject.to - subject.from,
      'no opaque run found — the fixture produced an empty cutout',
    ).toBeGreaterThan(40);

    // Canvas coordinates back to viewport coordinates.
    const span = subject.to - subject.from;
    const toClientX = (col: number) => x + (col / subject.w) * width;
    const clientY = y + (subject.row / subject.h) * height;

    await page.mouse.move(toClientX(subject.from + span * 0.2), clientY);
    await page.mouse.down();
    await page.mouse.move(toClientX(subject.from + span * 0.8), clientY, { steps: 12 });
    await page.mouse.up();

    // Commit, then wait for the app to re-export.
    await page.locator('ar-editor-advanced').locator('#done').click();
    await waitForExport(page, 60_000);

    const after = await expect
      .poll(() => exportedSubject(page).then((s) => s.opaque), {
        timeout: 30_000,
        message: 'the exported PNG still has all its subject — the erase never reached it',
      })
      .toBeLessThan(before.opaque * 0.95)
      .then(() => exportedSubject(page));

    // Same canvas, so the counts are comparable rather than a crop artefact.
    expect({ w: after.w, h: after.h }).toEqual({ w: before.w, h: before.h });

    // The 0.95 is not arbitrary. Measured on this fixture: a working erase
    // takes 54165 opaque pixels to 41861 (-22.7%); with the painting disabled
    // the same run lands on 54546 (+0.7%), because committing round-trips the
    // image through refine and nudges a few edge pixels either way. Anything
    // between those two separates them; 5% sits well clear of the noise
    // without pinning the test to one fixture's exact geometry.

    expect(errors, 'page errors during the edit').toEqual([]);
  });
});
