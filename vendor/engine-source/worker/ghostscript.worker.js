/*
 * Web Worker that loads the Ghostscript WASM module and compresses or
 * merges PDFs.
 *
 * Message protocol (main thread -> worker):
 *   { type: "compress",    id, file: ArrayBuffer, options: { preset } }
 *   { type: "merge",       id, files: [ArrayBuffer, ...],
 *                          options: { pageSize, fit } }
 *   { type: "toImages",    id, file: ArrayBuffer,
 *                          options: { format: "png"|"jpeg", dpi } }
 *   { type: "imagesToPdf", id, images: [ArrayBuffer, ...],
 *                          options: { pageSize, fit, quality } }
 *   { type: "split",       id, file: ArrayBuffer,
 *                          options: { mode: "individual"|"extract", pages: string } }
 *
 *   Legacy field `input` (Uint8Array) is also accepted for the compress
 *   path for backwards compatibility with earlier versions.
 *
 * Response (worker -> main thread):
 *   { type: "ready", ... }                      after the WASM module loads
 *   { type: "progress", id, stage, message }    meaningful stages, no fake %
 *   { type: "result", id, success, ... }        final result (see below)
 *   { type: "recycle", id }                     main thread should terminate us
 *   { type: "error", id, error }
 *
 * Progress stages (never a fake percentage):
 *   loading -> initializing -> writing-input -> processing -> reading-output -> complete
 *
 * Result payload (success = true):
 *   bytes:             Uint8Array | null (the compressed/merged PDF, or
 *                      null for PDF -> image)
 *   images:            [{ name, bytes }] | undefined (PDF -> image only)
 *   count:             number (images produced by PDF -> image)
 *   originalSize:      number (input size, or total of all inputs)
 *   compressedSize:    number
 *   compressionRatio:  0..1 fraction saved (1 - compressed/original)
 *   processingTimeMs:  number
 *   heapBytesAfter:    number (WASM heap size after the job, informational)
 *   fileCount:         number (merge / image->PDF)
 *
 * Error codes: INVALID_FILE (bad payload), EMPTY_FILE, FILE_TOO_LARGE
 *   (above the 256 MB safety limit), INVALID_PDF (missing %PDF- header),
 *   INVALID_PRESET, INVALID_PAGE_SIZE, INVALID_FORMAT, INVALID_DPI,
 *   INVALID_IMAGE, UNSUPPORTED_IMAGE, GHOSTSCRIPT_ERROR.
 */

importScripts('./ghostscript.js', './presets.js', './pdf-writer.js');

// Suppress Ghostscript BoundingBox spam (%BoundingBox, %HiResBoundingBox, etc.)
// that Emscripten forwards via put_char -> Module.print/console. Filtered here
// for already-built WASM (future builds also filter via native/pre.js + -dQUIET).
if (typeof Module !== 'undefined') {
  const _filter = (msg) => typeof msg === 'string' && msg.charAt(0) === '%';
  if (typeof Module.print === 'function') {
    const _origPrint = Module.print;
    Module.print = function (msg) { if (_filter(msg)) return; return _origPrint(msg); };
  }
  if (typeof Module.printErr === 'function') {
    const _origPrintErr = Module.printErr;
    Module.printErr = function (msg) { if (_filter(msg)) return; return _origPrintErr(msg); };
  }
}
if (typeof console !== 'undefined') {
  const _origLog = console.log;
  console.log = function (...args) {
    if (args.length === 1 && typeof args[0] === 'string' && args[0].charAt(0) === '%') return;
    return _origLog.apply(console, args);
  };
}

const MODULE_PROMISE = GhostscriptModule();

/*
 * Safety limits. The WASM heap is capped at MAXIMUM_MEMORY=512MB with
 * ALLOW_MEMORY_GROWTH=1 and starts at INITIAL_MEMORY=64MB (see
 * scripts/build.sh). pdfwrite needs several times the input size, so we
 * reject inputs that could plausibly exceed the heap instead of letting
 * the process crash or thrash.
 */
