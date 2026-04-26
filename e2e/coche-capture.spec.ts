import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../tests/fixtures/coche.jpg');
const OUT_DIR = resolve(__dirname, '../.halo-check');

test.describe.configure({ mode: 'serial' });

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
  await expect(downloadBtn).toHaveAttribute('href', /^blob:/, { timeout: 200_000 });

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
