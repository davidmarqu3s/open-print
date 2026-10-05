/*
 * Package test: exercises the public API (dist/index.js) end to end.
 *
 * Requires the package to be built (`npm run build` in the package dir,
 * which runs tsc and copies the WASM runtime into dist/runtime) and the
 * root `dist/` to contain a freshly built engine.
 *
 * Usage: node test/package.test.js   (or: npm test in the package dir)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installNodeWorkerShim } from './node-shim.mjs';

installNodeWorkerShim();

const { compressPdf, dispose, PRESET_META, PRESET_NAMES, PRESETS } = await import(
  '../dist/index.js'
);

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const root = path.resolve(pkg, '..', '..');

let failures = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`✓ ${name}`),
      (err) => {
        failures++;
        console.error(`✗ ${name}: ${err.message}`);
      }
    );
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function run() {
  const simple = await fs.readFile(path.join(root, 'tests', 'input', 'simple.pdf'));

  // The public surface is exactly what consumers should see.
  assert(typeof compressPdf === 'function', 'compressPdf is exported');
  assert(typeof dispose === 'function', 'dispose is exported');
  assert(Array.isArray(PRESET_META) && PRESET_META.length === 3, 'PRESET_META has 3 presets');
  assert(PRESET_NAMES.includes('balanced'), 'PRESET_NAMES includes balanced');
  assert(typeof PRESETS.balanced.args.join === 'function', 'PRESETS exposes args');

  // Progress events flow through the worker -> client -> callback.
  const stages = [];
  const result = await compressPdf(simple, {
    preset: 'balanced',
    onProgress(event) {
      stages.push(event.stage);
    }
  });

  assert(result.bytes instanceof Uint8Array, 'result.bytes is a Uint8Array');
  assert(
    String.fromCharCode(result.bytes[0], result.bytes[1], result.bytes[2], result.bytes[3], result.bytes[4]) === '%PDF-',
    'result.bytes starts with %PDF-'
  );
  assert(result.originalSize === simple.length, 'originalSize matches the input');
  assert(result.compressedSize === result.bytes.length, 'compressedSize matches bytes length');
  assert(result.compressedSize < result.originalSize, 'output is smaller');
  assert(result.compressionRatio > 0 && result.compressionRatio <= 1, 'compressionRatio in (0,1]');
  assert(result.preset === 'balanced', 'result reports the preset used');
  assert(stages.includes('processing') && stages[stages.length - 1] === 'complete', 'progress stages reported');

  // Invalid preset is rejected without touching the worker.
  let presetRejected = false;
  try {
    await compressPdf(simple, { preset: 'garbage' });
  } catch (err) {
    presetRejected = err.code === 'INVALID_PRESET';
  }
  assert(presetRejected, 'unknown preset -> INVALID_PRESET');

  // A non-PDF payload is rejected by content before reaching Ghostscript.
  let pdfRejected = false;
  try {
    await compressPdf(new TextEncoder().encode('not a pdf').buffer, { preset: 'balanced' });
  } catch (err) {
    pdfRejected = err.code === 'INVALID_PDF';
  }
  assert(pdfRejected, 'non-PDF bytes -> INVALID_PDF');

  // dispose() is safe and the next call lazily recreates a worker.
  dispose();
  const again = await compressPdf(simple, { preset: 'extreme' });
  assert(again.compressedSize > 0, 'second compression works after dispose()');
  dispose();

  if (failures > 0) {
    console.error(`\n${failures} package test failure(s).`);
    process.exit(1);
  }
  console.log('\nAll package tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});