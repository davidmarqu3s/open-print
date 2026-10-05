/*
 * Client-side API for the Ghostscript WASM PDF compressor.
 *
 * Lazy loading: the worker (and therefore the ~17 MB WASM engine) is only
 * created/downloaded on the FIRST compressPDF() call. Nothing is fetched
 * when the page loads.
 *
 * The API accepts only a preset NAME. Raw Ghostscript arguments are never
 * accepted here; they are hard-coded in shared/presets.js inside the
 * worker's closed preset set.
 */

export const PRESET_META = [
  {
    id: 'extreme',
    label: 'Extreme',
    description: 'Smallest file size. Aggressive downsampling and JPEG.'
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Recommended default. Good quality with solid savings.'
  },
  {
    id: 'highQuality',
    label: 'High Quality',
    description: 'Preserve quality. Minimal lossy processing.'
  }
];

// Display metadata only. The raw Ghostscript switches behind these live in
// the worker's closed PAGE_SIZES set (shared/presets.js); the UI only ever
// passes a NAME.
export const PAGE_SIZE_META = [
  { id: 'auto', label: 'Original size' },
  { id: 'a4', label: 'A4 (210 × 297 mm)' },
  { id: 'letter', label: 'Letter (8.5 × 11 in)' },
  { id: 'legal', label: 'Legal (8.5 × 14 in)' },
  { id: 'executive', label: 'Executive (7.25 × 10.5 in)' },
  { id: 'a3', label: 'A3 (297 × 420 mm)' }
];

export const IMAGE_FORMAT_META = [
  { id: 'png', label: 'PNG' },
  { id: 'jpeg', label: 'JPEG' }
];

export const IMAGE_DPI_META = [
  { id: 72, label: '72 dpi (draft)' },
  { id: 150, label: '150 dpi' },
  { id: 300, label: '300 dpi (print)' }
];

let worker = null;
let jobCounter = 0;
const activeJobs = new Map();

// Mirrors the worker's safety limit (worker/ghostscript.worker.js).
const MAX_SAFE_INPUT_BYTES = 256 * 1024 * 1024;

function generateId() {
  return `job-${Date.now().toString(36)}-${(jobCounter++).toString(36)}`;
}

/** Reject files that do not begin with the PDF signature (%PDF-). */
function hasPdfSignature(buffer) {
  if (!(buffer instanceof ArrayBuffer)) return false;
  const head = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  return String.fromCharCode(head[0], head[1], head[2], head[3], head[4]) === '%PDF-';
}

function createWorker() {
  const w = new Worker('./ghostscript.worker.js', { type: 'classic' });

  w.onmessage = (event) => {
    handleWorkerMessage(event.data);
  };

  w.onerror = (event) => {
    const err = new Error(event.message || 'Worker crashed unexpectedly');
    err.code = 'WORKER_CRASH';
    failAllJobs(err);
    terminateWorker();
  };

  return w;
}

function ensureWorker() {
  if (!worker) {
    worker = createWorker();
  }
  return worker;
}

export function isWorkerLoaded() {
  return worker !== null;
}

function handleWorkerMessage(data) {
  switch (data.type) {
    case 'ready':
      return;

    case 'progress': {
      const job = activeJobs.get(data.id);
      if (job && typeof job.onProgress === 'function') {
        job.onProgress(data.stage, data.message, data);
      }
      return;
    }

    case 'recycle':
      terminateWorker();
      return;

    case 'result': {
      const job = activeJobs.get(data.id);
      if (!job) {
        return;
      }
      activeJobs.delete(data.id);

      if (data.success) {
        job.resolve({
          bytes: data.bytes,
          images: data.images,
          parts: data.parts,
          count: data.count,
          originalSize: data.originalSize,
          compressedSize: data.compressedSize,
          compressionRatio: data.compressionRatio,
          processingTimeMs: data.processingTimeMs,
          preset: data.preset,
          fileCount: data.fileCount
        });
        if (data.recycle) {
          // Large job: release the memory by starting fresh next time.
          terminateWorker();
        }
      } else {
        const err = new Error(data.error || 'Compression failed');
        err.code = data.code;
        err.gsCode = data.gsCode;
        job.reject(err);

        // A Ghostscript failure can leave the interpreter in an
        // unrecoverable state. Throw the worker away so the next call
        // starts from a clean, freshly-created worker.
        if (data.code === 'GHOSTSCRIPT_ERROR') {
          terminateWorker();
        }
      }
      return;
    }

    case 'error': {
      const err = new Error(data.error || 'Worker error');
      err.code = 'WORKER_ERROR';
      failAllJobs(err);
      terminateWorker();
      return;
    }

    default:
      return;
  }
}

