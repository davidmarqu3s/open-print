# Ghostscript WebAssembly PDF Compression Engine

A reproducible, browser-based WebAssembly build of the current stable
Ghostscript release. It compresses PDF files **locally, in the browser**
inside a Web Worker using Ghostscript's `pdfwrite` device. Files are never
uploaded.

## Highlights

- **Fully offline** — Ghostscript runs as WASM in a Web Worker. No server
  round-trip, no file upload.
- **Three closed presets** — the API accepts only preset *names*
  (`extreme`, `balanced`, `highQuality`). Raw Ghostscript arguments are
  hard-coded in `shared/presets.js` and are never accepted from the main
  thread.
- **Lazy loading** — the worker and the ~17 MB WASM engine are only fetched
  on the *first* compress call. Loading the page fetches nothing but the
  HTML/CSS/JS.
- **Honest progress** — progress messages describe real stages
  (`loading → initializing → writing-input → processing → reading-output →
  complete`), never a fake percentage.
- **Memory-safe** — inputs over 256 MB are rejected up-front; after very
  large jobs the worker signals `recycle` and the main thread replaces it
  so the heap is never left bloated.
- **No special headers** — no `SharedArrayBuffer`, no pthreads, so no
  COOP/COEP response headers are required.

## Workflow

```
Browser
  ↓
User selects input.pdf + preset
  ↓
Web Worker loads Ghostscript WASM (first compress only)
  ↓
PDF is written into the WASM virtual filesystem
  ↓
Ghostscript processes the PDF using pdfwrite (preset args)
  ↓
Compressed output.pdf is generated
  ↓
Result bytes are returned to the main thread
  ↓
Browser downloads compressed.pdf
```

## Supported formats

- **Input:** PDF
- **Output:** PDF
- **Primary device:** `pdfwrite`

## Presets

The worker and the Node tests share a single source of truth:
`shared/presets.js` (copied to `dist/presets.js` at build time). It defines
the only Ghostscript argument sets the engine will ever run. They are
ordered most → least aggressive:

| Preset        | Label        | Image downsampling | JPEG quality | Use for |
|---------------|--------------|--------------------|--------------|---------|
| `extreme`     | Extreme      | 60 DPI (bicubic)   | 35           | Smallest possible file; photos will degrade. |
| `balanced`    | Balanced     | 110 DPI (bicubic)  | 75           | **Recommended default.** Good quality, solid savings. |
| `highQuality` | High Quality | 300 / 600 DPI      | 92           | Preserve quality; minimal lossy processing. |

All presets keep page count and text, embed/subset fonts, and compress
pages. Images are auto-filtered (Flate for flat graphics, JPEG for photos).
Fix the doc/library, or recompile, when you touch presets. See
`BUILD_FEATURES.md` for the surrounding device/feature configuration.

## Quick start

### Build with Docker (recommended)

```bash
docker build -t ghostscript-wasm .
docker run --rm -v "$PWD:/project" ghostscript-wasm
```

The generated artifacts are written to `dist/`:

```
dist/
├── ghostscript.js          WASM glue (CommonJS module factory)
├── ghostscript.wasm        the ~17 MB engine
├── ghostscript.worker.js   web worker (message protocol)
├── presets.js              preset definitions (loaded by the worker)
└── package.json            {"type": "commonjs"} so Node ESM can import it
```

### Local build (requires Emscripten)

```bash
# Download the pinned Ghostscript source
bash scripts/download-source.sh

# Build
bash scripts/build.sh

# Test (C-wrapper integration test + worker protocol test)
bash scripts/test.sh

# Benchmark (sizes, time, page count, visual-quality proxy)
npm run benchmark
```

### Interactive debugging

If the build fails, open an interactive shell in the container to inspect
logs and iterate on configure flags or patches:

```bash
bash scripts/debug-shell.sh
# inside the container:
bash scripts/build.sh
```

### Try the demo page

```bash
npm run serve
# open http://localhost:8080
```

Drag a PDF onto the page, pick a preset, and download the result. Open the
browser's network tab: nothing is fetched until you click **Compress**, and
no request ever leaves the page.

## Browser API

The recommended client entry point is `web/gs-compress.js` (copy it plus
`dist/presets.js` into your app). It manages the worker lifecycle.