const MAX_SAFE_INPUT_BYTES = 256 * 1024 * 1024;      // 256 MB, rejected up-front
const RECYCLE_AFTER_BYTES = 64 * 1024 * 1024;        // 64 MB, terminate after
const RECYCLE_AFTER_HEAP_BYTES = 384 * 1024 * 1024;  // 384 MB heap, terminate after

const PROGRESS_STAGES = {
  loading: 'loading',
  initializing: 'initializing',
  writingInput: 'writing-input',
  processing: 'processing',
  readingOutput: 'reading-output',
  complete: 'complete'
};

let moduleLoaded = false;

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function post(id, message) {
  self.postMessage(message);
}

function postProgress(id, stage, message) {
  post(id, { type: 'progress', id, stage, message });
}

function getErrorDetail(module) {
  try {
    const getLastError = module.cwrap('gs_get_last_error', 'string', []);
    return getLastError() || '';
  } catch (e) {
    return '';
  }
}

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isJpeg(bytes) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  );
}

/*
 * Walk the JPEG marker stream to find the first SOF (SOF0..SOF15, skipping
 * DHT/JPG/DAC) and return width, height and component count. Used to build
 * the PDF image XObject without decoding the pixels.
 */
function parseJpeg(bytes) {
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0x01) continue; // SOI, TEM
    if (marker >= 0xd0 && marker <= 0xd7) continue;   // RSTn
    if (marker === 0xd9 || marker === 0xda) break;    // EOI, SOS
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

/*
 * Re-encode arbitrary browser-decodable image bytes (PNG, GIF, WebP, BMP,
 * …) as a JPEG using the worker's OffscreenCanvas. JPEG inputs never reach
 * this path; they are embedded losslessly.
 */
async function imageToJpegBytes(bytes, quality) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw codedError(
      'UNSUPPORTED_IMAGE',
      'This browser cannot decode that image format inside the worker.'
    );
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/*
 * Ghostscript switches for a fixed page size (merge only). `fit` is
 * implemented with -dPDFFitPage, which scales each PDF page to the newly
 * selected paper. Only names from the closed PAGE_SIZES set are accepted.
 */
function pageArgsFor(pageSize, fit) {
  const size = GSPresets.PAGE_SIZES[pageSize];
  const args = size ? size.args.slice() : [];
  if (fit !== false && pageSize !== 'auto') {
    args.push('-dPDFFitPage');
  }
  return args;
}

/*
 * Validate a single PDF payload by its content (never by name/MIME).
 * Returns the byte length; throws a coded error on rejection.
 */
