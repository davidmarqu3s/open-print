# Open Print

![Open Print converts RGB Figma artwork into a print-ready CMYK PDF](docs/images/open-print-thumbnail.png)

Open Print is an open-source Figma plugin that exports selected frames and components as vector CMYK PDFs. Conversion runs inside the plugin, so you don’t need a server or companion app.

## Install

1. Download the `open-print-v….zip` file from the [latest release](https://github.com/davidmarqu3s/open-print/releases/latest) and extract it to a folder you’ll keep.
2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select the extracted `manifest.json`.

To try changes before they’re released, download `open-print-latest.zip` from the [latest build](https://github.com/davidmarqu3s/open-print/releases/tag/latest-build) instead. It’s rebuilt from `main` after every merge and may be less stable.

## Export a PDF

1. Select up to 32 frames or components and run **Plugins → Development → Open Print**.
2. The page size follows the frame. To use another size, enter a width and height; **Reset to frame size** brings the frame size back. The **mm**/**in** menu next to **Page size** switches units.
3. With several frames, choose **One multipage PDF** or **Individual PDFs** under **Export as**. Individual PDFs open one Save dialog per frame.
4. Under **Color profile**, choose your printer’s CMYK profile, **No profile** or **Custom CMYK profile…**, then click **Export CMYK PDF**.

The profile controls the conversion and is embedded in the PDF. With **No profile**, Ghostscript’s default DeviceCMYK conversion is used and no profile is embedded.

## Page size

Figma frames have no physical size, so the plugin uses Figma’s PDF scale of 72 frame units per inch. A 907 × 1276 frame becomes 319.97 × 450.14 mm. When a frame is within 0.5 mm (0.2% on large sheets) of a standard size, such as A3 or Letter, a **Use A3**-style button enters the exact size. A typed size applies to every page, and each frame’s artwork scales to fit it, centred. Vectors stay sharp; noise, textures and other effects are rendered for the printed size, and the low-resolution warning allows for the scale. Scaling down also shrinks the bleed, so if less than 3 mm would be left, export waits until you click **Use … bleed** to enlarge it on the canvas.

To start a design at a standard size, click **+** next to **Frames** and pick a size: A0 to A6, DL, business card, 50 × 70 or 70 × 100 cm poster, Letter or Tabloid. The frame is created at the exact size in the middle of your view and selected.

## Bleed and crop marks

Click **+** next to **Bleed** to add 3 mm of bleed, rounded to the nearest whole pixel (9 px, 3.18 mm). Each frame gets a locked **Bleed** layer holding its background, and **Clip content** is turned off, so you can drag images past the edge and see exactly what will print. A locked **Trim** layer outlines the original frame edge and doesn’t print. While the plugin is open, it moves back on top when you add layers. The amount then appears: change it and press Return to resize the bleed. Click **−** to remove it and put everything back. The frame is always the trim size.

Components take bleed the same way, and their instances follow it. An instance can’t take bleed of its own, because Figma doesn’t allow new layers in instances, so the plugin offers to select its main component instead.

Click **+** next to **Crop marks** to add Registration marks outside the bleed, with your own offset, length and thickness. The PDF’s TrimBox, BleedBox and MediaBox are set to match.

## What’s supported

- **Vectors and text** stay vector. Text is exported as outlines.
- **Colour** is converted from sRGB with relative colorimetric and black point compensation. No RGB is left in the file.
- **Images** are converted to CMYK without downsampling. The plugin warns you if any image is below 300 ppi at print size.
- **Gradients** (linear, radial, angular and diamond) export as vector CMYK and match flat colours under every profile.
- **Shadows and blurs** are exported at about 300 ppi from a temporary scaled copy that is deleted straight afterwards.
- **Noise and texture** layers become 300 ppi images, including any text inside them, so put noise on a background shape if you want text to stay vector.
- **Other effects**, such as glass, are listed before export, with a **Show** button to find the layer.
- **Pure black** (#000000) text and shapes print in black ink only (100% K) and overprint, like InDesign’s [Black], so small type stays sharp. Figma exports text as outlines, so the plugin can’t treat text and shapes differently. For rich black on large areas, use a near-black such as #0A0A0A, or untick **Pure black as 100% K**.
- **PDF/X-4** is on by default when a profile is chosen: the file is PDF 1.6 with the profile as its output intent, trim and bleed boxes, and the PDF/X-4 metadata printers check for.
- **Not supported yet:** PDF/X-1a, spot colours, and overprint other than pure black.

Exporting never changes your Figma layers. Only adding bleed edits the file.

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

- **Ghostscript 10.07.1:** AGPL. The complete corresponding source is in the `-source.zip` file attached to every [release](https://github.com/davidmarqu3s/open-print/releases), including the latest build. It is the unmodified [Ghostscript 10.07.1 source](https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/ghostscript-10.07.1.tar.gz) plus the build files in `vendor/engine-source/`.
- **WASM build:** based on [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools) at commit `51131fe`; its sources are in `vendor/engine-source/`.
- **pdf-lib 1.17.1** and **js-sha256 0.11.1:** MIT.
- **ICC profiles:** each keeps its supplier’s own terms. See [profile sources and notices](vendor/profiles/README.md).

If you redistribute a modified version, keep these licences and provide the corresponding source.
