# Open Print

![Open Print converts RGB Figma artwork into a print-ready CMYK PDF](docs/images/open-print-thumbnail.png)

Open Print is an open-source Figma plugin that exports selected frames as vector CMYK PDFs. Conversion runs inside the plugin, so you don’t need a server or companion app.

## Install

1. Download the `open-print-v….zip` file from the [latest release](https://github.com/davidmarqu3s/open-print/releases/latest) and extract it to a folder you’ll keep.
2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select the extracted `manifest.json`.

## Export a PDF

1. Select up to 32 frames and run **Plugins → Development → Open Print**.
2. Keep **Use frame size** on, or enter a width and height. The **mm**/**in** menu next to **Page size** switches units.
3. With several frames, choose **One multipage PDF** or **Individual PDFs** under **Export as**. Individual PDFs open one Save dialog per frame.
4. Under **Color profile**, choose your printer’s CMYK profile, **No profile** or **Custom CMYK profile…**, then click **Export CMYK PDF**.

The profile controls the conversion and is embedded in the PDF. With **No profile**, Ghostscript’s default DeviceCMYK conversion is used and no profile is embedded.

## Page size

Figma frames have no physical size, so the plugin uses Figma’s PDF scale of 72 frame units per inch. A 907 × 1276 frame becomes 319.97 × 450.14 mm. When a frame is within 0.5 mm of a standard size, such as A3 or Letter, a **Use A3**-style button enters the exact size. A typed size applies to every page. Artwork stays at its native size, aligned top left, so a larger page adds space and a smaller one crops.

## Bleed and crop marks

Enter a bleed (3 mm by default) and click **Add bleed**. Each frame gets a locked **Bleed** layer holding its background, and **Clip content** is turned off, so you can drag images past the edge and see exactly what will print. Change the amount and press Return to resize it. **Remove bleed** puts everything back. The frame is always the trim size.

Tick **Crop marks** to add Registration marks outside the bleed, with your own offset, length and thickness. The PDF’s TrimBox, BleedBox and MediaBox are set to match.

## What’s supported

- **Vectors and text** stay vector. Text is exported as outlines.
- **Colour** is converted from sRGB with relative colorimetric and black point compensation. No RGB is left in the file.
- **Images** are converted to CMYK without downsampling. The plugin warns you if any image is below 300 ppi at print size.
- **Gradients** (linear, radial, angular and diamond) export as vector CMYK and match flat colours under every profile.
- **Shadows and blurs** are exported at about 300 ppi from a temporary scaled copy that is deleted straight afterwards.
- **Noise and texture** layers become 300 ppi images, including any text inside them, so put noise on a background shape if you want text to stay vector.
- **Other effects**, such as glass, are listed before export, with a **Show** button to find the layer.
- **Not supported yet:** PDF/X, spot colours and overprint.

Exporting never changes your Figma layers. Only **Add bleed** edits the file.

## Privacy and network

On your first export, the plugin downloads a pinned Ghostscript engine from this repository and checks its SHA-256 checksum before running it. It stays in memory until you close the plugin. That download is the plugin’s only network request: your artwork and PDFs are never uploaded, and there are no analytics.

## Colour profiles

15 CMYK profiles are included: PSO Coated v3, ISO Coated v2 (ECI), ISO Coated v2 300% (ECI), eciCMYK v2, Coated FOGRA39, U.S. Web Coated (SWOP) v2, Coated GRACoL 2006, Web Coated SWOP 2006 Grade 3 and Grade 5, Japan Color 2011 Coated, Japan Color 2001 Coated and Uncoated, Japan Color 2002 Newspaper, Japan Color 2003 Web Coated and Japan Web Coated (Ad).

To use another profile, choose **Custom CMYK profile…** and import its ICC file. Imported profiles are saved on your device in Figma’s plugin storage.

## Build and test

Requires Node 18 or later, with nothing to install. Build before testing, because the tests read `dist/`:

```sh
npm run build
npm test
```

Every pull request runs the same checks on GitHub Actions. See [docs/development.md](docs/development.md) for custom profile builds, rebuilding the engine and releasing.

## Licences

The plugin is licensed under [GNU AGPL v3](LICENSE).

- **Ghostscript 10.07.1:** AGPL. The complete corresponding source is in the `open-print-v…-source.zip` file attached to every [release](https://github.com/davidmarqu3s/open-print/releases).
- **WASM build:** based on [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools) at commit `51131fe`; its sources are in `vendor/engine-source/`.
- **pdf-lib 1.17.1** and **js-sha256 0.11.1:** MIT.
- **ICC profiles:** each keeps its supplier’s own terms. See [profile sources and notices](vendor/profiles/README.md).

If you redistribute a modified version, keep these licences and provide the corresponding source.