```js
import { compressPDF, PRESET_META, dispose } from './gs-compress.js';

const result = await compressPDF({
  file: arrayBuffer,          // ArrayBuffer of the PDF
  preset: 'balanced',         // one of PRESET_META ids
  transfer: true,             // zero-copy into the worker (default true)
  onProgress: (stage, message) => {
    // stage: loading | initializing | writing-input | processing |
    //        reading-output | complete
    console.log(stage, message);
  }
});

// result:
// {
//   bytes: Uint8Array,          // the compressed PDF
//   originalSize: number,
//   compressedSize: number,
//   compressionRatio: number,   // 0..1 fraction saved
//   processingTimeMs: number,
//   preset: string
// }

const blob = new Blob([result.bytes], { type: 'application/pdf' });
// …create an object URL and trigger a download…

dispose(); // terminate the worker + release ~17 MB; next call lazily recreates it
```

The worker itself (raw protocol) accepts:

```js
worker.postMessage(
  { type: 'compress', id: 'job-1', file: arrayBuffer, options: { preset: 'balanced' } },
  [arrayBuffer] // optional zero-copy transfer
);
// worker -> main thread:
//   { type: 'ready' }
//   { type: 'progress', id, stage, message }
//   { type: 'result', id, success: true, bytes, originalSize,
//     compressedSize, compressionRatio, processingTimeMs, preset, recycle }
//   { type: 'recycle', id }      // main thread should terminate this worker
//   { type: 'result', id, success: false, code, error }
```

Error codes: `INVALID_FILE`, `EMPTY_FILE`, `FILE_TOO_LARGE`, `INVALID_PDF`
(missing `%PDF-` header), `INVALID_PRESET`, `GHOSTSCRIPT_ERROR`.

### Safety limits

- Inputs larger than **256 MB** are rejected up-front (`FILE_TOO_LARGE`) —
  the WASM heap is capped at 512 MB and `pdfwrite` needs several times the
  input size.
- After a job whose input was ≥ 64 MB or whose heap reached ≥ 384 MB, the
  worker posts `recycle`; the client terminates it and a fresh one is
  created on the next call.
- `INITIAL_MEMORY` is 64 MB; the heap grows on demand up to 512 MB.

## Package (`@project/ghostscript-wasm`)

A publishable TypeScript package (`packages/ghostscript-wasm`) wraps the
engine with a single clean API. Consumers never see Emscripten, the WASM
filesystem, Ghostscript argv or the worker lifecycle.

```ts
import { compressPdf } from "@project/ghostscript-wasm";

const result = await compressPdf(file, {
  preset: "balanced",
  onProgress(event) {
    console.log(event.stage);
  }
});

const blob = new Blob([result.bytes], { type: "application/pdf" });
```

Build it from the repo root (after building the WASM engine):

```bash
npm run build:package   # npm install + tsc + copy runtime assets
npm run test:package    # runs the package's own end-to-end test
```

See `packages/ghostscript-wasm/README.md` for the full API.

## Integration with Next.js

Copy the contents of `dist/` into your project's public folder, for example
`public/ghostscript/`, so the runtime can resolve the worker, the `.wasm`
file and `presets.js` from the same directory.

### 1. Copy artifacts

```bash
cp dist/ghostscript.js           my-next-app/public/ghostscript/
cp dist/ghostscript.wasm         my-next-app/public/ghostscript/
cp dist/ghostscript.worker.js    my-next-app/public/ghostscript/
cp dist/presets.js               my-next-app/public/ghostscript/
```

### 2. Use in a client component

```tsx
'use client';

import { useCallback } from 'react';

async function compressPdf(inputBytes: Uint8Array, preset = 'balanced'): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/ghostscript/ghostscript.worker.js');

    worker.onmessage = (event) => {
      const { type, success, bytes, error } = event.data;
      if (type === 'result') {
        worker.terminate();
        if (success) resolve(bytes);
        else reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    worker.postMessage({
      type: 'compress',
      id: crypto.randomUUID(),
      file: inputBytes.buffer, // ArrayBuffer
      options: { preset }
    }, [inputBytes.buffer]);
  });
}

export default function PdfCompressor() {
  const onFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const input = new Uint8Array(await file.arrayBuffer());
    const output = await compressPdf(input, 'balanced');

    const blob = new Blob([output], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'compressed.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return <input type="file" accept="application/pdf" onChange={onFileChange} />;
}
```

### Notes

- The worker must be loaded from a URL co-located with `ghostscript.js`,
  `ghostscript.wasm` and `presets.js`. Keep all four files in the same
  public directory.
