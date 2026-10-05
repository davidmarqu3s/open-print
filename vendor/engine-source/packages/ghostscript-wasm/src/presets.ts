/*
 * Preset definitions for the @project/ghostscript-wasm package.
 *
 * These mirror shared/presets.js (the classic-script bundle that the
 * runtime worker loads via importScripts). Keep the two files in sync —
 * the worker validates preset names against its own copy, and the package
 * test compresses through both, so a drift in names fails the test.
 *
 * SECURITY: these are the ONLY Ghostscript argument sets the package ever
 * passes. The public API accepts a preset NAME; arbitrary arguments are
 * never accepted from application code.
 */

export type Preset = 'extreme' | 'balanced' | 'highQuality';

export interface PresetDef {
  label: string;
  description: string;
  args: readonly string[];
}

export const PRESET_NAMES: readonly Preset[] = ['extreme', 'balanced', 'highQuality'];

export const PRESETS: Record<Preset, PresetDef> = {
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

export interface PresetMeta {
  id: Preset;
  label: string;
  description: string;
}

export const PRESET_META: readonly PresetMeta[] = PRESET_NAMES.map((id) => ({
  id,
  label: PRESETS[id].label,
  description: PRESETS[id].description
}));

export function isPreset(value: unknown): value is Preset {
  return typeof value === 'string' && (PRESET_NAMES as readonly string[]).includes(value);
}