function failAllJobs(err) {
  for (const [, job] of activeJobs) {
    job.reject(err);
  }
  activeJobs.clear();
}

function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/**
 * Compress a PDF file entirely in the browser.
 *
 * @param {object} options
 * @param {ArrayBuffer} options.file       PDF bytes
 * @param {string} options.preset          one of PRESET_META ids
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true] transfer the ArrayBuffer to the
 *        worker (zero-copy). The caller loses ownership of `file`.
 * @returns {Promise<{
 *   bytes: Uint8Array,
 *   originalSize: number,
 *   compressedSize: number,
 *   compressionRatio: number,
 *   processingTimeMs: number,
 *   preset: string
 * }>}
 */
export function compressPDF(options) {
  const { file, preset, onProgress, transfer } = options || {};

  if (!file || !(file instanceof ArrayBuffer)) {
    return Promise.reject(
      Object.assign(new Error('compressPDF: file must be an ArrayBuffer'), { code: 'INVALID_FILE' })
    );
  }
  if (!hasPdfSignature(file)) {
    return Promise.reject(
      Object.assign(new Error('compressPDF: the file is not a valid PDF (missing the %PDF- header)'), {
        code: 'INVALID_PDF'
      })
    );
  }
  if (!PRESET_META.some((p) => p.id === preset)) {
    return Promise.reject(
      Object.assign(new Error(`compressPDF: unknown preset "${preset}"`), { code: 'INVALID_PRESET' })
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    const transferList = transfer === false ? undefined : [file];
    w.postMessage({ type: 'compress', id, file, options: { preset } }, transferList);
  });
}

/**
 * Merge multiple PDFs into a single file entirely in the browser.
 *
 * Files are concatenated in the order given; the pdfwrite device preserves
 * quality (no downsampling) while combining the documents.
 *
 * @param {object} options
 * @param {ArrayBuffer[]} options.files    PDF bytes, in merge order (>= 2)
 * @param {string} [options.pageSize='auto'] one of PAGE_SIZE_META ids; a
 *        fixed page size applies -sPAPERSIZE to the merged document
 * @param {boolean} [options.fit=true]     scale pages to the selected page
 *        size (ignored when pageSize is 'auto')
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true] transfer each ArrayBuffer to the
 *        worker (zero-copy). The caller loses ownership of the files.
 * @returns {Promise<{
 *   bytes: Uint8Array,
 *   originalSize: number,   // total size of all inputs
 *   compressedSize: number,
 *   compressionRatio: number,
 *   processingTimeMs: number,
 *   fileCount: number
 * }>}
 */
export function mergePDFs(options) {
  const { files, pageSize, fit, onProgress, transfer } = options || {};

  if (!Array.isArray(files) || files.length < 2) {
    return Promise.reject(
      Object.assign(new Error('mergePDFs: provide at least two PDF files'), {
        code: 'INVALID_FILE'
      })
    );
  }
  for (const file of files) {
    if (!(file instanceof ArrayBuffer)) {
      return Promise.reject(
        Object.assign(new Error('mergePDFs: each file must be an ArrayBuffer'), {
          code: 'INVALID_FILE'
        })
      );
    }
    if (!hasPdfSignature(file)) {
      return Promise.reject(
        Object.assign(
          new Error('mergePDFs: a file is not a valid PDF (missing the %PDF- header)'),
          { code: 'INVALID_PDF' }
        )
      );
    }
  }
  if (pageSize != null && !PAGE_SIZE_META.some((p) => p.id === pageSize)) {
    return Promise.reject(
      Object.assign(new Error(`mergePDFs: unknown page size "${pageSize}"`), {
        code: 'INVALID_PAGE_SIZE'
      })
    );
  }
  const totalSize = files.reduce((sum, f) => sum + f.byteLength, 0);
  if (totalSize > MAX_SAFE_INPUT_BYTES) {
    return Promise.reject(
      Object.assign(
        new Error(
          `mergePDFs: combined files are ${(totalSize / 1024 / 1024).toFixed(1)} MB; ` +
          `this build can safely process up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB total`
        ),
        { code: 'FILE_TOO_LARGE' }
      )
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    // `files` are ArrayBuffers (already validated above); transfer them
    // directly. (`.buffer` is only valid on typed-array views.)
    const transferList = transfer === false ? undefined : files.slice();
    w.postMessage(
      {
        type: 'merge',
        id,
        files,
        options: { pageSize: pageSize || 'auto', fit: fit !== false }
      },
      transferList
    );
  });
}

