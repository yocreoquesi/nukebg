#!/usr/bin/env node
/**
 * Keep nukebg-cli's onnxruntime-node pin equal to whatever
 * @huggingface/transformers pins.
 *
 * The two depend on the same native library and share its soname. If the
 * specs disagree npm installs both copies, they collide at load time, and
 * the CLI stops working:
 *
 *   libonnxruntime.so.1: version `VERS_1.21.0' not found
 *
 * That has happened twice — Aug 9 2026, and again via #339, which reached
 * main and sat there for a week. onnxruntime-node is now ignored in
 * dependabot.yml, so the only thing that legitimately moves this pin is
 * transformers itself. When it moves, run this.
 *
 *   node scripts/sync-onnx-pin.mjs           write the pin
 *   node scripts/sync-onnx-pin.mjs --check   report drift, exit 1
 *
 * The invariant is also asserted by
 * packages/nukebg-cli/tests/onnxruntime-single-runtime.test.ts, which is
 * what fails in CI. This script is the fix for that failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PKG = resolve(root, 'packages/nukebg-cli/package.json');
const TRANSFORMERS_PKG = resolve(root, 'node_modules/@huggingface/transformers/package.json');

const check = process.argv.includes('--check');

/** Read a package.json, failing with a useful message rather than a stack. */
function read(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`Could not read ${what} at ${path}`);
    if (path === TRANSFORMERS_PKG) console.error('Run `npm install` first.');
    process.exit(1);
  }
}

const transformers = read(TRANSFORMERS_PKG, '@huggingface/transformers');
const wanted = transformers.dependencies?.['onnxruntime-node'];

if (!wanted) {
  console.error('@huggingface/transformers no longer depends on onnxruntime-node.');
  console.error('The constraint this script exists for may be gone — see #360.');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(wanted)) {
  // A range upstream would mean npm could satisfy it with something newer
  // than the copy actually installed, which reopens the split.
  console.error(`transformers pins a range (${wanted}), not an exact version.`);
  console.error('Resolve by hand and update #360 — the assumption behind this script broke.');
  process.exit(1);
}

const cli = read(CLI_PKG, 'nukebg-cli');
const current = cli.dependencies?.['onnxruntime-node'];

if (current === wanted) {
  console.log(`onnxruntime-node pin is already ${wanted}.`);
  process.exit(0);
}

if (check) {
  console.error(
    `onnxruntime-node pin drift: nukebg-cli has ${current}, transformers pins ${wanted}.`,
  );
  console.error('Run `npm run sync:onnx-pin` and commit the result, including the lockfile.');
  process.exit(1);
}

cli.dependencies['onnxruntime-node'] = wanted;
// Preserve the file's trailing newline; npm writes package.json that way.
writeFileSync(CLI_PKG, `${JSON.stringify(cli, null, 2)}\n`);
console.log(`onnxruntime-node pin ${current} -> ${wanted}`);
console.log('Now run `npm install` and commit package-lock.json alongside this change.');
