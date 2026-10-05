/*
 * Feature tests (Tests 2-7 of the acceptance plan), run at the C-wrapper
 * level against the WASM module:
 *
 *   Test 2  Multi-page PDF  — page count is preserved.
 *   Test 3  Image-heavy PDF — output is smaller than the input.
 *   Test 4  Text-heavy PDF  — the output remains readable (txtwrite
 *            text extraction matches the original).
 *   Test 5  Corrupt input   — a controlled error is returned, never a
 *            crash or a hang.
 *   Test 6  Large file      — graceful rejection when the input exceeds
 *            the safety limit (covered by tests/worker.test.js, which
 *            drives the real worker through its FILE_TOO_LARGE guard).
 *   Test 7  Sequential jobs — PDF A, PDF B, PDF C processed back to back
 *            with no temporary files accumulating in the WASM filesystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadModule,
  getPresets,
  compressBytes,
  isValidPdf,
  countPages,
  extractText,
  tokenContainment,
  tokenize
} from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'output');

const inputs = {
  simple: await fs.readFile(path.join(INPUT_DIR, 'simple.pdf')),
  images: await fs.readFile(path.join(INPUT_DIR, 'images.pdf')),
  large: await fs.readFile(path.join(INPUT_DIR, 'large.pdf'))
};

const MIN_TEXT_CONTAINMENT = 0.9;

let failures = 0;

function check(name, fn) {
  return fn().then(
    () => console.log(`✓ ${name}`),
    (err) => {
      failures++;
      console.error(`✗ ${name}: ${err.message}`);
    }
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const module = await loadModule(DIST);
  const presets = getPresets();
  const presetNames = Object.keys(presets);

  // Test 2 — multiple pages: page count preserved for every input/preset.
  for (const [name, bytes] of Object.entries(inputs)) {
    const originalPages = countPages(bytes);
    for (const preset of presetNames) {
      await check(`Test 2 (multi-page): ${name} @ ${preset} keeps ${originalPages} pages`, async () => {
        const r = await compressBytes(module, bytes, preset);
        assert(r.code === 0, `Ghostscript exited with code ${r.code}`);
        assert(isValidPdf(r.bytes), 'output is not a valid PDF');
        assert(
          countPages(r.bytes) === originalPages,
          `page count changed: ${countPages(r.bytes)} != ${originalPages}`
        );
        await fs.writeFile(
          path.join(OUTPUT_DIR, `${name}-${preset}.pdf`),
          r.bytes
        );
      });
    }
  }

  // Test 3 — image-heavy PDF: output is smaller.
  for (const preset of presetNames) {
    await check(`Test 3 (image-heavy): images.pdf @ ${preset} is smaller`, async () => {
      const r = await compressBytes(module, inputs.images, preset);
      assert(r.code === 0, `Ghostscript exited with code ${r.code}`);
      assert(
        r.compressedSize < r.originalSize,
        `output (${r.compressedSize}) not smaller than input (${r.originalSize})`
      );
      assert(r.compressionRatio > 0.2, `compression ratio too low: ${r.compressionRatio}`);
    });
  }

  // Test 4 — text-heavy PDF: output remains readable.
  const originalText = await extractText(module, inputs.large);
  assert(originalText && tokenize(originalText).length > 100, 'original text extraction too small to compare');
  for (const preset of presetNames) {
    await check(`Test 4 (text-heavy): large.pdf @ ${preset} keeps its text`, async () => {
      const r = await compressBytes(module, inputs.large, preset);
      assert(r.code === 0, `Ghostscript exited with code ${r.code}`);
      const compressedText = await extractText(module, r.bytes);
      assert(compressedText !== null, 'txtwrite failed on the compressed PDF');
      const containment = tokenContainment(originalText, compressedText);
      assert(
        containment >= MIN_TEXT_CONTAINMENT,
        `extracted text only retains ${(containment * 100).toFixed(1)}% of the original's words ` +
        `(need >= ${MIN_TEXT_CONTAINMENT * 100}%)`
      );
    });
  }

  // Test 5 — corrupt input: the system returns a controlled error or a
  // valid repaired output — never a crash or a hang.
  //
  // (a) Non-PDF bytes: rejected before processing (wrong %PDF- header) —
  //     at the C-wrapper level Ghostscript returns a non-zero code.
  for (const preset of presetNames) {
    await check(`Test 5 (corrupt): non-PDF bytes @ ${preset} -> controlled error`, async () => {
      const r = await compressBytes(
        module,
        Buffer.from('this is definitely not a pdf document at all'),
        preset
      );
      assert(r.code !== 0, `expected a non-zero exit code, got 0 (garbage was accepted)`);
      assert(r.bytes.length === 0, 'no output bytes should be produced for non-PDF input');
    });
  }

  // (b) PDFs with a valid header but a broken body: Ghostscript is lenient
  //     and usually repairs them (yielding a valid PDF); otherwise it
  //     errors. Either outcome is controlled — it must not crash or hang.
  const headerCorrupt = [
    Buffer.from(inputs.simple.subarray(0, Math.floor(inputs.simple.length * 0.4))),
    Buffer.from('%PDF-1.4\n%%EOF\n')
  ];
  for (const preset of presetNames) {
    for (let i = 0; i < headerCorrupt.length; i++) {
      await check(`Test 5 (corrupt): header'd sample ${i + 1} @ ${preset} -> controlled outcome`, async () => {
        const r = await compressBytes(module, headerCorrupt[i], preset);
        if (r.code !== 0) {
          assert(r.bytes.length === 0, 'a failing job should produce no output bytes');
        } else {
          assert(isValidPdf(r.bytes), 'a repaired job must still output a valid PDF');
        }
      });
    }
  }

  // Test 7 — sequential jobs: PDF A, B, C with no /work accumulation.
  const jobs = [
    { name: 'PDF A', bytes: inputs.simple, preset: presetNames[0] },
    { name: 'PDF B', bytes: inputs.images, preset: presetNames[1] || presetNames[0] },
    { name: 'PDF C', bytes: inputs.large, preset: presetNames[2] || presetNames[0] }
  ];

  for (const job of jobs) {
    await check(`Test 7 (sequential): ${job.name} @ ${job.preset} leaves /work clean`, async () => {
      const r = await compressBytes(module, job.bytes, job.preset);
      assert(r.code === 0, `Ghostscript exited with code ${r.code}`);
      assert(isValidPdf(r.bytes), 'output is not a valid PDF');
      const entries = module.FS.readdir('/work').filter((e) => e !== '.' && e !== '..');
      assert(
        entries.length === 0,
        `/work should be empty after the job, found: ${entries.join(', ')}`
      );
    });
  }

  if (failures > 0) {
    console.error(`\n${failures} feature test failure(s).`);
    process.exit(1);
  }

  console.log('\nAll feature tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});