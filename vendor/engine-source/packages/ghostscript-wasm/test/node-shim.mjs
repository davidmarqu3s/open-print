/*
 * Node test shim: provide a browser-like `Worker` global backed by
 * `node:worker_threads` so the package's public API can be exercised in
 * Node (the CI runner and local developers) without a browser.
 *
 * Import this module and call installNodeWorkerShim() BEFORE importing the
 * package. The shim loads the classic worker source (the same file the
 * browser uses) inside the Node worker via an eval bootstrap that provides
 * `self`, `importScripts` and `postMessage`.
 */

import { Worker as NodeWorker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Directory containing the runtime assets copied by scripts/copy-runtime.js. */
const RUNTIME_DIR = fileURLToPath(new URL('../dist/runtime/', import.meta.url));

const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

globalThis.__dirname = workerData.dist;
globalThis.require = require;
globalThis.process = process;

globalThis.importScripts = function (...urls) {
  for (const url of urls) {
    (0, eval)(fs.readFileSync(path.resolve(workerData.dist, url), 'utf8'));
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

export function installNodeWorkerShim() {
  if (typeof globalThis.Worker !== 'undefined') return;

  class WorkerShim {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.inner = new NodeWorker(BOOTSTRAP, { eval: true, workerData: { dist: RUNTIME_DIR } });
      this.inner.on('message', (msg) => {
        if (this.onmessage) this.onmessage({ data: msg });
      });
      this.inner.on('error', (err) => {
        if (this.onerror) this.onerror(err);
      });
    }

    postMessage(message, transfer) {
      this.inner.postMessage(message, transfer);
    }

    terminate() {
      return this.inner.terminate();
    }
  }

  globalThis.Worker = WorkerShim;
}