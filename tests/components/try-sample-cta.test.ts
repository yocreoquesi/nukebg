import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source invariants for the "try a sample" CTA in ar-dropzone: renders
 * the button, locks it while generating, feeds the synthetic File into
 * the normal handleFile pipeline, and surfaces the sample on error.
 */

const ROOT = resolve(__dirname, '..', '..');
const DZ = readFileSync(resolve(ROOT, 'src/components/ar-dropzone.ts'), 'utf8');
const DEMO = readFileSync(resolve(ROOT, 'src/utils/demo-image.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('ar-dropzone — "try a sample" CTA', () => {
  it('renders a #dz-sample-cta button using the dropzone.trySample i18n key', () => {
    expect(DZ).toMatch(/<button[^>]*class="dz-sample-cta"[^>]*id="dz-sample-cta"/);
    expect(DZ).toMatch(/t\(['"]dropzone\.trySample['"]\)/);
  });

  it('relocalizes the sample button when the locale changes', () => {
    expect(DZ).toMatch(/querySelector\(['"]#dz-sample-cta['"]\)/);
  });

  it('click handler stops propagation, locks the button, calls generateDemoFile + handleFile', () => {
    expect(DZ).toMatch(/import \{ generateDemoFile \} from ['"]\.\.\/utils\/demo-image['"]/);
    expect(DZ).toMatch(/sampleBtn\?\.addEventListener\(['"]click['"]/);
    expect(DZ).toMatch(/e\.stopPropagation\(\)/);
    expect(DZ).toMatch(/sampleBtn\.disabled = true/);
    expect(DZ).toMatch(/await generateDemoFile\(\)/);
    expect(DZ).toMatch(/await this\.handleFile\(file\)/);
    expect(DZ).toMatch(/sampleBtn\.disabled = false/);
  });

  it('container click + keyboard handlers skip propagation from the sample CTA', () => {
    expect(DZ).toMatch(/target\?\.closest\(['"]#dz-sample-cta['"]\)/);
  });

  it('error path shows the dropzone.sampleError translation', () => {
    expect(DZ).toMatch(/t\(['"]dropzone\.sampleError['"]\)/);
  });
});

describe('demo-image.ts — synthetic PNG generator', () => {
  it('exports an async generateDemoFile returning a File', () => {
    expect(DEMO).toMatch(/export async function generateDemoFile\(\): Promise<File>/);
    expect(DEMO).toMatch(/new File\(\[blob\], ['"]nukebg-demo\.png['"]/);
    expect(DEMO).toMatch(/type: ['"]image\/png['"]/);
  });

  it('paints a separable subject on a grey gradient (easy nuke for first-time visitors)', () => {
    expect(DEMO).toMatch(/createRadialGradient/);
    expect(DEMO).toMatch(/#00ff41/);
    expect(DEMO).toMatch(/NUKEBG DEMO/);
  });
});

describe('i18n — dropzone.trySample / dropzone.sampleError', () => {
  it('ships translations for all six locales', () => {
    const tryCount = (I18N.match(/'dropzone\.trySample':/g) || []).length;
    const errCount = (I18N.match(/'dropzone\.sampleError':/g) || []).length;
    expect(tryCount).toBe(6);
    expect(errCount).toBe(6);
  });
});
