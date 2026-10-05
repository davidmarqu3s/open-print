/*
 * Worker protocol test.
 *
 * Runs the REAL web worker file (worker/ghostscript.worker.js, as copied
 * to dist/) inside a Node worker_thread with a small shim that provides
 * `self`, `postMessage`, `importScripts` and message routing. This
 * verifies the message contract used by the browser:
 *
 *   compress {type, id, file: ArrayBuffer, options: {preset}}
 *     -> progress {type:'progress', id, stage, message}
 *     -> result  {type:'result', id, success, bytes, originalSize,
 *                 compressedSize, compressionRatio, processingTimeMs}
 *
 * Also verifies graceful rejection of bad inputs (empty file, unknown
 * preset, over-limit file) — the "reject unsupported sizes gracefully"
 * requirement.
 */

import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidPdf } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');

const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

globalThis.__dirname = workerData.dist;
globalThis.require = require;
globalThis.process = process;

globalThis.importScripts = function (...urls) {
  for (const url of urls) {
    const file = path.resolve(workerData.dist, url);
    (0, eval)(fs.readFileSync(file, 'utf8'));
  }
};

globalThis.self = {
  postMessage(msg) {
    parentPort.postMessage(msg);
  }
};

parentPort.on('message', (msg) => {
  if (typeof self.onmessage === 'function') {
    self.onmessage({ data: msg });
  }
});