function assertValidPdf(file) {
  if (!file || (typeof file.byteLength !== 'number' && !(file instanceof ArrayBuffer))) {
    const err = new Error('Invalid file data');
    err.code = 'INVALID_FILE';
    throw err;
  }

  const originalSize = file.byteLength;

  if (originalSize === 0) {
    const err = new Error('The selected file is empty.');
    err.code = 'EMPTY_FILE';
    throw err;
  }

  if (originalSize > MAX_SAFE_INPUT_BYTES) {
    const err = new Error(
      `File is ${(originalSize / 1024 / 1024).toFixed(1)} MB. ` +
      `This build can safely process files up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB.`
    );
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  // Content validation: never trust the filename or MIME type. Reject
  // anything that does not start with the PDF magic signature (%PDF-).
  // This also catches HTML documents or scripts uploaded with a .pdf name.
  const head = new Uint8Array(
    file instanceof ArrayBuffer ? file : file.buffer,
    file instanceof ArrayBuffer ? 0 : file.byteOffset,
    Math.min(5, originalSize)
  );
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
  if (magic !== '%PDF-') {
    const err = new Error(
      'The selected file is not a valid PDF (missing the %PDF- header).'
    );
    err.code = 'INVALID_PDF';
    throw err;
  }

  return originalSize;
}

async function compress(module, file, options, id) {
  const originalSize = assertValidPdf(file);

  const presetName = options && options.preset;
  if (!presetName || !GSPresets.PRESETS[presetName]) {
    const err = new Error(`Unknown compression preset: "${presetName}"`);
    err.code = 'INVALID_PRESET';
    throw err;
  }

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;
  const outputPath = `${workDir}/output.pdf`;

  try {
    postProgress(id, PROGRESS_STAGES.writingInput, 'Writing input PDF to memory…');
    FS.mkdirTree(workDir);
    FS.writeFile(inputPath, new Uint8Array(file));

    postProgress(id, PROGRESS_STAGES.initializing, 'Initializing Ghostscript…');

    const processPdf = module.cwrap('gs_process_pdf_argv', 'number', [
      'string',
      'string',
      'string'
    ]);

    const args = GSPresets.PRESETS[presetName].args.join('\n');

    postProgress(id, PROGRESS_STAGES.processing, 'Processing PDF…');

    const code = processPdf(inputPath, outputPath, args);

    if (code !== 0) {
      const detail = getErrorDetail(module);
      const err = new Error(
        `Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : '')
      );
      err.code = 'GHOSTSCRIPT_ERROR';
      err.gsCode = code;
      throw err;
    }

    postProgress(id, PROGRESS_STAGES.readingOutput, 'Reading compressed PDF…');

    const bytes = FS.readFile(outputPath);
    const compressedSize = bytes.length;
    const processingTimeMs = Math.round(performance.now() - started);
    const compressionRatio = originalSize > 0
      ? 1 - compressedSize / originalSize
      : 0;
    const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;

    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');

    return {
      bytes,
      originalSize,
      compressedSize,
      compressionRatio,
      processingTimeMs,
      heapBytesAfter,
      preset: presetName,
      recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
    };
  } finally {
    // Always clean up the virtual filesystem.
    try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
    try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

async function merge(module, files, options, id) {
  if (!Array.isArray(files) || files.length < 2) {
    const err = new Error('Merging requires at least two PDF files.');
    err.code = 'INVALID_FILE';
    throw err;
  }

  const pageSize = (options && options.pageSize) || 'auto';
  if (!GSPresets.PAGE_SIZE_NAMES.includes(pageSize)) {
    throw codedError('INVALID_PAGE_SIZE', `Unknown page size: "${pageSize}"`);
  }
  const fit = !options || options.fit !== false;

  let totalSize = 0;
  for (const file of files) {
    totalSize += assertValidPdf(file);
  }
  if (totalSize > MAX_SAFE_INPUT_BYTES) {
    const err = new Error(
      `The combined files are ${(totalSize / 1024 / 1024).toFixed(1)} MB. ` +
      `This build can safely process up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB total.`
    );
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;
  const outputPath = `${workDir}/output.pdf`;

  const inputPaths = [];
  try {
    postProgress(
      id,
      PROGRESS_STAGES.writingInput,
      `Writing ${files.length} PDFs to memory…`
    );
    FS.mkdirTree(workDir);
    files.forEach((file, i) => {
      const inputPath = `${workDir}/input-${i}.pdf`;
      FS.writeFile(inputPath, new Uint8Array(file));
      inputPaths.push(inputPath);
    });

    postProgress(id, PROGRESS_STAGES.initializing, 'Initializing Ghostscript…');

    const processPdfs = module.cwrap('gs_process_pdfs', 'number', [
      'string',
      'string',
      'string'
    ]);

    // Extra args: optional -sPAPERSIZE and -dPDFFitPage when a fixed page
    // size was requested; empty string preserves the original sizes.
    const inputBlob = inputPaths.join('\n');
    const extraArgs = pageArgsFor(pageSize, fit).join('\n');

    postProgress(id, PROGRESS_STAGES.processing, 'Merging PDFs…');

    const code = processPdfs(inputBlob, outputPath, extraArgs);

    if (code !== 0) {
      const detail = getErrorDetail(module);
      const err = new Error(
        `Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : '')
      );
      err.code = 'GHOSTSCRIPT_ERROR';
      err.gsCode = code;
      throw err;
    }

    postProgress(id, PROGRESS_STAGES.readingOutput, 'Reading merged PDF…');

    const bytes = FS.readFile(outputPath);
    const compressedSize = bytes.length;
    const processingTimeMs = Math.round(performance.now() - started);
    const compressionRatio = totalSize > 0
      ? 1 - compressedSize / totalSize
      : 0;
    const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;

    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');

    return {
      bytes,
      originalSize: totalSize,
      compressedSize,
      compressionRatio,
      processingTimeMs,
      heapBytesAfter,
      fileCount: files.length,
      recycle: totalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
    };
  } finally {
    // Always clean up the virtual filesystem.
    for (const inputPath of inputPaths) {
      try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
    }
    try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

async function imagesToPdf(module, files, options, id) {
  if (!Array.isArray(files) || files.length < 1) {
    throw codedError('INVALID_FILE', 'Image to PDF requires at least one image.');
  }

  const pageSize = (options && options.pageSize) || 'auto';
  if (!GSPresets.PAGE_SIZE_NAMES.includes(pageSize)) {
    throw codedError('INVALID_PAGE_SIZE', `Unknown page size: "${pageSize}"`);
  }
  const fit = !options || options.fit !== false;
  const quality = Math.min(
    1,
    Math.max(0.2, options && typeof options.quality === 'number' ? options.quality : 0.85)
  );
  const sizeMeta = GSPresets.PAGE_SIZES[pageSize];

  let totalSize = 0;
  for (const file of files) {
    if (!(file instanceof ArrayBuffer)) {
      throw codedError('INVALID_FILE', 'Each image must be an ArrayBuffer.');
    }
    totalSize += file.byteLength;
  }
  if (totalSize > MAX_SAFE_INPUT_BYTES) {
    throw codedError(
      'FILE_TOO_LARGE',
      `The combined images are ${(totalSize / 1024 / 1024).toFixed(1)} MB. ` +
      `This build can safely process up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB total.`
    );
  }

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;

  const decoded = [];
  const paths = [];
  try {
    postProgress(id, PROGRESS_STAGES.writingInput, 'Preparing images…');
    FS.mkdirTree(workDir);

    for (let i = 0; i < files.length; i++) {
      const input = new Uint8Array(files[i]);
      let jpeg = input;
      if (!isJpeg(input)) {
        postProgress(id, PROGRESS_STAGES.initializing, `Converting image ${i + 1} to JPEG…`);
        jpeg = await imageToJpegBytes(input, quality);
      }
      const dims = parseJpeg(jpeg);
      if (!dims || dims.width <= 0 || dims.height <= 0) {
        throw codedError('INVALID_IMAGE', `Image ${i + 1} could not be decoded as a JPEG.`);
      }
      const path = `${workDir}/img-${i}.jpg`;
      FS.writeFile(path, jpeg);
      paths.push(path);
      decoded.push({
        path,
        jpeg,
        width: dims.width,
        height: dims.height,
        components: dims.components
      });
    }

    postProgress(id, PROGRESS_STAGES.processing, 'Building PDF…');

    const bytes = PDF_WRITER.writePdf(decoded, { w: sizeMeta.w, h: sizeMeta.h, fit });

    const processingTimeMs = Math.round(performance.now() - started);
    const compressionRatio = totalSize > 0 ? 1 - bytes.length / totalSize : 0;

    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');

    return {
      bytes,
      originalSize: totalSize,
      compressedSize: bytes.length,
      compressionRatio,
      processingTimeMs,
      fileCount: decoded.length,
      recycle: false
    };
  } finally {
    for (const p of paths) {
      try { FS.unlink(p); } catch (e) { /* ignore */ }
    }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

async function toImages(module, file, options, id) {
  const originalSize = assertValidPdf(file);

  const format = (options && options.format) || 'png';
  const dpi = (options && options.dpi) || 150;
  if (!GSPresets.IMAGE_FORMATS[format]) {
    throw codedError('INVALID_FORMAT', `Unknown image format: "${format}"`);
  }
  if (!GSPresets.IMAGE_DPI_NAMES.includes(dpi)) {
    throw codedError('INVALID_DPI', `Unknown resolution: "${dpi}" dpi`);
  }

  const formatMeta = GSPresets.IMAGE_FORMATS[format];
  const dpiMeta = GSPresets.IMAGE_DPIS[dpi];
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;
  const outputPattern = `${workDir}/page-%d.${ext}`;

  const made = [];
  try {
    postProgress(id, PROGRESS_STAGES.writingInput, 'Writing PDF to memory…');
    FS.mkdirTree(workDir);
    FS.writeFile(inputPath, new Uint8Array(file));

    postProgress(id, PROGRESS_STAGES.initializing, 'Initializing Ghostscript…');

    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);
    const args = [
      `-sDEVICE=${formatMeta.device}`,
      dpiMeta.args[0],
      '-dFirstPage=1',
      '-dLastPage=10000',
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      format === 'jpeg' ? '-dJPEGQ=92' : ''
    ].filter(Boolean);

    postProgress(id, PROGRESS_STAGES.processing, 'Rendering pages…');

    const code = run(inputPath, outputPattern, args.join('\n'));
    if (code !== 0) {
      const detail = getErrorDetail(module);
      const err = new Error(
        `Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : '')
      );
      err.code = 'GHOSTSCRIPT_ERROR';
      err.gsCode = code;
      throw err;
    }

    postProgress(id, PROGRESS_STAGES.readingOutput, 'Collecting images…');

    const pageFiles = FS.readdir(workDir)
      .filter((name) => new RegExp(`^page-\\d+\\.${ext}$`).test(name))
      .sort((a, b) => {
        const an = parseInt(a.match(/\d+/)[0], 10);
        const bn = parseInt(b.match(/\d+/)[0], 10);
        return an - bn;
      });

    const images = pageFiles.map((name) => {
      const path = `${workDir}/${name}`;
      made.push(path);
      return { name, bytes: FS.readFile(path) };
    });

    const processingTimeMs = Math.round(performance.now() - started);
    const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;

    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');

    return {
      bytes: null,
      images,
      count: images.length,
      originalSize,
      compressedSize: 0,
      compressionRatio: 0,
      processingTimeMs,
      heapBytesAfter,
      recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
    };
  } finally {
    for (const p of made) {
      try { FS.unlink(p); } catch (e) { /* ignore */ }
    }
    try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

function parsePageRanges(str) {
  const s = String(str || '').trim();
  if (!s) throw codedError('INVALID_PAGE_RANGE', 'Enter page numbers, e.g. "1-3, 5"');
  const parts = s.split(',');
  const pages = [];
  const seen = new Set();
  for (let raw of parts) {
    raw = raw.trim();
    if (!raw) continue;
    const dash = raw.indexOf('-');
    if (dash !== -1) {
      const aStr = raw.slice(0, dash).trim();
      const bStr = raw.slice(dash + 1).trim();
      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a > 10000 || b > 10000) {
        throw codedError('INVALID_PAGE_RANGE', `Invalid range "${raw}" — use numbers like "1-3"`);
      }
      if (a > b) throw codedError('INVALID_PAGE_RANGE', `Invalid range "${raw}" — start must be <= end`);
      if (b - a > 500) throw codedError('INVALID_PAGE_RANGE', `Range "${raw}" too large (max 500 pages at once)`);
      for (let p = a; p <= b; p++) {
        if (!seen.has(p)) { seen.add(p); pages.push(p); }
      }
    } else {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10000) {
        throw codedError('INVALID_PAGE_RANGE', `Invalid page "${raw}" — use a number >= 1`);
      }
      if (!seen.has(n)) { seen.add(n); pages.push(n); }
    }
  }
  if (pages.length === 0) throw codedError('INVALID_PAGE_RANGE', 'No valid pages found');
  if (pages.length > 500) throw codedError('INVALID_PAGE_RANGE', 'Too many pages selected (max 500)');
  return pages;
}

async function splitPdf(module, file, options, id) {
  const originalSize = assertValidPdf(file);
  const mode = (options && options.mode) || 'individual';
  if (mode !== 'individual' && mode !== 'extract') {
    throw codedError('INVALID_SPLIT_MODE', `Unknown split mode "${mode}"`);
  }

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;

  const made = [];
  let tmpPaths = [];
  try {
    postProgress(id, PROGRESS_STAGES.writingInput, 'Writing PDF to memory…');
    FS.mkdirTree(workDir);
    FS.writeFile(inputPath, new Uint8Array(file));

    const run = module.cwrap('gs_run', 'number', ['string', 'string', 'string']);

    if (mode === 'individual') {
      postProgress(id, PROGRESS_STAGES.processing, 'Splitting into individual pages…');
      const outputPattern = `${workDir}/page-%d.pdf`;
      const code = run(inputPath, outputPattern, '-sDEVICE=pdfwrite');
      if (code !== 0) {
        const detail = getErrorDetail(module);
        const err = new Error(`Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : ''));
        err.code = 'GHOSTSCRIPT_ERROR';
        err.gsCode = code;
        throw err;
      }
      const pageFiles = FS.readdir(workDir)
        .filter((name) => /^page-\d+\.pdf$/.test(name))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
      if (pageFiles.length === 0) {
        // Fallback: try per-page extraction if %d pattern not supported
        throw codedError('GHOSTSCRIPT_ERROR', 'Could not split pages (no output files)');
      }
      const parts = pageFiles.map((name) => {
        const p = `${workDir}/${name}`;
        made.push(p);
        const bytes = FS.readFile(p);
        const num = parseInt(name.match(/\d+/)[0], 10);
        return { name: `page-${String(num).padStart(3, '0')}.pdf`, bytes };
      });
      const processingTimeMs = Math.round(performance.now() - started);
      const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;
      postProgress(id, PROGRESS_STAGES.complete, 'Complete.');
      return {
        bytes: null,
        parts,
        count: parts.length,
        originalSize,
        compressedSize: parts.reduce((s, p) => s + p.bytes.length, 0),
        processingTimeMs,
        heapBytesAfter,
        recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
      };
    }

    // mode === 'extract'
    const pagesStr = options.pages || '';
    const pages = parsePageRanges(pagesStr);
    // sort pages for extraction but keep original order? Use as given order
    // For Ghostscript we need to extract in order requested
    postProgress(id, PROGRESS_STAGES.processing, `Extracting ${pages.length} page(s)…`);

    // Optimize: if pages are contiguous sequential, do single extraction
    let isContiguous = true;
    for (let i = 1; i < pages.length; i++) {
      if (pages[i] !== pages[i - 1] + 1) { isContiguous = false; break; }
    }

    if (isContiguous && pages.length >= 1) {
      const first = pages[0];
      const last = pages[pages.length - 1];
      const outPath = `${workDir}/output.pdf`;
      made.push(outPath);
      const args = ['-sDEVICE=pdfwrite', `-dFirstPage=${first}`, `-dLastPage=${last}`].join('\n');
      const code = run(inputPath, outPath, args);
      if (code !== 0) {
        const detail = getErrorDetail(module);
        const err = new Error(`Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : ''));
        err.code = 'GHOSTSCRIPT_ERROR';
        err.gsCode = code;
        throw err;
      }
      const bytes = FS.readFile(outPath);
      const processingTimeMs = Math.round(performance.now() - started);
      const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;
      postProgress(id, PROGRESS_STAGES.complete, 'Complete.');
      return {
        bytes,
        originalSize,
        compressedSize: bytes.length,
        processingTimeMs,
        heapBytesAfter,
        count: pages.length,
        fileCount: 1,
        recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
      };
    }

    // Non-contiguous: extract each page individually then merge
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const out = `${workDir}/tmp-${i}.pdf`;
      tmpPaths.push(out);
      made.push(out);
      const args = ['-sDEVICE=pdfwrite', `-dFirstPage=${p}`, `-dLastPage=${p}`].join('\n');
      const code = run(inputPath, out, args);
      if (code !== 0) {
        const detail = getErrorDetail(module);
        const err = new Error(`Ghostscript exited with code ${code} on page ${p}.` + (detail ? ` ${detail.trim()}` : ''));
        err.code = 'GHOSTSCRIPT_ERROR';
        err.gsCode = code;
        throw err;
      }
      postProgress(id, PROGRESS_STAGES.processing, `Extracted page ${p} (${i + 1}/${pages.length})…`);
    }

    // Merge the per-page PDFs into one
    postProgress(id, PROGRESS_STAGES.processing, 'Merging selected pages…');
    const processPdfs = module.cwrap('gs_process_pdfs', 'number', ['string', 'string', 'string']);
    const finalPath = `${workDir}/final.pdf`;
    made.push(finalPath);
    const inputBlob = tmpPaths.join('\n');
    const code2 = processPdfs(inputBlob, finalPath, '');
    if (code2 !== 0) {
      const detail = getErrorDetail(module);
      const err = new Error(`Ghostscript exited with code ${code2} while merging.` + (detail ? ` ${detail.trim()}` : ''));
      err.code = 'GHOSTSCRIPT_ERROR';
      err.gsCode = code2;
      throw err;
    }
    const bytes = FS.readFile(finalPath);
    const processingTimeMs = Math.round(performance.now() - started);
    const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;
    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');
    return {
      bytes,
      originalSize,
      compressedSize: bytes.length,
      processingTimeMs,
      heapBytesAfter,
      count: pages.length,
      fileCount: 1,
      recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
    };
  } finally {
    for (const p of made) { try { FS.unlink(p); } catch (e) { /* ignore */ } }
    try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

self.onmessage = async function (event) {
  const { type, id } = event.data;

  if (!['compress', 'merge', 'imagesToPdf', 'toImages', 'split'].includes(type)) {
    self.postMessage({ type: 'error', id, error: `Unknown message type: ${type}` });
    return;
  }

  const options = event.data.options || {};

  try {
    if (!moduleLoaded) {
      postProgress(id, PROGRESS_STAGES.loading, 'Loading Ghostscript engine…');
    }

    const module = await MODULE_PROMISE;
    moduleLoaded = true;

    let result;
    if (type === 'merge') {
      result = await merge(module, event.data.files, options, id);
    } else if (type === 'imagesToPdf') {
      result = await imagesToPdf(module, event.data.images, options, id);
    } else if (type === 'toImages') {
      result = await toImages(module, event.data.file, options, id);
    } else if (type === 'split') {
      result = await splitPdf(module, event.data.file, options, id);
    } else {
      result = await compress(module, event.data.file || event.data.input, options, id);
    }

    const transferList = [];
    if (result.bytes) {
      transferList.push(result.bytes.buffer);
    }
    if (result.images) {
      for (const img of result.images) {
        transferList.push(img.bytes.buffer);
      }
    }
    if (result.parts) {
      for (const p of result.parts) {
        transferList.push(p.bytes.buffer);
      }
    }

    self.postMessage(
      {
        type: 'result',
        id,
        success: true,
        bytes: result.bytes,
        images: result.images,
        parts: result.parts,
        count: result.count,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        compressionRatio: result.compressionRatio,
        processingTimeMs: result.processingTimeMs,
        heapBytesAfter: result.heapBytesAfter,
        preset: result.preset,
        fileCount: result.fileCount,
        recycle: result.recycle
      },
      transferList.length > 0 ? transferList : undefined
    );

    if (result.recycle) {
      // Large job consumed a lot of memory; ask the main thread to throw
      // us away so a fresh, low-memory worker is used for the next job.
      self.postMessage({ type: 'recycle', id });
    }
  } catch (err) {
    self.postMessage({
      type: 'result',
      id,
      success: false,
      code: err.code || 'UNKNOWN',
      gsCode: err.gsCode,
      error: err.message || String(err)
    });
  }
};

// Signal that the worker is ready once the module has loaded.
MODULE_PROMISE.then(() => {
  self.postMessage({ type: 'ready' });
}).catch((err) => {
  self.postMessage({ type: 'error', error: err.message || String(err) });
});
