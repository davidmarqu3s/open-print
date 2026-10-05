/*
 * Node.js integration test for the Ghostscript WASM module.
 *
 * Validates the full pipeline against the C wrapper directly:
 *   input PDF -> virtual FS -> gs_process_pdf_argv(preset args) -> output PDF
 *
 * The preset definitions (shared/presets.js) are the same closed set the
 * web worker uses.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModule, getPresets, compressBytes, mergeBytes, buildImagesPdf, pdfToImageBytes, isValidPdf, extractText, tokenContainment, splitPdfIndividual, extractPdfPages } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'output');

const INPUTS = ['simple.pdf', 'images.pdf', 'large.pdf'];

async function run() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const module = await loadModule(DIST);
  const presets = getPresets();
  const presetNames = Object.keys(presets);

  let failures = 0;

  for (const inputName of INPUTS) {
    const inputPath = path.join(INPUT_DIR, inputName);
    const inputBytes = await fs.readFile(inputPath);

    for (const preset of presetNames) {
      const outputPath = path.join(OUTPUT_DIR, `${inputName.replace(/\.pdf$/, '')}-${preset}.pdf`);

      try {
        const result = await compressBytes(module, inputBytes, preset);

        if (result.code !== 0) {
          throw new Error(`Ghostscript exited with code ${result.code}`);
        }
        if (!isValidPdf(result.bytes)) {
          throw new Error('Output is not a valid PDF (bad magic bytes)');
        }
        if (!(result.compressionRatio >= 0 && result.compressionRatio <= 1)) {
          throw new Error(`compressionRatio out of range: ${result.compressionRatio}`);
        }

        await fs.writeFile(outputPath, result.bytes);

        const saved = (result.compressionRatio * 100).toFixed(1);
        console.log(
          `✓ ${inputName} @ ${preset}: ${result.originalSize} -> ${result.compressedSize} bytes ` +
          `(${saved}% saved, ${result.processingTimeMs} ms)`
        );
      } catch (err) {
        failures++;
        console.error(`✗ ${inputName} @ ${preset}: ${err.message}`);
      }
    }
  }

  // Merge: concatenate several PDFs into one via gs_process_pdfs.
  {
    const mergeInputs = ['simple.pdf', 'images.pdf', 'large.pdf'];
    const mergeBytesArr = [];
    for (const name of mergeInputs) {
      mergeBytesArr.push(await fs.readFile(path.join(INPUT_DIR, name)));
    }

    try {
      const merged = await mergeBytes(module, mergeBytesArr);

      if (merged.code !== 0) {
        throw new Error(`Merge exited with code ${merged.code}`);
      }
      if (!isValidPdf(merged.bytes)) {
        throw new Error('Merged output is not a valid PDF (bad magic bytes)');
      }
      if (merged.bytes.length === 0) {
        throw new Error('Merged output is empty');
      }

      // Every input document must actually be present in the merged output
      // (guards against a merge that silently drops all but the first file).
      const mergedText = await extractText(module, merged.bytes);
      if (!mergedText) {
        throw new Error('Could not extract text from the merged output');
      }
      for (const name of mergeInputs) {
        const inputBytes = await fs.readFile(path.join(INPUT_DIR, name));
        const inputText = await extractText(module, inputBytes);
        if (inputText) {
          const containment = tokenContainment(inputText, mergedText);
          if (containment < 0.8) {
            throw new Error(
              `${name} text not preserved in merged output (containment ${containment.toFixed(3)})`
            );
          }
        }
      }

      const outputPath = path.join(OUTPUT_DIR, 'merged-simple-images-large.pdf');
      await fs.writeFile(outputPath, merged.bytes);

      console.log(
        `✓ merge simple+images+large: ${merged.originalSize} -> ${merged.compressedSize} bytes ` +
        `(${merged.processingTimeMs} ms)`
      );
    } catch (err) {
      failures++;
      console.error(`✗ merge simple+images+large: ${err.message}`);
    }
  }

  // Merge with a fixed page size (A4 + fit-to-page).
  {
    const inputs = ['simple.pdf', 'images.pdf', 'large.pdf'];
    const arr = [];
    for (const name of inputs) {
      arr.push(await fs.readFile(path.join(INPUT_DIR, name)));
    }

    try {
      const merged = await mergeBytes(module, arr, { pageSize: 'a4', fit: true });

      if (merged.code !== 0) {
        throw new Error(`Merge (A4) exited with code ${merged.code}`);
      }
      if (!isValidPdf(merged.bytes)) {
        throw new Error('Merged (A4) output is not a valid PDF (bad magic bytes)');
      }

      const outputPath = path.join(OUTPUT_DIR, 'merged-a4-fit.pdf');
      await fs.writeFile(outputPath, merged.bytes);

      console.log(
        `✓ merge simple+images+large (A4 fit): ${merged.originalSize} -> ` +
        `${merged.compressedSize} bytes (${merged.processingTimeMs} ms)`
      );
    } catch (err) {
      failures++;
      console.error(`✗ merge A4+fit: ${err.message}`);
    }
  }

  // PDF -> image: rasterize simple.pdf to PNG via gs_run.
  {
    const simple = await fs.readFile(path.join(INPUT_DIR, 'simple.pdf'));

    try {
      const res = await pdfToImageBytes(module, simple, { format: 'png', dpi: 150 });

      if (res.code !== 0) {
        throw new Error(`PDF->PNG exited with code ${res.code}`);
      }
      if (res.count !== 1) {
        throw new Error(`Expected 1 page, got ${res.count}`);
      }
      const png = res.images[0].bytes;
      const magic = String.fromCharCode(png[0], png[1], png[2], png[3]);
      if (magic !== '\x89PNG') {
        throw new Error('Output is not a PNG (bad magic bytes)');
      }

      const outputPath = path.join(OUTPUT_DIR, 'simple-page-1.png');
      await fs.writeFile(outputPath, png);

      console.log(`✓ PDF->PNG: 1 page, ${png.length} bytes`);
    } catch (err) {
      failures++;
      console.error(`✗ PDF->PNG: ${err.message}`);
    }
  }

  // Image -> PDF: render a page to JPEG, embed it with the pure-JS writer,
  // then confirm Ghostscript can re-read the produced PDF (round trip).
  {
    const simple = await fs.readFile(path.join(INPUT_DIR, 'simple.pdf'));

    try {
      const rendered = await pdfToImageBytes(module, simple, { format: 'jpeg', dpi: 96 });
      if (rendered.code !== 0 || rendered.count !== 1) {
        throw new Error(`Render to JPEG failed: code ${rendered.code}, ${rendered.count} images`);
      }

      const pdfBytes = buildImagesPdf([rendered.images[0].bytes], { pageSize: 'a4', fit: true });

      if (!isValidPdf(pdfBytes)) {
        throw new Error('Image->PDF output is not a valid PDF (bad magic bytes)');
      }

      // Ghostscript must be able to read the JS-produced PDF back.
      const back = await pdfToImageBytes(module, pdfBytes, { format: 'png', dpi: 72 });
      if (back.code !== 0 || back.count !== 1) {
        throw new Error(
          `Ghostscript could not read the image->PDF output ` +
          `(code ${back.code}, ${back.count} pages)`
        );
      }

      const outputPath = path.join(OUTPUT_DIR, 'image-to-pdf-a4.pdf');
      await fs.writeFile(outputPath, pdfBytes);

      console.log(
        `✓ image->PDF round trip (A4 fit): ${rendered.images[0].bytes.length} -> ` +
        `${pdfBytes.length} bytes, GS re-read ok`
      );
    } catch (err) {
      failures++;
      console.error(`✗ image->PDF round trip: ${err.message}`);
    }
  }

  // Split: individual pages and extract range
  {
    const simple = await fs.readFile(path.join(INPUT_DIR, 'simple.pdf'));
    const images = await fs.readFile(path.join(INPUT_DIR, 'images.pdf'));
    const merged = await mergeBytes(module, [simple, images]);
    if (merged.code !== 0) {
      failures++;
      console.error('✗ split: could not create multi-page source');
    } else {
      try {
        const parts = await splitPdfIndividual(module, merged.bytes);
        if (parts.length < 2) throw new Error(`expected >=2 parts, got ${parts.length}`);
        for (const p of parts) if (!isValidPdf(p.bytes)) throw new Error(`part ${p.name} not valid PDF`);
        console.log(`✓ split individual: ${parts.length} parts`);
      } catch (err) {
        failures++;
        console.error(`✗ split individual: ${err.message}`);
      }
      try {
        const extracted = await extractPdfPages(module, merged.bytes, '1');
        if (!isValidPdf(extracted)) throw new Error('extracted not valid PDF');
        console.log('✓ split extract (page 1): ok');
      } catch (err) {
        failures++;
        console.error(`✗ split extract: ${err.message}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }

  console.log('\nAll integration tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});