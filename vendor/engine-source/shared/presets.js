/*
 * Compression preset definitions — single source of truth.
 *
 * This file is intentionally a plain script (no ESM import/export) so it
 * works in BOTH environments:
 *
 *   - Classic web worker: loaded with importScripts('./presets.js');
 *     exposes the bundle as a global `GSPresets`.
 *   - Node (tests/scripts): importing it as a module executes it and the
 *     global side-effect sets `globalThis.GSPresets` (the package is
 *     "type": "module", so the CommonJS branch is skipped there).
 *
 * SECURITY: these are the ONLY Ghostscript arguments the web API ever
 * passes. The public API accepts a preset NAME; arbitrary arguments are
 * never accepted from untrusted website code. Do not add a way to inject
 * raw arguments from the main thread.
 *
 * Presets are ordered most aggressive -> least aggressive.
 */

(function (root) {
  'use strict';

  var PRESETS = {
    extreme: {
      label: 'Extreme',
      description: 'Smallest file size. Aggressive downsampling and JPEG.',
      args: [
        '-dPDFSETTINGS=/screen',
        '-dColorImageResolution=60',
        '-dGrayImageResolution=60',
        '-dMonoImageResolution=150',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dColorImageFilter=/DCTEncode',
        '-dGrayImageFilter=/DCTEncode',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=35',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    },

    balanced: {
      label: 'Balanced',
      description: 'Recommended default. Good quality with solid savings.',
      args: [
        '-dPDFSETTINGS=/ebook',
        '-dColorImageResolution=110',
        '-dGrayImageResolution=110',
        '-dMonoImageResolution=300',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=75',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    },

    highQuality: {
      label: 'High Quality',
      description: 'Preserve quality. Minimal lossy processing.',
      args: [
        '-dPDFSETTINGS=/printer',
        '-dColorImageResolution=300',
        '-dGrayImageResolution=300',
        '-dMonoImageResolution=600',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=92',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    }
  };

  var PRESET_NAMES = Object.freeze(['extreme', 'balanced', 'highQuality']);

  /*
   * Closed set of page sizes. `w`/`h` are the media box in PostScript
   * points (used by the image->PDF writer); `args` are the Ghostscript
   * switches used when merging PDFs onto a fixed page size. `auto` keeps
   * each page at its original size (PDF merge) or makes the page exactly
   * the image size (image->PDF).
   *
   * Only these names are ever accepted from the web UI; the raw
   * Ghostscript switches never leave this file.
   */
  var PAGE_SIZES = Object.freeze({
    auto: Object.freeze({ label: 'Original size', args: [], w: 0, h: 0 }),
    a4: Object.freeze({
      label: 'A4 (210 × 297 mm)',
      args: ['-sPAPERSIZE=a4'],
      w: 595.28,
      h: 841.89
    }),
    letter: Object.freeze({
      label: 'Letter (8.5 × 11 in)',
      args: ['-sPAPERSIZE=letter'],
      w: 612,
      h: 792
    }),
    legal: Object.freeze({
      label: 'Legal (8.5 × 14 in)',
      args: ['-sPAPERSIZE=legal'],
      w: 612,
      h: 1008
    }),
    executive: Object.freeze({
      label: 'Executive (7.25 × 10.5 in)',
      args: ['-sPAPERSIZE=executive'],
      w: 522,
      h: 756
    }),
    a3: Object.freeze({
      label: 'A3 (297 × 420 mm)',
      args: ['-sPAPERSIZE=a3'],
      w: 841.89,
      h: 1190.55
    })
  });
  var PAGE_SIZE_NAMES = Object.freeze(['auto', 'a4', 'letter', 'legal', 'executive', 'a3']);

  /* Closed set of rasterization resolutions for PDF -> image. */
  var IMAGE_DPIS = Object.freeze({
    72: Object.freeze({ label: '72 dpi (draft)', args: ['-r72'] }),
    150: Object.freeze({ label: '150 dpi', args: ['-r150'] }),
    300: Object.freeze({ label: '300 dpi (print)', args: ['-r300'] })
  });
  var IMAGE_DPI_NAMES = Object.freeze([72, 150, 300]);

  /* Closed set of raster image formats for PDF -> image. */
  var IMAGE_FORMATS = Object.freeze({
    png: Object.freeze({ label: 'PNG', device: 'png16m' }),
    jpeg: Object.freeze({ label: 'JPEG', device: 'jpeg' })
  });
  var IMAGE_FORMAT_NAMES = Object.freeze(['png', 'jpeg']);

  var bundle = Object.freeze({
    PRESETS: PRESETS,
    PRESET_NAMES: PRESET_NAMES,
    PAGE_SIZES: PAGE_SIZES,
    PAGE_SIZE_NAMES: PAGE_SIZE_NAMES,
    IMAGE_DPIS: IMAGE_DPIS,
    IMAGE_DPI_NAMES: IMAGE_DPI_NAMES,
    IMAGE_FORMATS: IMAGE_FORMATS,
    IMAGE_FORMAT_NAMES: IMAGE_FORMAT_NAMES
  });

  root.GSPresets = bundle;

  // CommonJS consumers (e.g. Node scripts running outside "type": "module").
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = bundle;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
