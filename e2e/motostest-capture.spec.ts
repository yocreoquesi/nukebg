import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/motostest.jpeg');
const OUT_DIR = resolve(__dirname, '../.halo-check');

test.describe.configure({ mode: 'serial' });

test('capture motostest output for halo comparison', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const env = baseURL?.includes('pages.dev') ? 'dev' : 'prod';

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const fileInput = page.locator('ar-dropzone').locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);

  const downloadBtn = page.locator('ar-download').locator('#download-btn');
  await expect(downloadBtn).toHaveAttribute('href', /^blob:/, { timeout: 150_000 });

  // Click the anchor and capture the download via Playwright's download API
  const outPath = resolve(OUT_DIR, `motostest-${env}.png`);
  const downloadPromise = page.waitForEvent('download');
  await downloadBtn.click();
  const download = await downloadPromise;
  await download.saveAs(outPath);
  testInfo.annotations.push({ type: 'output', description: outPath });
  console.log(`[capture] wrote ${outPath}`);
});