/**
 * Rasterize a PDF into one image per page entirely in the browser.
 *
 * @param {object} options
 * @param {ArrayBuffer} options.file      PDF bytes
 * @param {'png'|'jpeg'} [options.format='png']
 * @param {number} [options.dpi=150]      one of IMAGE_DPI_META ids
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true] transfer the ArrayBuffer to the
 *        worker (zero-copy). The caller loses ownership of `file`.
 * @returns {Promise<{
 *   images: Array<{ name: string, bytes: Uint8Array, size: number }>,
 *   count: number,
 *   originalSize: number,
 *   processingTimeMs: number
 * }>}
 */
export function pdfToImages(options) {
  const { file, format, dpi, onProgress, transfer } = options || {};

  if (!file || !(file instanceof ArrayBuffer)) {
    return Promise.reject(
      Object.assign(new Error('pdfToImages: file must be an ArrayBuffer'), {
        code: 'INVALID_FILE'
      })
    );
  }
  if (!hasPdfSignature(file)) {
    return Promise.reject(
      Object.assign(
        new Error('pdfToImages: the file is not a valid PDF (missing the %PDF- header)'),
        { code: 'INVALID_PDF' }
      )
    );
  }
  const fmt = format || 'png';
  if (!IMAGE_FORMAT_META.some((f) => f.id === fmt)) {
    return Promise.reject(
      Object.assign(new Error(`pdfToImages: unknown format "${fmt}"`), {
        code: 'INVALID_FORMAT'
      })
    );
  }
  const res = dpi || 150;
  if (!IMAGE_DPI_META.some((d) => d.id === res)) {
    return Promise.reject(
      Object.assign(new Error(`pdfToImages: unknown dpi "${res}"`), { code: 'INVALID_DPI' })
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    const transferList = transfer === false ? undefined : [file];
    w.postMessage(
      { type: 'toImages', id, file, options: { format: fmt, dpi: res } },
      transferList
    );
  });
}

/**
 * Convert images (JPEG passthrough; PNG/GIF/WebP/BMP via canvas) into a
 * single PDF entirely in the browser. Each image becomes one page.
 *
 * @param {object} options
 * @param {ArrayBuffer[]} options.images  image bytes, one per page
 * @param {string} [options.pageSize='auto'] one of PAGE_SIZE_META ids;
 *        'auto' makes each page exactly the image size
 * @param {boolean} [options.fit=true]    scale each image to fit the page
 * @param {number} [options.quality=0.85] JPEG re-encode quality for
 *        non-JPEG inputs (0.2..1)
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true] transfer each ArrayBuffer to the
 *        worker (zero-copy). The caller loses ownership of the images.
 * @returns {Promise<{
 *   bytes: Uint8Array,
 *   originalSize: number,
 *   compressedSize: number,
 *   fileCount: number,
 *   processingTimeMs: number
 * }>}
 */