(0, eval)(fs.readFileSync(path.resolve(workerData.dist, 'ghostscript.worker.js'), 'utf8'));
`;

const MAX_SAFE_INPUT_BYTES = 256 * 1024 * 1024;

function spawnWorker() {
  const w = new Worker(BOOTSTRAP, { eval: true, workerData: { dist: DIST } });
  const listeners = new Set();

  w.on('message', (msg) => {
    for (const l of listeners) l(msg);
  });
  w.on('error', (err) => {
    for (const l of listeners) l({ type: 'error', error: err.message || String(err) });
  });
  w.on('exit', (code) => {
    for (const l of listeners) l({ type: 'exit', code });
  });

  return {
    onMessage(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    post(msg) {
      w.postMessage(msg);
    },
    terminate() {
      w.terminate();
    }
  };
}

function waitForReady(worker, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ready')), timeoutMs);
    const off = worker.onMessage((msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timer);
        off();
        resolve();
      } else if (msg.type === 'error' || msg.type === 'exit') {
        clearTimeout(timer);
        off();
        reject(new Error(msg.error || `worker exited with code ${msg.code}`));
      }
    });
  });
}

function runJob(worker, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`job ${payload.id} timed out`)),
      timeoutMs
    );
    const stages = [];
    const off = worker.onMessage((msg) => {
      if (msg.type === 'progress' && msg.id === payload.id) {
        stages.push(msg.stage);
      } else if (msg.type === 'result' && msg.id === payload.id) {
        clearTimeout(timer);
        off();
        resolve({ result: msg, stages });
      } else if (msg.type === 'error' && msg.id === payload.id) {
        clearTimeout(timer);
        off();
        reject(new Error(msg.error));
      }
    });
    worker.post(payload);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let failures = 0;

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

async function run() {
  const worker = spawnWorker();
  const simple = await fs.readFile(path.join(INPUT_DIR, 'simple.pdf'));

  try {
    await waitForReady(worker);

    await check('compresses a valid PDF with balanced preset', async () => {
      const { result, stages } = await runJob(worker, {
        type: 'compress',
        id: 'job-balanced',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'balanced' }
      });

      assert(result.success === true, 'success should be true');
      assert(isValidPdf(result.bytes), 'bytes should be a valid PDF');
      assert(result.originalSize === simple.length, 'originalSize mismatch');
      assert(result.compressedSize === result.bytes.length, 'compressedSize mismatch');
      assert(
        result.compressionRatio >= 0 && result.compressionRatio <= 1,
        'compressionRatio should be in [0,1]'
      );
      assert(
        typeof result.processingTimeMs === 'number' && result.processingTimeMs >= 0,
        'processingTimeMs should be a non-negative number'
      );
      assert(stages.length > 0, 'should emit at least one progress stage');
      assert(stages[stages.length - 1] === 'complete', 'last stage should be "complete"');
    });

    await check('reports meaningful progress stages', async () => {
      const { stages } = await runJob(worker, {
        type: 'compress',
        id: 'job-stages',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'extreme' }
      });

      const known = ['loading', 'initializing', 'writing-input', 'processing', 'reading-output', 'complete'];
      for (const s of stages) {
        assert(known.includes(s), `unexpected stage "${s}"`);
      }
      assert(stages.includes('processing'), 'should include processing stage');
    });

    await check('rejects an unknown preset gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-badpreset',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'garbage-preset' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PRESET', 'code should be INVALID_PRESET');
    });

    await check('rejects an empty file gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-empty',
        file: new ArrayBuffer(0),
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'EMPTY_FILE', 'code should be EMPTY_FILE');
    });

    await check('rejects an over-limit file gracefully', async () => {
      const big = new ArrayBuffer(MAX_SAFE_INPUT_BYTES + 1);
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-toobig',
        file: big,
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'FILE_TOO_LARGE', 'code should be FILE_TOO_LARGE');
    });

    await check('handles a non-ArrayBuffer payload gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-invalid',
        file: 'not-a-buffer',
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_FILE', 'code should be INVALID_FILE');
    });

    await check('rejects a non-PDF payload by content (missing %PDF- header)', async () => {
      const garbage = new TextEncoder().encode('this is not a pdf at all').buffer;
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-notpdf',
        file: garbage,
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PDF', 'code should be INVALID_PDF');
    });

    await check('processes three sequential jobs without leftover temp files', async () => {
      for (let i = 0; i < 3; i++) {
        const { result } = await runJob(worker, {
          type: 'compress',
          id: `job-seq-${i}`,
          file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
          options: { preset: ['extreme', 'balanced', 'highQuality'][i % 3] }
        });

        assert(result.success === true, `job ${i} should succeed`);
        assert(isValidPdf(result.bytes), `job ${i} should produce a valid PDF`);
      }
    });

    await check('merges multiple PDFs into one valid PDF', async () => {
      const toArrayBuffer = (buf) =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));

      const { result, stages } = await runJob(worker, {
        type: 'merge',
        id: 'job-merge',
        files: [toArrayBuffer(simple), toArrayBuffer(images)],
        options: {}
      });

      assert(result.success === true, 'success should be true');
      assert(isValidPdf(result.bytes), 'bytes should be a valid PDF');
      assert(result.fileCount === 2, 'fileCount should be 2');
      assert(
        result.originalSize === simple.length + images.length,
        'originalSize should be the sum of the inputs'
      );
      assert(result.compressedSize === result.bytes.length, 'compressedSize mismatch');
      assert(
        typeof result.processingTimeMs === 'number' && result.processingTimeMs >= 0,
        'processingTimeMs should be a non-negative number'
      );
      assert(stages.includes('processing'), 'should include processing stage');
      assert(stages[stages.length - 1] === 'complete', 'last stage should be "complete"');
    });

    await check('rejects a merge with fewer than two files gracefully', async () => {
      const toArrayBuffer = (buf) =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

      const { result } = await runJob(worker, {
        type: 'merge',
        id: 'job-merge-one',
        files: [toArrayBuffer(simple)],
        options: {}
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_FILE', 'code should be INVALID_FILE');
    });

    await check('rejects a merge containing a non-PDF file gracefully', async () => {
      const garbage = new TextEncoder().encode('this is not a pdf at all').buffer;

      const { result } = await runJob(worker, {
        type: 'merge',
        id: 'job-merge-notpdf',
        files: [toArrayBuffer(simple), garbage],
        options: {}
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PDF', 'code should be INVALID_PDF');
    });

    await check('merges PDFs onto a fixed page size (A4 + fit)', async () => {
      const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));

      const { result } = await runJob(worker, {
        type: 'merge',
        id: 'job-merge-a4',
        files: [toArrayBuffer(simple), toArrayBuffer(images)],
        options: { pageSize: 'a4', fit: true }
      });

      assert(result.success === true, 'success should be true');
      assert(isValidPdf(result.bytes), 'bytes should be a valid PDF');
      assert(result.fileCount === 2, 'fileCount should be 2');
    });

    await check('rejects a merge with an unknown page size gracefully', async () => {
      const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));

      const { result } = await runJob(worker, {
        type: 'merge',
        id: 'job-merge-badps',
        files: [toArrayBuffer(simple), toArrayBuffer(images)],
        options: { pageSize: 'tall', fit: true }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PAGE_SIZE', 'code should be INVALID_PAGE_SIZE');
    });

    await check('renders a PDF to PNG images', async () => {
      const { result } = await runJob(worker, {
        type: 'toImages',
        id: 'job-toimages',
        file: toArrayBuffer(simple),
        options: { format: 'png', dpi: 150 }
      });

      assert(result.success === true, 'success should be true');
      assert(result.count === 1, 'expected 1 image');
      assert(Array.isArray(result.images) && result.images.length === 1, 'images array');
      assert(result.images[0].name.endsWith('.png'), 'image filename should end in .png');
      const png = result.images[0].bytes;
      assert(
        String.fromCharCode(png[0], png[1], png[2], png[3]) === '\x89PNG',
        'output should be a PNG (magic bytes)'
      );
      assert(
        typeof result.processingTimeMs === 'number' && result.processingTimeMs >= 0,
        'processingTimeMs should be a non-negative number'
      );
    });

    await check('rejects PDF -> image with an unknown dpi gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'toImages',
        id: 'job-baddpi',
        file: toArrayBuffer(simple),
        options: { format: 'png', dpi: 999 }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_DPI', 'code should be INVALID_DPI');
    });

    await check('rejects PDF -> image with an unknown format gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'toImages',
        id: 'job-badfmt',
        file: toArrayBuffer(simple),
        options: { format: 'gif', dpi: 150 }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_FORMAT', 'code should be INVALID_FORMAT');
    });

    await check('converts a JPEG image to a PDF', async () => {
      // Produce a real JPEG via the worker (render simple.pdf page 1).
      const jpegJob = await runJob(worker, {
        type: 'toImages',
        id: 'job-jpeg-src',
        file: toArrayBuffer(simple),
        options: { format: 'jpeg', dpi: 150 }
      });
      assert(jpegJob.result.success === true && jpegJob.result.count === 1, 'jpeg source');
      const jpeg = jpegJob.result.images[0].bytes;

      const { result, stages } = await runJob(worker, {
        type: 'imagesToPdf',
        id: 'job-img2pdf',
        images: [toArrayBuffer(jpeg)],
        options: { pageSize: 'a4', fit: true }
      });

      assert(result.success === true, 'success should be true');
      assert(isValidPdf(result.bytes), 'bytes should be a valid PDF');
      assert(result.fileCount === 1, 'fileCount should be 1');
      assert(stages.includes('processing'), 'should include a processing stage');
      assert(stages[stages.length - 1] === 'complete', 'last stage should be "complete"');
    });

    await check('rejects imagesToPdf with no images gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'imagesToPdf',
        id: 'job-img2pdf-empty',
        images: [],
        options: {}
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_FILE', 'code should be INVALID_FILE');
    });

    await check('rejects imagesToPdf with an unknown page size gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'imagesToPdf',
        id: 'job-img2pdf-badps',
        images: [toArrayBuffer(simple)],
        options: { pageSize: 'postcard' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PAGE_SIZE', 'code should be INVALID_PAGE_SIZE');
    });

    await check('converts an image to PDF and merges it with another PDF', async () => {
      const jpegJob = await runJob(worker, {
        type: 'toImages',
        id: 'job-mix-src',
        file: toArrayBuffer(simple),
        options: { format: 'jpeg', dpi: 150 }
      });
      assert(jpegJob.result.success === true && jpegJob.result.count === 1, 'jpeg source');
      const jpeg = jpegJob.result.images[0].bytes;

      const imgPdfJob = await runJob(worker, {
        type: 'imagesToPdf',
        id: 'job-mix-imgpdf',
        images: [toArrayBuffer(jpeg)],
        options: { pageSize: 'a4', fit: true }
      });
      assert(imgPdfJob.result.success === true, 'imagesToPdf should succeed');

      const mergeJob = await runJob(worker, {
        type: 'merge',
        id: 'job-mix-merge',
        files: [toArrayBuffer(simple), imgPdfJob.result.bytes.buffer],
        options: {}
      });

      assert(mergeJob.result.success === true, 'merge should succeed');
      assert(isValidPdf(mergeJob.result.bytes), 'output should be a valid merged PDF');
      assert(mergeJob.result.fileCount === 2, 'should contain 2 merged files');
    });

    await check('splits a PDF into individual pages (ZIP parts)', async () => {
      const toBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));
      const { result: merged } = await runJob(worker, {
        type: 'merge',
        id: 'job-split-src',
        files: [toBuf(simple), toBuf(images)],
        options: {}
      });
      assert(merged.success === true, 'merge for split source should succeed');
      const { result } = await runJob(worker, {
        type: 'split',
        id: 'job-split-ind',
        file: merged.bytes.buffer.slice(merged.bytes.byteOffset, merged.bytes.byteOffset + merged.bytes.byteLength),
        options: { mode: 'individual' }
      });
      assert(result.success === true, 'split individual should succeed');
      assert(Array.isArray(result.parts) && result.parts.length >= 2, 'should return >=2 parts');
      for (const p of result.parts) {
        assert(isValidPdf(p.bytes), `part ${p.name} should be a valid PDF`);
        assert(p.name.startsWith('page-') && p.name.endsWith('.pdf'), 'part name shape');
      }
      assert(result.count === result.parts.length, 'count should match parts length');
    });

    await check('extracts a page range into a single PDF', async () => {
      const toBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));
      const { result: merged } = await runJob(worker, {
        type: 'merge',
        id: 'job-extract-src',
        files: [toBuf(simple), toBuf(images)],
        options: {}
      });
      assert(merged.success === true, 'merge for extract source should succeed');
      const { result } = await runJob(worker, {
        type: 'split',
        id: 'job-split-extract',
        file: merged.bytes.buffer.slice(merged.bytes.byteOffset, merged.bytes.byteOffset + merged.bytes.byteLength),
        options: { mode: 'extract', pages: '1' }
      });
      assert(result.success === true, 'extract should succeed');
      assert(isValidPdf(result.bytes), 'extracted bytes should be a valid PDF');
      assert(result.count === 1, 'extract count should be 1');
    });

    await check('rejects split with unknown mode gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'split',
        id: 'job-split-badmode',
        file: toArrayBuffer(simple),
        options: { mode: 'garbage' }
      });
      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_SPLIT_MODE', 'code should be INVALID_SPLIT_MODE');
    });

    await check('rejects split extract with invalid page range gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'split',
        id: 'job-split-badrange',
        file: toArrayBuffer(simple),
        options: { mode: 'extract', pages: 'abc' }
      });
      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PAGE_RANGE', 'code should be INVALID_PAGE_RANGE');
    });

    await check('rejects split with non-PDF file gracefully', async () => {
      const garbage = new TextEncoder().encode('not a pdf').buffer;
      const { result } = await runJob(worker, {
        type: 'split',
        id: 'job-split-notpdf',
        file: garbage,
        options: { mode: 'individual' }
      });
      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PDF', 'code should be INVALID_PDF');
    });
  } finally {
    worker.terminate();
  }

  if (failures > 0) {
    console.error(`\n${failures} worker test failure(s).`);
    process.exit(1);
  }

  console.log('\nAll worker protocol tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});