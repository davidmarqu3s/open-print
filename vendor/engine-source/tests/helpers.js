/*
 * Shared helpers for Node-based tests and the benchmark script.
 */

import path from 'node:path';

// Side-effect: this plain script sets `globalThis.GSPresets` when loaded
// as a module (the repo is "type": "module").
import '../shared/presets.js';
import '../shared/pdf-writer.js';

let loadedDist = null;

export async function loadModule(distDir) {
  if (loadedDist && loadedDist.dir === distDir) {
    return loadedDist.module;
  }
  const mod = await import(path.join(distDir, 'ghostscript.js'));
  const module = await mod.default();
  loadedDist = { dir: distDir, module };
  return module;
}

export function getPresets() {
  if (!globalThis.GSPresets) {
    throw new Error('GSPresets global not set; import shared/presets.js first');
  }
  return globalThis.GSPresets.PRESETS;
}

/**
 * Run one compression job directly against the WASM module (no worker).
 */
export async function compressBytes(module, inputBytes, presetName) {
  const presets = getPresets();
  const preset = presets[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const started = performance.now();
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/helper-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;
  const outputPath = `${workDir}/output.pdf`;
  const FS = module.FS;

  FS.mkdirTree(workDir);
  FS.writeFile(inputPath, inputBytes);

  const processPdf = module.cwrap('gs_process_pdf_argv', 'number', [
    'string',
    'string',
    'string'
  ]);
  const args = preset.args.join('\n');
  const code = processPdf(inputPath, outputPath, args);

  const bytes = code === 0 ? FS.readFile(outputPath) : new Uint8Array(0);
  const processingTimeMs = Math.round(performance.now() - started);

  try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
  try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
  try { FS.rmdir(workDir); } catch (e) { /* ignore */ }

  return {
    code,
    bytes,
    preset: presetName,
    originalSize: inputBytes.length,
    compressedSize: bytes.length,
    compressionRatio: inputBytes.length
      ? 1 - bytes.length / inputBytes.length
      : 0,
    processingTimeMs
  };
}

/**
 * Merge multiple PDF byte arrays into one via the WASM module directly.
 * Options: pageSize ('auto' | PAGE_SIZE_NAMES), fit (boolean).
 */
export async function mergeBytes(module, inputBytesList, options = {}) {
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/merge-${jobId}`;
  const outputPath = `${workDir}/output.pdf`;
  const FS = module.FS;

  const inputPaths = [];
  FS.mkdirTree(workDir);
  inputBytesList.forEach((bytes, i) => {
    const inputPath = `${workDir}/input-${i}.pdf`;
    FS.writeFile(inputPath, bytes);
    inputPaths.push(inputPath);
  });

  const processPdfs = module.cwrap('gs_process_pdfs', 'number', [
    'string',
    'string',
    'string'
  ]);
  const started = performance.now();
  const extraArgs = mergePageArgs(options.pageSize, options.fit).join('\n');
  const code = processPdfs(inputPaths.join('\n'), outputPath, extraArgs);
  const processingTimeMs = Math.round(performance.now() - started);

  const bytes = code === 0 ? FS.readFile(outputPath) : new Uint8Array(0);

  for (const inputPath of inputPaths) {
    try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
  }
  try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
  try { FS.rmdir(workDir); } catch (e) { /* ignore */ }

  return {
    code,
    bytes,
    originalSize: inputBytesList.reduce((sum, b) => sum + b.length, 0),
    compressedSize: bytes.length,
    processingTimeMs
  };
}

/* Ghostscript switches for a fixed page size (mirrors the worker helper). */
export function mergePageArgs(pageSize, fit) {
  const size = GSPresets.PAGE_SIZES[pageSize] || GSPresets.PAGE_SIZES.auto;
  const args = size.args.slice();
  if (fit !== false && pageSize !== 'auto') {
    args.push('-dPDFFitPage');
  }
  return args;
}

/**
 * Rasterize PDF bytes to one image per page via gs_run.
 * Options: format ('png'|'jpeg'), dpi (72|150|300).
 */
export async function pdfToImageBytes(module, inputBytes, options = {}) {
  const format = options.format || 'png';
  const dpi = options.dpi || 150;
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const device = format === 'jpeg' ? 'jpeg' : 'png16m';

  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/toimg-${jobId}`;
  const inPath = `${workDir}/in.pdf`;
  const outPattern = `${workDir}/page-%d.${ext}`;
  const FS = module.FS;

  FS.mkdirTree(workDir);
  FS.writeFile(inPath, inputBytes);

  const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
  const args = [
    `-sDEVICE=${device}`,
    `-r${dpi}`,
    '-dFirstPage=1',
    '-dLastPage=10000',
    '-dTextAlphaBits=4',
    '-dGraphicsAlphaBits=4',
    format === 'jpeg' ? '-dJPEGQ=92' : ''
  ].filter(Boolean);

  const started = performance.now();
  const code = run(inPath, outPattern, args.join('\n'));
  const processingTimeMs = Math.round(performance.now() - started);

  const images = code === 0
    ? FS.readdir(workDir)
        .filter((name) => new RegExp(`^page-\\d+\\.${ext}$`).test(name))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
        .map((name) => ({ name, bytes: FS.readFile(`${workDir}/${name}`) }))
    : [];

  for (const img of images) {
    try { FS.unlink(`${workDir}/${img.name}`); } catch (e) { /* ignore */ }
  }
  try { FS.unlink(inPath); } catch (e) { /* ignore */ }
  try { FS.rmdir(workDir); } catch (e) { /* ignore */ }

  return { code, images, count: images.length, processingTimeMs };
}

/* Walk the JPEG marker stream to the first SOF (mirrors the worker helper). */
export function parseJpeg(bytes) {
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (i + 1 >= bytes.length) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2) break;
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      if (i + 7 >= bytes.length) return null;
      return {
        width: (bytes[i + 5] << 8) | bytes[i + 6],
        height: (bytes[i + 3] << 8) | bytes[i + 4],
        components: bytes[i + 7]
      };
    }
    i += len;
  }
  return null;
}