- This build does **not** use `SharedArrayBuffer` or pthreads, so no
  special COOP/COEP response headers are required.
- See `worker/ghostscript.worker.js` for the full message protocol and
  `shared/presets.js` for the preset definitions.

## Repository structure

```
ghostscript-wasm/
├── README.md
├── LICENSE
├── versions.env
├── package.json
├── Dockerfile
├── docker-compose.yml
├── scripts/          Build, test, benchmark, sample-compression and dev-server scripts
├── patches/          Source patches for Emscripten compatibility
├── native/           C wrapper around libgs (gs_process_pdf_argv, gs_run, …)
├── shared/           Preset definitions (single source of truth)
├── worker/           Web Worker loader + message protocol
├── web/              Demo HTML/JS/CSS + client API (gs-compress.js)
├── packages/         @project/ghostscript-wasm (TypeScript package)
├── tests/            Input PDFs + integration / feature / worker protocol tests
├── dist/             Generated WASM artifacts
└── .github/workflows Build + release-check CI/CD
```

## Tests & benchmark

- `tests/integration.test.js` — loads the WASM module and compresses each
  test PDF with every preset through the C wrapper, asserting valid output
  and sane ratios.
- `tests/features.test.js` — the acceptance tests: multi-page PDFs keep
  their page count; image-heavy PDFs come out smaller; text-heavy PDFs stay
  readable (text is extracted with the `txtwrite` device and compared);
  corrupt input yields a controlled error, never a crash; and three
  sequential jobs leave no temporary files in the WASM filesystem.
- `tests/worker.test.js` — runs the real worker file inside a Node
  `worker_thread` shim and checks the message contract: ready, progress
  stages, success results, and graceful rejection of unknown preset / empty
  file / over-limit file / non-PDF / non-buffer payloads.
- `packages/ghostscript-wasm/test/package.test.js` — exercises the public
  package API end to end (progress events, invalid inputs, `dispose()`).
- `scripts/benchmark.js` — records size, compression %, time, page-count
  preservation and a visual-quality proxy (renders page 1 to PNG at 150 DPI
  via `gs_run`) for every input × preset.
- `scripts/sample-compress.js` — compresses one PDF through the real worker
  pipeline; used by CI as an end-to-end smoke test.

Current reference numbers (mozilla/pdf.js corpus, see `tests/input/README.md`):

| Input         | extreme | balanced | highQuality |
|---------------|---------|----------|-------------|
| simple.pdf    | 82.1%   | 82.1%    | 80.5%       |
| images.pdf    | 31.6%   | 30.5%    | 28.6%       |
| large.pdf     | 86.9%   | 86.9%    | 86.1%       |

All outputs preserve the page count and render at ~100% of the original.

## Security (PDFs are untrusted input)

- **No JS execution** — JavaScript embedded in a PDF is never executed.
  Ghostscript runs as WASM inside a sandboxed worker with `-dSAFER`; the
  browser application has no PDF-JS interpreter.
- **Closed argument surface** — the public API accepts only a preset
  *name*. Ghostscript arguments are fixed in `shared/presets.js`; arbitrary
  command-line arguments can never be supplied by application code, and
  the `gs_run` dev entry point is never exposed through the worker.
- **Content validation** — input is validated by its `%PDF-` signature
  (`INVALID_PDF`), never by filename, MIME type alone, or metadata.
- **Unique temp paths** — every job writes to a fresh `/work/job-<id>`
  directory and removes it in a `finally` block, so temporary files do not
  accumulate.
- **Crash recovery** — a worker crash rejects all pending jobs and the
  worker is terminated; a Ghostscript failure also restarts the worker
  because the interpreter may be in an unrecoverable state. The next call
  lazily creates a fresh worker.
- **Size guard** — inputs over 256 MB are rejected before processing.

## Versioning

All versions are pinned in `versions.env`. The current build uses:

- **Ghostscript:** 10.07.1 (released 2026-05-19)
- **Emscripten:** 6.0.7 (released 2026-08-17)

Do not change these versions without re-validating the build.

## Build feature notes

See `BUILD_FEATURES.md` for the list of enabled/disabled features and
the rationale for each.

## License

This build tooling and wrapper are licensed under the GNU Affero General
Public License v3 (AGPL-3.0) to match Ghostscript's license. The resulting
WASM artifact contains Ghostscript and is therefore also AGPL-licensed.
Commercial licenses for Ghostscript are available from Artifex Software.