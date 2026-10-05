# Test PDFs

These are real PDF files downloaded from public sources for integration
testing. They are not committed as generated minimal PDFs.

| File | Source | Size | Description |
|---|---|---|---|
| `simple.pdf` | [mozilla/pdf.js test corpus](https://github.com/mozilla/pdf.js/blob/master/test/pdfs/160F-2019.pdf) | ~321 KB | Simple document (PDF 1.7) |
| `images.pdf` | [mozilla/pdf.js test corpus](https://github.com/mozilla/pdf.js/blob/master/test/pdfs/tracemonkey.pdf) | ~992 KB | Document with text and images (PDF 1.4) |
| `large.pdf` | [mozilla/pdf.js test corpus](https://github.com/mozilla/pdf.js/blob/master/test/pdfs/Brotli-Prototype-FileA.pdf) | ~1.27 MB | Larger document with mixed content (PDF 2.0) |

The PDF.js test files are used under the terms of the Apache License 2.0
(Mozilla PDF.js project). They are used here solely for non-commercial
automated testing of the Ghostscript WASM compression engine.

To re-download these files, run:

```bash
curl -L -o tests/input/simple.pdf  https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/160F-2019.pdf
curl -L -o tests/input/images.pdf  https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf
curl -L -o tests/input/large.pdf   https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/Brotli-Prototype-FileA.pdf
```
