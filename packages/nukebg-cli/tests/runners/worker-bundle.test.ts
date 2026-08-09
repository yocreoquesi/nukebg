import { describe, it, expect, beforeAll } from 'vitest';
import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// The failure this exists to catch: the worker resolves as a sibling of the
// bundle (`new URL('./pipeline.worker.js', import.meta.url)`), which is a path
// that only exists after tsup runs. Every unit test injects a fake worker, so
// none of them would notice tsup dropping the second entry, the file landing
// under a different name, or the bundle failing to import its own modules —
// tests green, shipped CLI dead on first use.
//
// It deliberately does NOT skip when dist is missing. A skip-guarded test that
// quietly does nothing is how REQ-PARITY-1 ended up unverified for the whole
// extraction; this builds instead.

const pkgRoot = resolve(__dirname, '..', '..');
const workerPath = resolve(pkgRoot, 'dist', 'pipeline.worker.js');

beforeAll(() => {
  if (!existsSync(workerPath)) {
    execSync('npm run build -w nukebg-cli', {
      cwd: resolve(pkgRoot, '..', '..'),
      stdio: 'ignore',
    });
  }
}, 180_000);

describe('built pipeline worker', () => {
  it('is emitted by the build as a sibling of cli.js', () => {
    expect(existsSync(workerPath)).toBe(true);
    expect(existsSync(resolve(pkgRoot, 'dist', 'cli.js'))).toBe(true);
  });

  it('spawns and runs our code, not just loads', async () => {
    // A stage event proves runPipeline actually started inside the worker and
    // the message protocol crossed the boundary. Getting a result would need
    // the RMBG model, so this stops at the first proof of life — which is
    // exactly the thing a fake worker cannot give us.
    const first = await new Promise<{ kind: string; detail?: string | undefined }>((resolveP) => {
      const w = new Worker(workerPath, {
        workerData: {
          pixels: new Uint8ClampedArray(16 * 16 * 4).fill(128),
          width: 16,
          height: 16,
          options: { mode: 'photo', skipWatermark: true },
          noWatermark: true,
          cacheDir: resolve(tmpdir(), 'nukebg-worker-bundle-test'),
        },
      });

      const done = (v: { kind: string; detail?: string | undefined }): void => {
        void w.terminate();
        resolveP(v);
      };

      const timer = setTimeout(() => done({ kind: 'timeout' }), 45_000);

      w.on('message', (m: { kind: string; name?: string; message?: string }) => {
        clearTimeout(timer);
        done({ kind: m.kind, detail: m.name ?? m.message });
      });
      w.on('error', (e: Error) => {
        clearTimeout(timer);
        done({ kind: 'worker-error', detail: e.message });
      });
    });

    // 'stage' is the happy signal. An 'error' whose payload is a model failure
    // still proves the worker ran our code; a 'worker-error' means the bundle
    // itself is broken, which is the regression being guarded.
    expect(first.kind, `worker returned ${first.kind}: ${first.detail ?? ''}`).not.toBe(
      'worker-error',
    );
    expect(first.kind).not.toBe('timeout');
    expect(['stage', 'result', 'error']).toContain(first.kind);
  }, 60_000);
});
