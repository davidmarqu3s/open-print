/*
 * Worker lifecycle + message protocol for @project/ghostscript-wasm.
 *
 * The runtime worker (dist/runtime/ghostscript.worker.js) is a classic
 * worker that loads the Emscripten glue, the WASM engine and the preset
 * bundle, then answers { type: "compress" } messages:
 *
 *   compress  -> progress (stage) -> result {success, bytes, ...}
 *                | recycle (large job: main thread should terminate us)
 *
 * This module hides the worker from the public API: it lazily creates and
 * recycles workers, routes messages to pending promises, restarts the
 * worker after a Ghostscript failure (unrecoverable interpreter state) and
 * rejects all pending jobs when the worker crashes.
 */

import { isPreset, type Preset } from './presets.js';

export type ProgressStage =
  | 'loading'
  | 'initializing'
  | 'writing-input'
  | 'processing'
  | 'reading-output'
  | 'complete';

export interface ProgressEvent {
  stage: ProgressStage;
  message?: string;
  /** Raw progress payload from the worker (forward-compatible). */
  raw?: unknown;
}

export interface CompressOptions {
  preset?: Preset;
  onProgress?: (event: ProgressEvent) => void;
}

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  processingTimeMs: number;
  preset: Preset;
}

export interface CompressError extends Error {
  code?: string;
  gsCode?: number;
}

interface JobEntry {
  resolve: (result: CompressResult) => void;
  reject: (err: CompressError) => void;
  onProgress?: (event: ProgressEvent) => void;
}

interface WorkerResponse {
  type: 'ready' | 'progress' | 'result' | 'recycle' | 'error';
  id?: string;
  stage?: ProgressStage;
  message?: string;
  success?: boolean;
  code?: string;
  gsCode?: number;
  error?: string;
  bytes?: Uint8Array;
  originalSize?: number;
  compressedSize?: number;
  compressionRatio?: number;
  processingTimeMs?: number;
  preset?: Preset;
  recycle?: boolean;
}

type WorkerLike = {
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: unknown[]): void;
  terminate(): void;
};

let jobCounter = 0;

function generateId(): string {
  return `job-${Date.now().toString(36)}-${(jobCounter++).toString(36)}`;
}

/** The runtime worker URL relative to this compiled module (dist/worker.js). */
function runtimeWorkerUrl(): URL {
  return new URL('./runtime/ghostscript.worker.js', import.meta.url);
}

export class WorkerClient {
  private worker: WorkerLike | null = null;
  private readonly jobs = new Map<string, JobEntry>();

  /** Lazily create the worker. The WASM engine is only fetched on first use. */
  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;

    if (typeof Worker !== 'function') {
      const err = new Error(
        'No Worker global found. Run installNodeWorkerShim() (Node) or use a browser.'
      ) as CompressError;
      err.code = 'NO_WORKER';
      throw err;
    }

    const w = new Worker(runtimeWorkerUrl(), { type: 'classic' }) as unknown as WorkerLike;
    w.onmessage = (event) => this.handleMessage(event.data);
    w.onerror = () => this.handleCrash();
    this.worker = w;
    return w;
  }

  private handleMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'ready':
        return;

      case 'recycle':
        this.terminate();
        return;

      case 'progress': {
        const job = this.jobs.get(data.id ?? '');
        if (job?.onProgress) {
          job.onProgress({ stage: data.stage as ProgressStage, message: data.message, raw: data });
        }
        return;
      }

      case 'result': {
        const job = this.jobs.get(data.id ?? '');
        if (!job) return;
        this.jobs.delete(data.id as string);

        if (data.success) {
          job.resolve({
            bytes: data.bytes as Uint8Array,
            originalSize: data.originalSize as number,
            compressedSize: data.compressedSize as number,
            compressionRatio: data.compressionRatio as number,
            processingTimeMs: data.processingTimeMs as number,
            preset: (data.preset as Preset) ?? 'balanced'
          });
          if (data.recycle) this.terminate();
        } else {
          const err = new Error(data.error || 'Compression failed') as CompressError;
          err.code = data.code;
          err.gsCode = data.gsCode;
          job.reject(err);
          // Ghostscript failures can leave the interpreter unusable; restart.
          if (data.code === 'GHOSTSCRIPT_ERROR') this.terminate();
        }
        return;
      }

      case 'error':
        this.failAll(
          Object.assign(new Error(data.error || 'Worker error'), { code: 'WORKER_ERROR' })
        );
        this.terminate();
        return;

      default:
        return;
    }
  }

  private handleCrash(): void {
    this.failAll(
      Object.assign(new Error('Worker crashed'), { code: 'WORKER_CRASH' })
    );
    this.terminate();
  }

  private failAll(err: CompressError): void {
    for (const job of this.jobs.values()) job.reject(err);
    this.jobs.clear();
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Compress a PDF. The file bytes are transferred to the worker (zero
   * copy); the caller gives up ownership of `buffer`.
   */
  compress(buffer: ArrayBuffer, options: CompressOptions): Promise<CompressResult> {
    const preset = options.preset ?? 'balanced';
    if (!isPreset(preset)) {
      return Promise.reject(
        Object.assign(new Error(`Unknown preset: "${preset}"`), { code: 'INVALID_PRESET' })
      );
    }

    const w = this.ensureWorker();
    const id = generateId();

    return new Promise<CompressResult>((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onProgress: options.onProgress });
      w.postMessage({ type: 'compress', id, file: buffer, options: { preset } }, [buffer]);
    });
  }
}