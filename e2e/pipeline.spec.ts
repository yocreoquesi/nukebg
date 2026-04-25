import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end pipeline tests for NukeBG.
 *
 * Drops a real image on the shadow-DOM file input, waits for the RMBG-1.4
 * model to load from the HuggingFace CDN, waits for segmentation to finish,
 * and verifies the download bar exposes a usable blob URL.
 *
 * This is the gate for upgrading transformers.js + onnxruntime-web — it
 * validates the full stack, not just "page loads". Chromium only: the dev
 * build of onnxruntime-web is not guaranteed stable on WebKit, and iOS
 * Safari has a separate warmup hang that's tracked elsewhere.
 *
 * Model download on a cold run can take 30-90s. Keep the timeout generous
 * but fail hard if the pipeline stalls past the budget.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/fiat-clean.png');

test.describe('pipeline end-to-end', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Pipeline e2e runs on Chromium only (WebKit + iOS tracked separately)',
  );

  test('processes an image end-to-end and exposes a download blob URL', async ({ page }) => {
    test.setTimeout(180_000);

    const warmupLogs: string[] = [];
    const errors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[NukeBG/warmup]')) warmupLogs.push(text);
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // ar-dropzone exposes two hidden <input type="file"> elements (regular +
    // mobile camera CTA). Disambiguate with :not(.dz-camera-input) — same
    // selector the component itself uses internally.
    const fileInput = page.locator('ar-dropzone').locator('input[type="file"]:not(.dz-camera-input)');
    await fileInput.setInputFiles(FIXTURE);

    // ar-download makes its #dl-png href a blob: URL only after the pipeline
    // finishes and exportPng resolves. That's the single source of truth for
    // "pipeline done".
    const downloadBtn = page.locator('ar-download').locator('#dl-png');
    await expect(downloadBtn).toHaveAttribute('href', /^blob:/, { timeout: 150_000 });
    await expect(downloadBtn).toHaveAttribute('download', /\.png$/);

    // Warmup must have fired — this catches regressions where the ML worker
    // boot path silently breaks (e.g. onnxruntime init errors swallowed).
    expect(warmupLogs.length, `expected at least one warmup log, got ${warmupLogs.length}`).toBeGreaterThan(0);
    expect(warmupLogs.some((line) => line.includes(' ok '))).toBe(true);

    // No uncaught page errors during the full run.
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
