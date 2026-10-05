# Build Features

This document tracks which Ghostscript features are enabled or disabled
in the WebAssembly build and why.

## Enabled features

| Feature | Why it is needed |
|---|---|
| PDF interpreter | Required to read input PDFs. |
| `pdfwrite` device | Required to produce compressed output PDFs. |
| Core image decoders (JPEG, PNG, TIFF, BMP) | Common image formats embedded in PDFs. |
| Font handling (Type 1, TrueType, CID, CFF) | Required for proper text rendering and subsetting. |
| PostScript interpreter subset | Ghostscript uses PostScript internally for many operations. |
| Bundled libraries | The Emscripten toolchain cannot link against host system libraries, so Ghostscript's bundled zlib, libpng, jpeg, lcms2mt, freetype, jbig2dec, openjpeg and brotli sources are used. |

## Disabled features

| Feature | Disabled with | Why disabled | Impact on PDF compression |
|---|---|---|---|
| X11 | `--without-x` | Browser has no X11 display. | None. |
| CUPS | `--disable-cups` | No printer spooler in browser. | None. |
| DBus | `--disable-dbus` | No desktop bus in browser. | None. |
| GTK/GUI | `--disable-gtk` | No native GUI in browser. | None. |
| Fontconfig | `--disable-fontconfig` | Uses host font database; not available/sensible in browser. FreeType remains enabled. | None; fonts embedded in PDFs are still handled. |
| PCL interpreter | `--without-pcl` | Only PDF input is required. | None. |
| XPS interpreter | `--without-xps` | Only PDF input is required. | None. |
| Tesseract / OCR | `--without-tesseract` | OCR is not required for compression and pulls in threading code. | None. |
| Dynamic loading | `--disable-dynamic` | Dynamic linking is unavailable in WASM. | Reduces binary size and avoids runtime loading. |

## Binary size impact

Disabling X11, CUPS, DBus, GUI, PCL, XPS, Tesseract and dynamic loading
significantly reduces the final `.wasm` size and removes
platform-specific code paths that cannot execute in a browser. The
`pdfwrite` device and PDF interpreter remain fully functional.

## Future considerations

- If additional input formats (PCL/XPS) are needed later, re-enable them
  individually and re-test the PDF output path.
- Further size reductions may be possible by disabling additional output
  devices, but each must be validated against the `input.pdf → pdfwrite →
  output.pdf` workflow.
