/*
 * Demo UI for the Ghostscript WASM PDF tools (compress, merge, PDF -> image,
 * image -> PDF).
 *
 * The Ghostscript engine is loaded lazily: the worker is only created when
 * the user runs a job (see gs-compress.js), so the WASM is never downloaded
 * on page load.
 */

import {
  compressPDF,
  mergePDFs,
  pdfToImages,
  imagesToPdf,
  splitPdf,
  PRESET_META,
  PAGE_SIZE_META,
  IMAGE_FORMAT_META,
  IMAGE_DPI_META
} from './gs-compress.js';

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const dropText = document.getElementById('drop-text');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileList = document.getElementById('file-list');
const presetGroup = document.getElementById('preset-group');
const mergeOptions = document.getElementById('merge-options');
const imageOptions = document.getElementById('image-options');
const imagepdfOptions = document.getElementById('imagepdf-options');
const mergePageSize = document.getElementById('merge-page-size');
const mergeFit = document.getElementById('merge-fit');
const imageFormat = document.getElementById('image-format');
const imageDpi = document.getElementById('image-dpi');
const imagepdfPageSize = document.getElementById('imagepdf-page-size');
const imagepdfFit = document.getElementById('imagepdf-fit');
const splitOptions = document.getElementById('split-options');
const splitMode = document.getElementById('split-mode');
const splitPages = document.getElementById('split-pages');
const splitPagesRow = document.getElementById('split-pages-row');
const modeCompress = document.getElementById('mode-compress');
const modeMerge = document.getElementById('mode-merge');
const modePdf2Image = document.getElementById('mode-pdf2image');
const modeImage2Pdf = document.getElementById('mode-image2pdf');
const modeSplit = document.getElementById('mode-split');
const compressBtn = document.getElementById('compress-btn');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progress-text');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const resultTitle = document.getElementById('result-title');
const originalSizeEl = document.getElementById('original-size');
const compressedSizeEl = document.getElementById('compressed-size');
const savingsEl = document.getElementById('savings');
const processingNoteEl = document.getElementById('processing-note');
const resultOutputLabel = document.getElementById('result-output-label');
const resultSavedLabel = document.getElementById('result-saved-label');
const imageGrid = document.getElementById('image-grid');
const downloadLink = document.getElementById('download-link');
const zipLink = document.getElementById('zip-link');

const PRESET_IDS = PRESET_META.map((p) => p.id);

const MODE_UI = {
  compress: {
    buttonText: 'Compress PDF',
    dropText: 'Select a PDF, or drag it here',
    status: 'Select a PDF to begin.',
    accept: 'application/pdf',
    multiple: false
  },
  merge: {
    buttonText: 'Merge Files',
    dropText: 'Select PDFs & Images, or drag them here',
    status: 'Select at least two files (PDFs or Images) to merge.',
    accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp',
    multiple: true
  },
  pdf2image: {
    buttonText: 'Convert to Images',
    dropText: 'Select a PDF, or drag it here',
    status: 'Select a PDF to convert to images.',
    accept: 'application/pdf',
    multiple: false
  },
  image2pdf: {
    buttonText: 'Create PDF',
    dropText: 'Select images, or drag them here',
    status: 'Select at least one image to convert to PDF.',
    accept: 'image/*',
    multiple: true
  },
  split: {
    buttonText: 'Split PDF',
    dropText: 'Select a PDF to split, or drag it here',
    status: 'Select a PDF. Choose "Each page" for ZIP or "Extract" for custom pages.',
    accept: 'application/pdf',
    multiple: false
  }
};

let mode = 'compress';
let currentFile = null;
let mergeFiles = [];
let currentBlobUrls = [];

