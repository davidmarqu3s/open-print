# @project/ghostscript-wasm

Browser-based PDF compression powered by Ghostscript compiled to
WebAssembly. Files are processed **locally** — they are never uploaded.

```ts
import { compressPdf } from "@project/ghostscript-wasm";

const result = await compressPdf(file, {
  preset: "balanced",
  onProgress(event) {
    console.log(event.stage); // loading | initializing | writing-input | processing | reading-output | complete
  }
});

const blob = new Blob([result.bytes], { type: "application/pdf" });
const url = URL.createObjectURL(blob);
// …trigger a download…
```

You never need to know anything about Emscripten, the WASM filesystem,
Ghostscript command-line arguments, native C APIs or worker lifecycle —
all of that is hidden behind this package.

## Install

```bash
npm install @project/ghostscript-wasm
```

The package ships a ready-to-use WASM engine in `dist/runtime/`. If you
serve it yourself, keep the four runtime files together:

```
dist/runtime/
├── ghostscript.js
├── ghostscript.wasm
├── ghostscript.worker.js
└── presets.js
```

## API

### `compressPdf(file, options): Promise<CompressResult>`

- `file` — a `File`/`Blob`, an `ArrayBuffer`, or a typed array of the PDF.
- `options.preset` — `"extreme"`, `"balanced"` (default) or `"highQuality"`.
- `options.onProgress(event)` — receives `{ stage, message }` as the job
  progresses. Stages are real milestones, never a fake percentage.

```ts
interface CompressResult {
  bytes: Uint8Array;        // the compressed PDF
  originalSize: number;
  compressedSize: number;
  compressionRatio: number; // 0..1 fraction saved
  processingTimeMs: number;
  preset: string;
}
```

Errors are `Error` objects carrying a `code`:
`INVALID_FILE`, `EMPTY_FILE`, `INVALID_PDF`, `INVALID_PRESET`,
`FILE_TOO_LARGE`, `GHOSTSCRIPT_ERROR`.

### `dispose()`

Releases the worker and the ~17 MB engine. Safe to call any time; the next
`compressPdf()` lazily creates a fresh worker.

### `PRESET_META`

Metadata (`{ id, label, description }`) for the three presets, for building
a preset picker UI.

## Presets

| Preset        | Label        | Use for |
|---------------|--------------|---------|
| `extreme`     | Extreme      | Smallest possible file; photos will degrade. |
| `balanced`    | Balanced     | Recommended default. Good quality, solid savings. |
| `highQuality` | High Quality | Preserve quality; minimal lossy processing. |

## Security

- PDFs are treated as untrusted input. Content is validated by its
  `%PDF-` signature — never by filename or MIME type alone.
- The API accepts only a preset *name*. Ghostscript arguments are fixed in
  code; arbitrary command-line arguments can never be supplied by callers.
- Every job runs in a dedicated, unique virtual filesystem path that is
  removed afterwards, so temporary files do not accumulate.
- The worker is restarted after a Ghostscript failure or a large job, so
  the interpreter never runs in a degraded state.
- No JavaScript embedded in a PDF is ever executed.

## Limits

- Inputs up to 256 MB are supported; larger files are rejected with
  `FILE_TOO_LARGE` before processing (the WASM heap is capped at 512 MB).
- No `SharedArrayBuffer`/pthreads: no COOP/COEP headers required.

## Node usage (tests/CI)

For automated tests you can run the same API under Node:

```js
import { installNodeWorkerShim } from "./node-shim.mjs"; // dist/node-shim.mjs when published
installNodeWorkerShim();
const { compressPdf } = await import("@project/ghostscript-wasm");
```

## Build

```bash
# From the repo root: build the WASM engine first
bash scripts/build.sh

# Then build this package (tsc + copy runtime assets into dist/runtime)
cd packages/ghostscript-wasm
npm install
npm run build
npm test
```

## License

AGPL-3.0 (matches Ghostscript). See `LICENSE` in the repository root.