/*
 * Public API for @project/ghostscript-wasm.
 *
 *   import { compressPdf } from '@project/ghostscript-wasm';
 *
 *   const result = await compressPdf(file, {
 *     preset: 'balanced',
 *     onProgress(event) { console.log(event.stage); }
 *   });
 *
 *   const blob = new Blob([result.bytes], { type: 'application/pdf' });
 *
 * Everything implementation-specific (Emscripten, the WASM filesystem,
 * Ghostscript argv, the worker lifecycle) stays hidden behind this module.
 */

import {
  PRESETS,
  PRESET_NAMES,
  PRESET_META,
  isPreset,
  type Preset,
  type PresetDef,
  type PresetMeta
} from './presets.js';
import { WorkerClient, type CompressOptions, type CompressResult, type ProgressEvent } from './worker.js';

export {
  PRESETS,
  PRESET_NAMES,
  PRESET_META,
  isPreset,
  type Preset,
  type PresetDef,
  type PresetMeta,
  type CompressOptions,
  type CompressResult,
  type ProgressEvent
};

let client: WorkerClient | null = null;

function getClient(): WorkerClient {
  if (!client) client = new WorkerClient();
  return client;
}

export type PdfInput = File | Blob | ArrayBuffer | ArrayBufferView;

function toArrayBuffer(input: PdfInput): ArrayBuffer | Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice()
      .buffer as ArrayBuffer;
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return input.arrayBuffer();
  }
  throw Object.assign(new Error('compressPdf: unsupported input type'), { code: 'INVALID_FILE' });
}

function hasPdfSignature(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  return (
    String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0, head[4] ?? 0) ===
    '%PDF-'
  );
}

/**
 * Compress a PDF entirely in the browser (or Node, with the test shim).
 *
 * @param file   A File/Blob, an ArrayBuffer, or a typed array of the PDF.
 * @param options preset name + optional onProgress callback.
 * @returns The compressed PDF bytes and metadata.
 */
export async function compressPdf(
  file: PdfInput,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const preset = options.preset ?? 'balanced';
  if (!isPreset(preset)) {
    throw Object.assign(new Error(`Unknown preset: "${preset}"`), { code: 'INVALID_PRESET' });
  }

  const buffer = await toArrayBuffer(file);
  if (buffer.byteLength === 0) {
    throw Object.assign(new Error('The selected file is empty.'), { code: 'EMPTY_FILE' });
  }
  if (!hasPdfSignature(buffer)) {
    throw Object.assign(
      new Error('The selected file is not a valid PDF (missing the %PDF- header).'),
      { code: 'INVALID_PDF' }
    );
  }

  return getClient().compress(buffer, options);
}

/**
 * Release the worker and the WASM engine (~17 MB). Safe to call any time;
 * the next compressPdf() lazily creates a fresh worker.
 */
export function dispose(): void {
  if (client) {
    client.terminate();
    client = null;
  }
}

/** Whether the engine has been loaded (a worker exists). */
export function isLoaded(): boolean {
  return client !== null;
}