export function imagesToPdf(options) {
  const { images, pageSize, fit, quality, onProgress, transfer } = options || {};

  if (!Array.isArray(images) || images.length < 1) {
    return Promise.reject(
      Object.assign(new Error('imagesToPdf: provide at least one image'), {
        code: 'INVALID_FILE'
      })
    );
  }
  for (const image of images) {
    if (!(image instanceof ArrayBuffer)) {
      return Promise.reject(
        Object.assign(new Error('imagesToPdf: each image must be an ArrayBuffer'), {
          code: 'INVALID_FILE'
        })
      );
    }
  }
  if (pageSize != null && !PAGE_SIZE_META.some((p) => p.id === pageSize)) {
    return Promise.reject(
      Object.assign(new Error(`imagesToPdf: unknown page size "${pageSize}"`), {
        code: 'INVALID_PAGE_SIZE'
      })
    );
  }
  const q = quality == null ? 0.85 : quality;
  if (!(q >= 0.2 && q <= 1)) {
    return Promise.reject(
      Object.assign(new Error('imagesToPdf: quality must be between 0.2 and 1'), {
        code: 'INVALID_QUALITY'
      })
    );
  }
  const totalSize = images.reduce((sum, f) => sum + f.byteLength, 0);
  if (totalSize > MAX_SAFE_INPUT_BYTES) {
    return Promise.reject(
      Object.assign(
        new Error(
          `imagesToPdf: combined images are ${(totalSize / 1024 / 1024).toFixed(1)} MB; ` +
          `this build can safely process up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB total`
        ),
        { code: 'FILE_TOO_LARGE' }
      )
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    const transferList = transfer === false ? undefined : images.slice();
    w.postMessage(
      {
        type: 'imagesToPdf',
        id,
        images,
        options: { pageSize: pageSize || 'auto', fit: fit !== false, quality: q }
      },
      transferList
    );
  });
}

/**
 * Split a PDF into multiple PDFs or extract a page range entirely in the
 * browser. Two modes:
 *  - "individual": each page becomes a separate PDF (returned as `parts`)
 *  - "extract": extract the pages described by `pages` (e.g. "1-3,5") into
 *    a single PDF (returned as `bytes`)
 *
 * @param {object} options
 * @param {ArrayBuffer} options.file     PDF bytes
 * @param {'individual'|'extract'} [options.mode='individual']
 * @param {string} [options.pages]       page ranges for "extract", e.g. "1-3, 5"
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true]
 * @returns {Promise<{
 *   bytes?: Uint8Array,
 *   parts?: Array<{ name: string, bytes: Uint8Array }>,
 *   count: number,
 *   originalSize: number,
 *   compressedSize: number,
 *   processingTimeMs: number
 * }>}
 */
export function splitPdf(options) {
  const { file, mode, pages, onProgress, transfer } = options || {};

  if (!file || !(file instanceof ArrayBuffer)) {
    return Promise.reject(
      Object.assign(new Error('splitPdf: file must be an ArrayBuffer'), { code: 'INVALID_FILE' })
    );
  }
  if (!hasPdfSignature(file)) {
    return Promise.reject(
      Object.assign(new Error('splitPdf: the file is not a valid PDF (missing the %PDF- header)'), { code: 'INVALID_PDF' })
    );
  }
  const m = mode || 'individual';
  if (m !== 'individual' && m !== 'extract') {
    return Promise.reject(
      Object.assign(new Error(`splitPdf: unknown mode "${m}"`), { code: 'INVALID_SPLIT_MODE' })
    );
  }
  if (m === 'extract' && (!pages || String(pages).trim() === '')) {
    return Promise.reject(
      Object.assign(new Error('splitPdf: pages is required for extract mode, e.g. "1-3, 5"'), { code: 'INVALID_PAGE_RANGE' })
    );
  }
  if (file.byteLength > MAX_SAFE_INPUT_BYTES) {
    return Promise.reject(
      Object.assign(new Error(`splitPdf: file is ${(file.byteLength / 1024 / 1024).toFixed(1)} MB; limit is ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB`), { code: 'FILE_TOO_LARGE' })
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    const transferList = transfer === false ? undefined : [file];
    w.postMessage(
      { type: 'split', id, file, options: { mode: m, pages: pages || '' } },
      transferList
    );
  });
}

/**
 * Terminate the worker and release its memory. Safe to call any time;
 * the next compressPDF()/mergePDFs() lazily creates a fresh worker.
 */
export function dispose() {
  failAllJobs(Object.assign(new Error('disposed'), { code: 'DISPOSED' }));
  terminateWorker();
}