// ---- helpers ---------------------------------------------------------------

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(bytes < 1024 ? 0 : 2)} ${sizes[i]}`;
}

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setProgress(visible, text) {
  progressEl.classList.toggle('hidden', !visible);
  if (text) progressText.textContent = text;
}

function showResult() {
  resultEl.classList.remove('hidden');
}

function hideResult() {
  resultEl.classList.add('hidden');
  revokeBlobUrls();
}

function revokeBlobUrls() {
  for (const url of currentBlobUrls) {
    URL.revokeObjectURL(url);
  }
  currentBlobUrls = [];
  downloadLink.removeAttribute('href');
  zipLink.removeAttribute('href');
}

// ---- mode toggle -----------------------------------------------------------

function setMode(next) {
  mode = next;
  const ui = MODE_UI[mode];

  modeCompress.classList.toggle('active', mode === 'compress');
  modeMerge.classList.toggle('active', mode === 'merge');
  modePdf2Image.classList.toggle('active', mode === 'pdf2image');
  modeImage2Pdf.classList.toggle('active', mode === 'image2pdf');
  modeSplit.classList.toggle('active', mode === 'split');
  modeCompress.setAttribute('aria-selected', String(mode === 'compress'));
  modeMerge.setAttribute('aria-selected', String(mode === 'merge'));
  modePdf2Image.setAttribute('aria-selected', String(mode === 'pdf2image'));
  modeImage2Pdf.setAttribute('aria-selected', String(mode === 'image2pdf'));
  modeSplit.setAttribute('aria-selected', String(mode === 'split'));

  fileInput.multiple = ui.multiple;
  fileInput.accept = ui.accept;
  dropText.textContent = ui.dropText;

  presetGroup.classList.toggle('hidden', mode !== 'compress');
  mergeOptions.classList.toggle('hidden', mode !== 'merge');
  imageOptions.classList.toggle('hidden', mode !== 'pdf2image');
  imagepdfOptions.classList.toggle('hidden', mode !== 'image2pdf');
  splitOptions.classList.toggle('hidden', mode !== 'split');
  if (splitPagesRow) splitPagesRow.classList.toggle('hidden', mode !== 'split' || splitMode.value !== 'extract');

  // Reset any selection from the previous mode.
  currentFile = null;
  mergeFiles = [];
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  fileList.classList.add('hidden');
  fileList.textContent = '';
  compressBtn.disabled = true;
  compressBtn.textContent = ui.buttonText;
  hideResult();
  setStatus(ui.status);
}

// ---- option lists ----------------------------------------------------------

function fillSelect(select, options, defaultValue) {
  select.textContent = '';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = String(opt.id);
    option.textContent = opt.label;
    select.appendChild(option);
  }
  select.value = String(defaultValue);
}

function renderOptions() {
  fillSelect(mergePageSize, PAGE_SIZE_META, 'auto');
  fillSelect(imagepdfPageSize, PAGE_SIZE_META, 'a4');
  fillSelect(imageFormat, IMAGE_FORMAT_META, 'png');
  fillSelect(imageDpi, IMAGE_DPI_META, 150);
}

function selectedPageSize(select) {
  return select.value || 'auto';
}

function renderPresets() {
  for (const preset of PRESET_META) {
    const label = document.createElement('label');
    label.className = 'preset-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'preset';
    input.value = preset.id;
    if (preset.id === 'balanced') {
      input.checked = true;
    }

    const info = document.createElement('div');
    info.className = 'preset-info';
    const name = document.createElement('strong');
    name.textContent = preset.label;
    const desc = document.createElement('small');
    desc.textContent = preset.description;
    info.appendChild(name);
    info.appendChild(desc);

    label.appendChild(input);
    label.appendChild(info);
    presetGroup.appendChild(label);
  }
}

function selectedPreset() {
  const checked = presetGroup.querySelector('input[name="preset"]:checked');
  return checked ? checked.value : 'balanced';
}

// ---- file selection ----------------------------------------------------------

/**
 * Validate a PDF by its content, never by filename or MIME type alone
 * (drag-and-drop files often have an empty MIME type, and a .pdf name can
 * carry anything).
 */
async function isPdfByContent(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    return String.fromCharCode(head[0], head[1], head[2], head[3], head[4]) === '%PDF-';
  } catch {
    return false;
  }
}

/** Keep only safe characters for the download filename. */
function sanitizeFileName(name) {
  return (name || 'document')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .replace(/\.pdf$/i, '')
    .slice(0, 80) || 'document';
}

let dragIndex = null;

function renderList() {
  fileList.classList.toggle('hidden', mergeFiles.length === 0);
  fileList.textContent = '';
  mergeFiles.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'file-list-row';
    row.draggable = true;
    row.dataset.index = String(i);

    const idx = document.createElement('span');
    idx.className = 'file-list-idx';
    idx.textContent = `${i + 1}`;

    const grip = document.createElement('span');
    grip.className = 'file-list-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const badge = document.createElement('span');
    badge.className = `file-list-badge ${isPdf ? 'pdf' : 'img'}`;
    badge.textContent = isPdf ? 'PDF' : 'IMAGE';

    const name = document.createElement('span');
    name.className = 'file-list-name';
    name.textContent = file.name;

    const size = document.createElement('span');
    size.className = 'file-list-size';
    size.textContent = formatBytes(file.size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-list-remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {
      mergeFiles.splice(i, 1);
      renderList();
      compressBtn.disabled = mergeFiles.length < (mode === 'merge' ? 2 : 1);
    });

    row.appendChild(idx);
    row.appendChild(grip);
    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(remove);

    row.addEventListener('dragstart', (e) => {
      dragIndex = i;
      row.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = dragIndex;
      const to = i;
      if (from !== null && from !== undefined && from !== to) {
        const [moved] = mergeFiles.splice(from, 1);
        mergeFiles.splice(to, 0, moved);
      }
      renderList();
    });
    row.addEventListener('dragend', () => {
      dragIndex = null;
      renderList();
    });

    fileList.appendChild(row);
  });
}

async function handleFiles(files) {
  if (!files || files.length === 0) {
    setStatus('Please select a file.', 'error');
    return;
  }

  if (mode === 'compress' || mode === 'pdf2image' || mode === 'split') {
    const file = files[0];
    if (!(await isPdfByContent(file))) {
      setStatus('The selected file is not a valid PDF (missing the %PDF- header).', 'error');
      return;
    }

    currentFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileInfo.classList.remove('hidden');
    dropText.textContent = 'Change PDF';
    compressBtn.disabled = false;
    hideResult();
    if (mode === 'split') {
      const m = splitMode ? splitMode.value : 'individual';
      setStatus(
        m === 'extract'
          ? 'PDF ready. Enter pages (e.g. 1-3, 5) and click "Split PDF".'
          : 'PDF ready. Click "Split PDF" to get each page as a separate PDF (ZIP).'
      );
    } else {
      setStatus(
        mode === 'compress'
          ? 'PDF ready. Choose a preset and click "Compress PDF".'
          : 'PDF ready. Choose a format and click "Convert to Images".'
      );
    }
    return;
  }

  // Multi-file modes: merge (PDFs & images) and image -> PDF (any images).
  let valid = [];
  if (mode === 'merge') {
    for (const file of files) {
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
      if ((await isPdfByContent(file)) || isImg) {
        valid.push(file);
      } else {
        setStatus(`Skipped "${file.name}": not a valid PDF or supported image.`, 'error');
      }
    }
  } else {
    valid = Array.from(files);
  }

  if (valid.length === 0) {
    setStatus(
      mode === 'merge' ? 'No valid PDFs or images selected.' : 'No images selected.',
      'error'
    );
    return;
  }

  mergeFiles = valid;
  renderList();
  compressBtn.disabled = mergeFiles.length < (mode === 'merge' ? 2 : 1);
  hideResult();
  setStatus(
    mode === 'merge'
      ? mergeFiles.length < 2
        ? 'Add at least one more PDF or image to merge.'
        : `Ready to merge ${mergeFiles.length} files.`
      : `Ready to create a ${mergeFiles.length}-page PDF.`
  );
}

fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(Array.from(e.dataTransfer.files));
});

modeCompress.addEventListener('click', () => setMode('compress'));
modeMerge.addEventListener('click', () => setMode('merge'));
modePdf2Image.addEventListener('click', () => setMode('pdf2image'));
modeImage2Pdf.addEventListener('click', () => setMode('image2pdf'));
modeSplit.addEventListener('click', () => setMode('split'));
if (splitMode) {
  splitMode.addEventListener('change', () => {
    if (splitPagesRow) splitPagesRow.classList.toggle('hidden', splitMode.value !== 'extract');
  });
}

// ---- ZIP writer (store method, no compression) ------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a minimal ZIP (stored entries, no compression) from named byte arrays. */
function buildZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 file names
    dv.setUint16(8, 0, true);      // method: store
    dv.setUint32(14, crc, true);
    dv.setUint32(18, bytes.length, true);
    dv.setUint32(22, bytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
    chunks.push(local, nameBytes, bytes);
    central.push({ nameBytes, crc, size: bytes.length, offset });
    offset += 30 + nameBytes.length + bytes.length;
  }

  const cdStart = offset;
  const centralChunks = [];
  for (const c of central) {
    const rec = new Uint8Array(46);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.size, true);
    dv.setUint32(24, c.size, true);
    dv.setUint16(28, c.nameBytes.length, true);
    dv.setUint32(42, c.offset, true);
    centralChunks.push(rec, c.nameBytes);
  }
  const cdSize = centralChunks.reduce((s, ch) => s + ch.length, 0);

  const end = new Uint8Array(22);
  const dvEnd = new DataView(end.buffer);
  dvEnd.setUint32(0, 0x06054b50, true);
  dvEnd.setUint16(8, entries.length, true);
  dvEnd.setUint16(10, entries.length, true);
  dvEnd.setUint32(12, cdSize, true);
  dvEnd.setUint32(16, cdStart, true);

  return new Blob([...chunks, ...centralChunks, end], { type: 'application/zip' });
}

// ---- processing ---------------------------------------------------------------

const STAGE_MESSAGES = {
  loading: 'Loading Ghostscript engine…',
  initializing: 'Initializing Ghostscript…',
  'writing-input': 'Writing input…',
  processing: 'Processing…',
  'reading-output': 'Finalizing output…',
  complete: 'Complete.'
};

function onProgress(stage, message) {
  setProgress(true, STAGE_MESSAGES[stage] || message || stage);
}

function setBusy(label) {
  compressBtn.disabled = true;
  compressBtn.textContent = label;
  hideResult();
  setStatus('');
  setProgress(true, 'Loading Ghostscript engine…');
}

function resetBusy() {
  compressBtn.disabled = false;
  compressBtn.textContent = MODE_UI[mode].buttonText;
  setProgress(false);
}

function bindSingleDownload(result, filename) {
  revokeBlobUrls();
  const blob = new Blob([result.bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  currentBlobUrls = [url];
  downloadLink.href = url;
  downloadLink.download = filename;
  downloadLink.classList.remove('hidden');
  zipLink.classList.add('hidden');
}

function renderImageResult(result, baseName) {
  revokeBlobUrls();
  imageGrid.classList.remove('hidden');
  imageGrid.textContent = '';

  const urls = result.images.map((img) => URL.createObjectURL(
    new Blob([img.bytes], { type: img.name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' })
  ));
  currentBlobUrls = urls;

  result.images.forEach((img, i) => {
    const cell = document.createElement('a');
    cell.className = 'image-cell';
    cell.href = urls[i];
    cell.download = img.name;
    cell.title = img.name;

    const thumb = document.createElement('img');
    thumb.src = urls[i];
    thumb.alt = img.name;
    thumb.loading = 'lazy';

    const label = document.createElement('span');
    label.textContent = img.name;

    cell.appendChild(thumb);
    cell.appendChild(label);
    imageGrid.appendChild(cell);
  });

  const zipBlob = buildZip(
    result.images.map((img) => ({
      name: `${sanitizeFileName(baseName)}-${img.name}`,
      bytes: img.bytes
    }))
  );
  const zipUrl = URL.createObjectURL(zipBlob);
  currentBlobUrls.push(zipUrl);
  zipLink.href = zipUrl;
  zipLink.download = `${sanitizeFileName(baseName)}-images.zip`;
  zipLink.classList.remove('hidden');
  downloadLink.classList.add('hidden');
}

async function onCompress() {
  if (!currentFile) return;
  setBusy('Compressing…');

  const arrayBuffer = await currentFile.arrayBuffer();

  try {
    const result = await compressPDF({
      file: arrayBuffer,
      preset: selectedPreset(),
      transfer: true,
      onProgress
    });

    bindSingleDownload(result, `compressed-${sanitizeFileName(currentFile.name)}.pdf`);

    resultTitle.textContent = 'Done';
    resultOutputLabel.textContent = 'Compressed';
    resultSavedLabel.textContent = 'Saved';
    originalSizeEl.textContent = formatBytes(result.originalSize);
    compressedSizeEl.textContent = formatBytes(result.compressedSize);
    savingsEl.textContent = `${(result.compressionRatio * 100).toFixed(0)}%`;
    processingNoteEl.textContent = `Processed in ${result.processingTimeMs} ms.`;

    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`Compression failed: ${err.message}`, 'error');
  } finally {
    resetBusy();
  }
}

async function onMerge() {
  if (mergeFiles.length < 2) return;
  setBusy('Preparing files…');

  const pdfBuffers = [];
  try {
    for (let i = 0; i < mergeFiles.length; i++) {
      const file = mergeFiles[i];
      const buffer = await file.arrayBuffer();
      const isPdf = await isPdfByContent(file);

      if (isPdf) {
        pdfBuffers.push(buffer);
      } else {
        setBusy(`Converting image ${i + 1} of ${mergeFiles.length} to PDF…`);
        const imgResult = await imagesToPdf({
          images: [buffer],
          pageSize: selectedPageSize(mergePageSize),
          fit: mergeFit.checked,
          transfer: false,
          onProgress: (stage, msg) => onProgress(stage, `[Image ${i + 1}] ${msg}`)
        });
        pdfBuffers.push(imgResult.bytes.buffer);
      }
    }

    setBusy('Merging documents…');
    const result = await mergePDFs({
      files: pdfBuffers,
      pageSize: selectedPageSize(mergePageSize),
      fit: mergeFit.checked,
      transfer: true,
      onProgress
    });

    bindSingleDownload(result, 'merged.pdf');

    resultTitle.textContent = 'Done';
    resultOutputLabel.textContent = 'Merged';
    resultSavedLabel.textContent = 'Items Merged';
    originalSizeEl.textContent = formatBytes(result.originalSize);
    compressedSizeEl.textContent = formatBytes(result.compressedSize);
    savingsEl.textContent = `${mergeFiles.length} files`;
    processingNoteEl.textContent =
      `Merged ${mergeFiles.length} files into a ${result.fileCount}-page PDF in ${result.processingTimeMs} ms.`;

    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`Merge failed: ${err.message}`, 'error');
  } finally {
    resetBusy();
  }
}

async function onPdf2Image() {
  if (!currentFile) return;
  setBusy('Converting…');

  const arrayBuffer = await currentFile.arrayBuffer();

  try {
    const result = await pdfToImages({
      file: arrayBuffer,
      format: imageFormat.value,
      dpi: Number(imageDpi.value),
      transfer: true,
      onProgress
    });

    renderImageResult(result, currentFile.name);

    resultTitle.textContent = `${result.count} page${result.count === 1 ? '' : 's'} rendered`;
    resultOutputLabel.textContent = 'Images';
    resultSavedLabel.textContent = 'Pages';
    originalSizeEl.textContent = formatBytes(result.originalSize);
    compressedSizeEl.textContent = `${result.count}`;
    savingsEl.textContent = formatBytes(
      result.images.reduce((sum, img) => sum + img.bytes.length, 0)
    );
    processingNoteEl.textContent = `Rendered in ${result.processingTimeMs} ms.`;

    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`Conversion failed: ${err.message}`, 'error');
  } finally {
    resetBusy();
  }
}

async function onImage2Pdf() {
  if (mergeFiles.length < 1) return;
  setBusy('Creating PDF…');

  const buffers = [];
  for (const file of mergeFiles) {
    buffers.push(await file.arrayBuffer());
  }

  try {
    const result = await imagesToPdf({
      images: buffers,
      pageSize: selectedPageSize(imagepdfPageSize),
      fit: imagepdfFit.checked,
      transfer: true,
      onProgress
    });

    bindSingleDownload(result, `${sanitizeFileName(mergeFiles[0].name)}.pdf`);

    resultTitle.textContent = 'Done';
    resultOutputLabel.textContent = 'PDF';
    resultSavedLabel.textContent = 'Pages';
    originalSizeEl.textContent = formatBytes(result.originalSize);
    compressedSizeEl.textContent = formatBytes(result.compressedSize);
    savingsEl.textContent = `${result.fileCount}`;
    processingNoteEl.textContent =
      `Created a ${result.fileCount}-page PDF in ${result.processingTimeMs} ms.`;

    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`PDF creation failed: ${err.message}`, 'error');
  } finally {
    resetBusy();
  }
}

function renderSplitResult(result, baseName) {
  revokeBlobUrls();
  if (result.parts && result.parts.length > 0) {
    // Individual pages → show ZIP + list
    imageGrid.classList.remove('hidden');
    imageGrid.textContent = '';
    const urls = result.parts.map((p) => URL.createObjectURL(new Blob([p.bytes], { type: 'application/pdf' })));
    currentBlobUrls = urls.slice();
    result.parts.forEach((p, i) => {
      const cell = document.createElement('a');
      cell.className = 'image-cell';
      cell.href = urls[i];
      cell.download = p.name;
      cell.title = p.name;
      const icon = document.createElement('div');
      icon.textContent = '📄';
      icon.style.fontSize = '32px';
      const label = document.createElement('span');
      label.textContent = p.name;
      cell.appendChild(icon);
      cell.appendChild(label);
      imageGrid.appendChild(cell);
    });
    const zipBlob = buildZip(result.parts.map((p) => ({ name: p.name, bytes: p.bytes })));
    const zipUrl = URL.createObjectURL(zipBlob);
    currentBlobUrls.push(zipUrl);
    zipLink.href = zipUrl;
    zipLink.download = `${sanitizeFileName(baseName)}-split.zip`;
    zipLink.textContent = `Download all (${result.parts.length} PDFs, ZIP)`;
    zipLink.classList.remove('hidden');
    downloadLink.classList.add('hidden');
  } else {
    bindSingleDownload(result, `${sanitizeFileName(baseName)}-extract.pdf`);
  }
}

async function onSplit() {
  if (!currentFile) return;
  const selMode = splitMode ? splitMode.value : 'individual';
  const pagesStr = splitPages ? splitPages.value.trim() : '';
  if (selMode === 'extract' && !pagesStr) {
    setStatus('Enter pages to extract, e.g. "1-3, 5"', 'error');
    return;
  }
  setBusy(selMode === 'individual' ? 'Splitting PDF…' : 'Extracting pages…');
  const buffer = await currentFile.arrayBuffer();
  try {
    const result = await splitPdf({
      file: buffer,
      mode: selMode,
      pages: pagesStr,
      transfer: true,
      onProgress
    });
    if (result.parts) {
      renderSplitResult(result, currentFile.name);
      resultTitle.textContent = `Split into ${result.count} page${result.count === 1 ? '' : 's'}`;
      resultOutputLabel.textContent = 'Parts';
      resultSavedLabel.textContent = 'Pages';
      originalSizeEl.textContent = formatBytes(result.originalSize);
      compressedSizeEl.textContent = formatBytes(result.compressedSize);
      savingsEl.textContent = `${result.count}`;
      processingNoteEl.textContent = `Split in ${result.processingTimeMs} ms.`;
    } else {
      bindSingleDownload(result, `${sanitizeFileName(currentFile.name)}-extract.pdf`);
      resultTitle.textContent = 'Done';
      resultOutputLabel.textContent = 'Extracted';
      resultSavedLabel.textContent = 'Pages';
      originalSizeEl.textContent = formatBytes(result.originalSize);
      compressedSizeEl.textContent = formatBytes(result.compressedSize);
      savingsEl.textContent = `${result.count} pages`;
      processingNoteEl.textContent = `Extracted ${result.count} page(s) in ${result.processingTimeMs} ms.`;
    }
    // Hide image grid handling for single file case is inside render/bind
    if (!result.parts) imageGrid.classList.add('hidden');
    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`Split failed: ${err.message}`, 'error');
  } finally {
    resetBusy();
  }
}

compressBtn.addEventListener('click', () => {
  if (mode === 'compress') {
    onCompress();
  } else if (mode === 'merge') {
    onMerge();
  } else if (mode === 'pdf2image') {
    onPdf2Image();
  } else if (mode === 'split') {
    onSplit();
  } else {
    onImage2Pdf();
  }
});

// Revoke any lingering object URLs when the page is unloaded.
window.addEventListener('beforeunload', revokeBlobUrls);

// ---- PWA & Theme Switcher --------------------------------------------------

// Service Worker Registration & PWA Update Notification Popup
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Check for SW updates whenever app comes into focus
      window.addEventListener('focus', () => {
        try { const p = reg.update(); if (p && p.catch) p.catch(() => {}); } catch {}
      });

      function promptUpdate(waitingWorker) {
        const updateToast = document.getElementById('update-toast');
        const updateBtn = document.getElementById('update-toast-btn');
        if (updateToast && updateBtn) {
          updateToast.classList.remove('hidden');
          updateBtn.addEventListener('click', () => {
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating…';
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
          });
        }
      }

      if (reg.waiting) {
        promptUpdate(reg.waiting);
      }

      reg.addEventListener('updatefound', () => {
        const installingWorker = reg.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate(installingWorker);
          }
        });
      });
    }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

// PWA Install Prompt
let deferredPrompt = null;
const pwaInstallBtn = document.getElementById('pwa-install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaInstallBtn) {
    pwaInstallBtn.classList.remove('hidden');
  }
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      pwaInstallBtn.classList.add('hidden');
    }
    deferredPrompt = null;
  });
}

// Theme Switcher (Light / Dark)
const themeToggleBtn = document.getElementById('theme-toggle');
const themeToggleIcon = document.getElementById('theme-toggle-icon');
const themeToggleText = document.getElementById('theme-toggle-text');
const themeColorMeta = document.getElementById('theme-color-meta');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  if (theme === 'dark') {
    if (themeToggleIcon) themeToggleIcon.textContent = '☀️';
    if (themeToggleText) themeToggleText.textContent = 'Light';
    if (themeColorMeta) themeColorMeta.setAttribute('content', '#0B0F17');
  } else {
    if (themeToggleIcon) themeToggleIcon.textContent = '🌙';
    if (themeToggleText) themeToggleText.textContent = 'Dark';
    if (themeColorMeta) themeColorMeta.setAttribute('content', '#FFFDEB');
  }
}

const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
setTheme(savedTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// ---- init ----------------------------------------------------------------------

renderPresets();
renderOptions();
setMode('compress');