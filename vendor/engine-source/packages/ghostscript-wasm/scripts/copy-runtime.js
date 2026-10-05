/*
 * Copy the built WASM runtime assets into dist/runtime so the package is
 * self-contained. Run after tsc (npm run build).
 *
 * The classic worker at dist/runtime/ghostscript.worker.js importScripts
 * the glue and preset bundle from the same directory, so all four files
 * must be co-located.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const root = path.resolve(pkg, '..', '..');
const srcDir = path.join(root, 'dist');
const dstDir = path.join(pkg, 'dist', 'runtime');

const FILES = [
  'ghostscript.js',
  'ghostscript.wasm',
  'ghostscript.worker.js',
  'presets.js'
];

await rm(dstDir, { recursive: true, force: true });
await mkdir(dstDir, { recursive: true });

for (const f of FILES) {
  await cp(path.join(srcDir, f), path.join(dstDir, f));
}

console.log(`Copied ${FILES.join(', ')} from ${path.relative(pkg, srcDir)}/ to dist/runtime/`);