/**
 * Build a PDF from JPEG byte arrays via the pure-JS writer (no Ghostscript).
 * Options: pageSize ('auto' | PAGE_SIZE_NAMES), fit (boolean).
 */
export function buildImagesPdf(jpegBytesList, options = {}) {
  if (!globalThis.PDF_WRITER) {
    throw new Error('PDF_WRITER global not set; import shared/pdf-writer.js first');
  }
  const pageSize = options.pageSize || 'auto';
  const size = GSPresets.PAGE_SIZES[pageSize];
  const images = jpegBytesList.map((jpeg, i) => {
    const dims = parseJpeg(jpeg);
    if (!dims || dims.width <= 0 || dims.height <= 0) {
      throw new Error(`image ${i} is not a parseable JPEG`);
    }
    return { jpeg, width: dims.width, height: dims.height, components: dims.components };
  });
  return PDF_WRITER.writePdf(images, { w: size.w, h: size.h, fit: options.fit !== false });
}

export async function splitPdfIndividual(module, inputBytes) {
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/split-${jobId}`;
  const inPath = `${workDir}/in.pdf`;
  const outPattern = `${workDir}/page-%d.pdf`;
  const FS = module.FS;
  const made = [];
  try {
    FS.mkdirTree(workDir);
    FS.writeFile(inPath, inputBytes);
    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
    const code = run(inPath, outPattern, '-sDEVICE=pdfwrite');
    if (code !== 0) throw new Error(`gs_run split failed with code ${code}`);
    const pageFiles = FS.readdir(workDir)
      .filter((n) => /^page-\d+\.pdf$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    const parts = pageFiles.map((name) => {
      const p = `${workDir}/${name}`;
      made.push(p);
      return { name: `page-${String(parseInt(name.match(/\d+/)[0], 10)).padStart(3, '0')}.pdf`, bytes: FS.readFile(p) };
    });
    return parts;
  } finally {
    for (const p of made) { try { FS.unlink(p); } catch {} }
    try { FS.unlink(inPath); } catch {}
    try { FS.rmdir(workDir); } catch {}
  }
}

export async function extractPdfPages(module, inputBytes, pages) {
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/extract-${jobId}`;
  const inPath = `${workDir}/in.pdf`;
  const outPath = `${workDir}/out.pdf`;
  const FS = module.FS;
  try {
    FS.mkdirTree(workDir);
    FS.writeFile(inPath, inputBytes);
    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
    // Use -sPageList for Ghostscript (supports 1,3,5-7 etc.)
    const code = run(inPath, outPath, `-sDEVICE=pdfwrite\n-sPageList=${pages}`);
    if (code !== 0) throw new Error(`gs_run extract failed with code ${code}`);
    return FS.readFile(outPath);
  } finally {
    try { FS.unlink(inPath); } catch {}
    try { FS.unlink(outPath); } catch {}
    try { FS.rmdir(workDir); } catch {}
  }
}

export function isValidPdf(bytes) {
  if (!bytes || bytes.length < 8) return false;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  return magic.startsWith('%PDF-');
}

/** Rough page counter (byte-scan of uncompressed structure). */
export function countPages(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const re = /\/Type\s*\/Page[^s]/g;
  let n = 0;
  let m;
  while ((m = re.exec(s)) !== null) n++;
  return n;
}

/**
 * Extract the text of a PDF via Ghostscript's txtwrite device.
 * Returns the raw extracted text, or null if extraction failed.
 * Dev-only helper (uses gs_run, which the web worker never exposes).
 */
export async function extractText(module, inputBytes) {
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/text-${jobId}`;
  const inPath = `${workDir}/in.pdf`;
  const txtPath = `${workDir}/out.txt`;
  const FS = module.FS;

  try {
    FS.mkdirTree(workDir);
    FS.writeFile(inPath, inputBytes);

    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
    const args = [
      '-dNOPAUSE',
      '-dBATCH',
      '-sDEVICE=txtwrite',
      '-dFirstPage=1',
      '-dLastPage=1000'
    ].join('\n');

    const code = run(inPath, txtPath, args);
    if (code !== 0) return null;
    return Buffer.from(FS.readFile(txtPath)).toString('utf8');
  } finally {
    try { FS.unlink(inPath); } catch (e) { /* ignore */ }
    try { FS.unlink(txtPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

/** Split text into normalized lowercase words for similarity comparison. */
export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Fraction of `a`'s tokens that also appear in `b` (0..1).
 */
export function tokenContainment(a, b) {
  const tokensA = tokenize(a);
  const setB = new Set(tokenize(b));
  if (tokensA.length === 0) return 0;
  let present = 0;
  for (const t of tokensA) {
    if (setB.has(t)) present++;
  }
  return present / tokensA.length;
}
