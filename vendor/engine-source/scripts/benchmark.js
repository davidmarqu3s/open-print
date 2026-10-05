/*
 * Benchmark: measure the three presets against the test PDFs.
 *
 * For each input x preset it records:
 *   - original size, compressed size, compression percentage
 *   - processing time
 *   - WASM heap size after the job + Node RSS delta
 *   - visual quality proxy: renders page 1 (150 DPI, PNG) of the original
 *     and of the compressed PDF; a larger render usually means more
 *     detail was preserved.
 *
 * Usage: node scripts/benchmark.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModule, getPresets, compressBytes, isValidPdf, countPages } from '../tests/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');
const OUT_DIR = path.join(ROOT, 'tests', 'output', 'benchmark');

const INPUTS = ['simple.pdf', 'images.pdf', 'large.pdf'];
const RENDER_DPI = 150;

function fmtBytes(n) {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(2)} MB`
    : `${(n / 1024).toFixed(1)} KB`;
}

/** Render the first page to PNG via Ghostscript (dev-only helper). */
async function renderPage1(module, inputBytes) {
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/render-${jobId}`;
  const inPath = `${workDir}/in.pdf`;
  const pngPath = `${workDir}/page1.png`;
  const FS = module.FS;

  try {
    FS.mkdirTree(workDir);
    FS.writeFile(inPath, inputBytes);

    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
    const args = [
      '-dNOPAUSE',
      '-dBATCH',
      '-sDEVICE=png16m',
      `-r${RENDER_DPI}`,
      '-dFirstPage=1',
      '-dLastPage=1'
    ].join('\n');

    const code = run(inPath, pngPath, args);
    if (code !== 0) return null;
    return FS.readFile(pngPath);
  } finally {
    try { FS.unlink(inPath); } catch (e) { /* ignore */ }
    try { FS.unlink(pngPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const module = await loadModule(DIST);
  const presetNames = Object.keys(getPresets());

  const rows = [];
  let peakHeap = 0;
  let peakRss = 0;

  for (const inputName of INPUTS) {
    const inputBytes = await fs.readFile(path.join(INPUT_DIR, inputName));
    const originalSize = inputBytes.length;
    const originalPages = countPages(inputBytes);
    const originalRender = await renderPage1(module, inputBytes);

    for (const preset of presetNames) {
      const r = await compressBytes(module, inputBytes, preset);
      peakHeap = Math.max(peakHeap, module.HEAPU8.buffer.byteLength);

      const outputPath = path.join(OUT_DIR, `${inputName.replace(/\.pdf$/, '')}-${preset}.pdf`);
      await fs.writeFile(outputPath, r.bytes);

      const render = isValidPdf(r.bytes) ? await renderPage1(module, r.bytes) : null;

      const row = {
        input: inputName,
        preset,
        originalSize,
        compressedSize: r.compressedSize,
        ratio: r.compressionRatio,
        timeMs: r.processingTimeMs,
        valid: isValidPdf(r.bytes),
        pages: isValidPdf(r.bytes) ? countPages(r.bytes) : originalPages,
        originalPages,
        renderBytes: render ? render.length : null,
        originalRenderBytes: originalRender ? originalRender.length : null
      };
      rows.push(row);

      console.log(
        `- ${inputName} @ ${preset.padEnd(11)} ` +
        `${fmtBytes(originalSize)} -> ${fmtBytes(r.compressedSize)} ` +
        `(${(r.compressionRatio * 100).toFixed(1)}% saved, ${r.processingTimeMs} ms)`
      );
    }

    process.memoryUsage();
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }

  console.log('\nSummary');
  console.log('='.repeat(60));

  for (const row of rows) {
    const quality = row.renderBytes && row.originalRenderBytes
      ? `${((row.renderBytes / row.originalRenderBytes) * 100).toFixed(0)}% render detail`
      : 'n/a';
    console.log(
      `${row.input.padEnd(9)} ${row.preset.padEnd(11)} ` +
      `saved ${(row.ratio * 100).toFixed(1).padStart(5)}% ` +
      `pages ${row.pages}/${row.originalPages} ` +
      `render ${quality.padStart(12)} ` +
      `time ${String(row.timeMs).padStart(5)} ms`
    );
  }

  console.log('\nMemory');
  console.log(`  Peak WASM heap observed: ${fmtBytes(peakHeap)} (build cap is 512 MB)`);
  console.log(`  Peak Node RSS observed:  ${fmtBytes(peakRss)}`);
  console.log(`  Outputs written to: ${path.relative(ROOT, OUT_DIR)}/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});