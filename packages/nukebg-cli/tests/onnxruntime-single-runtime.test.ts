import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// nukebg-cli depends on onnxruntime-node twice over: directly, and transitively
// through @huggingface/transformers, which pins its own exact version. If those two
// resolve to different versions, npm installs both — one hoisted to the root
// node_modules, one nested under this package.
//
// Incident this guards against (Aug 9 2026): the direct dependency was `^1.24.0`
// (resolving to 1.27.0) while transformers pinned 1.21.0. On Linux the two copies
// collide over the shared soname `libonnxruntime.so.1`: the root napi-v3 binding
// loads the nested 1.27 library, which does not export `VERS_1.21.0`, and the CLI
// fails to load at all:
//
//   Error: .../libonnxruntime.so.1: version `VERS_1.21.0' not found
//     (required by .../onnxruntime_binding.node)
//
// macOS and Windows resolve shared libraries differently and never collided, so the
// three-OS CI matrix was green on two legs and red on one. Nothing reproduced it
// locally on Windows.
//
// Worth knowing if this ever needs re-fixing: editing the version spec was not
// enough. npm rewrote the spec but kept the stale nested resolution and reported
// "up to date"; `npm dedupe` was required to actually collapse the tree.
const repoRoot = resolve(__dirname, '..', '..', '..');

describe('onnxruntime-node resolves to a single copy', () => {
  const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  const copies = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith('node_modules/onnxruntime-node'),
  );

  it('the lockfile contains exactly one onnxruntime-node resolution', () => {
    const described = copies.map(([path, e]) => `${e.version} @ ${path}`);
    // Two copies means the specs drifted apart; the sibling assertion
    // below names which. Both are repaired by `npm run sync:onnx-pin`.
    expect(copies.length, `found:\n  ${described.join('\n  ')}`).toBe(1);
  });

  it('the direct dependency spec matches what transformers pins', () => {
    const cliPkg = JSON.parse(
      readFileSync(resolve(repoRoot, 'packages/nukebg-cli/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };

    const transformersPkg = JSON.parse(
      readFileSync(
        resolve(repoRoot, 'node_modules/@huggingface/transformers/package.json'),
        'utf8',
      ),
    ) as { dependencies?: Record<string, string> };

    const transformersPin = transformersPkg.dependencies?.['onnxruntime-node'];
    const direct = cliPkg.dependencies['onnxruntime-node'];

    // Both must name the same exact version. A range here re-opens the split:
    // npm will happily satisfy `^x` with a newer release than transformers pins.
    expect(direct).toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      direct,
      `nukebg-cli pins ${direct}, @huggingface/transformers pins ${transformersPin}.\n` +
        `Fix with: npm run sync:onnx-pin && npm install`,
    ).toBe(transformersPin);
  });
});
