import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/coche.jpg');
const OUT_DIR = resolve(__dirname, '../.halo-check');

test.describe.configure({ mode: 'serial' });

// File renamed `z-coche-capture` so Playwright's alphabetical scheduling
// puts it LAST in the pipeline e2e suite (#160). The smaller-fixture
// specs (football 11 KB, motostest 565 KB) now absorb the cold-start ML
// warmup; coche runs warm in well under a minute. 240s budget = 4x slack
// vs typical warm runs.
test('capture coche output + mirror console/network', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const fileInput = page.locator('ar-dropzone').locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);

  const downloadBtn = page.locator('ar-download').locator('#dl-png');
  await expect(downloadBtn).toHaveAttribute('href', /^blob:/, { timeout: 180_000 });

  const outPath = resolve(OUT_DIR, `coche.png`);
  const downloadPromise = page.waitForEvent('download');
  await downloadBtn.click();
  const download = await downloadPromise;
  await download.saveAs(outPath);
  testInfo.annotations.push({ type: 'output', description: outPath });
  console.log(`[capture] coche -> ${outPath}`);
  console.log('--- app logs ---');
  for (const l of logs) console.log(l);
});
