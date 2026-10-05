/*
 * Sample compression for CI: compress one PDF through the real worker
 * pipeline (worker protocol -> WASM -> pdfwrite) and report the result.
 *
 * Usage: node scripts/sample-compress.js [input.pdf] [preset]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { isValidPdf } from '../tests/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const inputPath = process.argv[2] || path.join(ROOT, 'tests', 'input', 'simple.pdf');
const preset = process.argv[3] || 'balanced';

const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
globalThis.__dirname = workerData.dist;
globalThis.require = require;
globalThis.importScripts = function (...urls) {
  for (const url of urls) {
    (0, eval)(fs.readFileSync(path.resolve(workerData.dist, url), 'utf8'));
  }
};
globalThis.self = { postMessage: (m) => parentPort.postMessage(m) };
parentPort.on('message', (m) => self.onmessage && self.onmessage({ data: m }));
(0, eval)(fs.readFileSync(path.resolve(workerData.dist, 'ghostscript.worker.js'), 'utf8'));
`;

async function main() {
  const inputBytes = await fs.readFile(inputPath);
  const worker = new Worker(BOOTSTRAP, { eval: true, workerData: { dist: DIST } });

  const result = await new Promise((resolve, reject) => {
    const id = 'sample';
    worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        worker.postMessage({
          type: 'compress',
          id,
          file: inputBytes.buffer.slice(0),
          options: { preset }
        });
      } else if (msg.type === 'result' && msg.id === id) {
        resolve(msg);
      }
    });
    worker.on('error', (err) => reject(err));
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });

  worker.terminate();

  if (!result.success) {
    console.error(`Sample compression FAILED: [${result.code}] ${result.error}`);
    process.exit(1);
  }
  if (!isValidPdf(result.bytes)) {
    console.error('Sample compression FAILED: output is not a valid PDF');
    process.exit(1);
  }

  console.log(
    `Sample compression OK: ${path.basename(inputPath)} @ ${preset} ` +
    `${result.originalSize} -> ${result.compressedSize} bytes ` +
    `(${(result.compressionRatio * 100).toFixed(1)}% saved, ${result.processingTimeMs} ms)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});