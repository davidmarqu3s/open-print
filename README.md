# Open Print

![Open Print converts RGB Figma artwork into a print-ready CMYK PDF](docs/images/open-print-thumbnail.png)

Open Print is an open-source Figma plugin that exports selected frames as a vector CMYK PDF. Conversion runs entirely inside the plugin, so you don’t need a server or companion app.

The plugin code is licensed under GNU AGPL v3. Bundled third-party ICC profiles keep their own licenses, which is why this repository is private.

> **Experimental.** The automated tests and the full export pipeline pass, and both a single PDF and consecutive individual PDFs have been saved successfully in Figma desktop. Save to a writable local folder: a read-only destination, such as some Google Drive folders, can fail silently after the Save dialog closes.

## Install

1. Download `open-print-v0.2.10.zip` from [Releases](https://github.com/davidmarqu3s/open-print/releases) and extract it to a folder you’ll keep.
2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select the extracted `manifest.json`.

## Export a PDF

1. Select one or more frames and run **Plugins → Development → Open Print**.
2. Keep **Use frame size** on, or enter your final width and height. Use **Units** to switch between **mm** and **in**.
3. If you selected several frames, choose an option under **Export as**:
   - **One multipage PDF** (default) is named after the first frame.
   - **Individual PDFs** are named after each frame and open one Save dialog at a time. Save or cancel each dialog to move on; **Cancel** skips that file. Duplicate names get a numbered suffix, and path separators and control characters become underscores. If the plugin can’t detect a dialog, it pauses; export again to retry.
4. Choose a colour profile (one of the 15 included, **No profile**, or **Custom CMYK profile…**) and click **Export CMYK PDF**. Figma then asks where to save the file.

Use the CMYK ICC profile your printer supplies or approves, because each profile produces different CMYK values. With a profile selected, it controls the conversion and is embedded in the PDF. With **No profile**, Ghostscript converts to DeviceCMYK using its default conversion and no ICC OutputIntent is embedded.

## Print sizing

Dimensions default to millimetres. Switching **Units** only changes how sizes are displayed, never the physical print size. Inches convert at exactly 25.4 mm, and switching back and forth doesn’t accumulate rounding errors.

Figma frames carry no physical size, so the plugin uses Figma’s native PDF scale of **72 frame units per inch**, converted to mm and rounded to 0.01 mm. Each selected frame gets its own page size.

For example, a 907 × 1276 frame becomes 319.97 × 450.14 mm. If you meant 320 × 450 mm, enter that. Typing a size turns off automatic sizing and applies your size to every page. Manual sizes persist when the selection changes.

Artwork stays at its native size, aligned to the top left. Changing the page size moves the PDF page edges: a larger page adds space and a smaller one crops. The plugin never resizes or edits your Figma layers. Frames with shadows or blurs are exported from a temporary scaled copy that is deleted straight away (see below).

## What’s supported

- **Frames:** 1 to 32 per export, ordered numerically by name.
- **Vectors:** vector paths are kept for supported artwork.
- **Colour:** ICC conversion, with an optional embedded CMYK OutputIntent.
- **Images:** raster images stay raster and are never downsampled.
- **Gradients:** linear, radial, angular and diamond gradients (including on text, strokes and with opacity) export as vector CMYK gradients. Left alone, Ghostscript would rasterise RGB gradients at about 180 ppi and drop angular and diamond gradients entirely. Instead, each gradient is converted to DeviceCMYK first, using Ghostscript’s own conversion of the same colours on a hidden probe page. Gradients therefore match flat colours under every profile and stay resolution-independent.
- **Effects:** drop shadow, inner shadow, layer blur and background blur. Figma bakes these into 144 ppi bitmaps when exporting PDFs, so frames that use them are exported from a temporary copy scaled up about 2.1× and scaled back down, giving roughly 300 ppi at print size. The copy is removed immediately afterwards. Frames longer than about 1,370 mm, or files where Figma won’t allow the copy (such as view-only files), fall back to a lower resolution, and the plugin tells you. Other effects, such as noise or texture, are rejected before export.
- **Marks and boxes:** crop marks already in your artwork are kept, but the plugin doesn’t add bleed or marks. MediaBox, CropBox, TrimBox and BleedBox all match the final page size.
- **Text:** exported as vector outlines, so it isn’t editable in Illustrator. Hidden font layers are omitted, and stray close-path commands are cleaned up. Simple vector alpha masks use white mask paint so they import consistently into Illustrator, without changing artwork colours or luminosity masks.
- **Not supported yet:** PDF/X certification, spot colours and overprint controls.

### Engine download and privacy

On your first export in a session, the plugin downloads a pinned Ghostscript WebAssembly engine from its public GitHub repository and checks its size and SHA-256 checksum before running it. This needs an internet connection; later exports in the same session reuse the engine. Your artwork and PDFs are never uploaded.

The manifest allows network access to that one engine URL only. All 15 ICC profiles are bundled with lossless compression, and the build fails if the controller and UI code together exceed 15,000,000 bytes.

## Build and test

Requires Node 18 or later. Dependencies are vendored, so there is nothing to install. Build first, because the tests read from `dist/`:

```sh
npm run build
npm test
```

Then import `manifest.json` in Figma desktop.

The automated tests cover sizing, CMYK profile validation and embedding, vector content, vector CMYK gradients (using captured Figma export structures), scaled effect export, preflight, export order, automatic and manual sizing, and a check that original nodes are never modified. A three-page browser test on real designs also verified CMYK values, preserved vectors and embedded ICC data against a reference export. Sample artwork is not included.

## Colour profiles

The profile menu groups these 15 profiles by region, using their official ICC description names:

| Region | Profile |
| --- | --- |
| Europe | PSO Coated v3 |
| Europe | ISO Coated v2 (ECI) |
| Europe | eciCMYK v2 |
| Europe | ISO Coated v2 300% (ECI) |
| Europe | Coated FOGRA39 (ISO 12647-2:2004) |
| North America | U.S. Web Coated (SWOP) v2 |
| North America | Coated GRACoL 2006 (ISO 12647-2:2004) |
| North America | Web Coated SWOP 2006 Grade 3 Paper |
| North America | Web Coated SWOP 2006 Grade 5 Paper |
| Japan | Japan Color 2011 Coated |
| Japan | Japan Color 2001 Coated |
| Japan | Japan Color 2003 Web Coated |
| Japan | Japan Color 2001 Uncoated |
| Japan | Japan Color 2002 Newspaper |
| Japan | Japan Web Coated (Ad) |

All 15 ICC files live in `vendor/profiles/` and are bundled automatically, so they work without importing anything.

If a build leaves a profile out, select it and import its ICC file; the file’s internal name must match. Imported profiles are saved in Figma client storage for your account on that device, within Figma’s [5 MB storage quota](https://developers.figma.com/docs/plugins/api/figma-clientStorage/). If storage is full, the profile still works for the current session and the plugin tells you it couldn’t be saved. Profiles are only used locally and are embedded unchanged in exported PDFs. For custom profiles, the ICC description becomes the embedded profile name when one is available.

You can get ECI profiles from [ECI downloads](https://eci.org/doku.php_id%3Den_downloads.html), Adobe profiles from an existing Adobe installation or [Adobe downloads](https://www.adobe.com/support/downloads/iccprofiles/iccprofiles_win.html), and Japan Color 2011 from [Japan Color](https://japancolor.jp/icc.html). Follow each supplier’s license terms. On macOS, Adobe’s profiles are usually in `/Library/Application Support/Adobe/Color/Profiles/` and its `Recommended` subfolder.

Because ICC files have their own distribution terms, the repository and releases stay private. See [profile sources and notices](vendor/profiles/README.md).

### Custom builds

`npm run build` bundles the profiles listed in `vendor/profiles/paths.json`.

To build with your own copies of the profiles, create a local JSON file that maps catalogue IDs from `src/profiles.json` to absolute ICC file paths, then run:

```sh
node build.mjs --profiles /path/to/local-profile-paths.json
```

The builder checks each file’s CMYK header and exact description name. Any profile you leave out can still be imported in the plugin. To preload a single custom CMYK profile instead:

```sh
node build.mjs --profile /path/to/printer-profile.icc
```

Generated UI files stay out of Git. The repository includes a portable path map with relative paths; keep machine-specific path maps out of Git, and don’t redistribute the bundled profiles without permission.

The manifest uses Open Print’s Figma-assigned plugin ID. If you publish your own fork to the Community, replace it with an ID Figma assigns to you. See [Figma’s manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

## Dependencies

- **Ghostscript 10.07.1:** AGPL. The complete corresponding source, including the original source tarball, is in `open-print-v0.2.2-source.zip`, attached to the [v0.2.2 release](https://github.com/davidmarqu3s/open-print/releases/tag/v0.2.2). The engine hasn’t changed since, so that archive still applies to the current release.
- **WASM wrapper and build sources:** [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools) at pinned commit `51131feb82b37ad51687718889b788bf425ce594`. Its source files, scripts, patches and build configuration are in `vendor/engine-source/`; duplicate generated engine binaries are left out.
- **fflate 0.8.2:** MIT. Used for ZIP packaging; [upstream source](https://github.com/101arrowz/fflate/tree/v0.8.2).
- **js-sha256 0.11.1:** MIT. Verifies SHA-256 checksums in JavaScript, so the plugin doesn’t depend on Web Crypto in Figma’s sandbox; [upstream source](https://github.com/emn178/js-sha256/tree/v0.11.1).
- **pdf-lib 1.17.1:** MIT. Bundled UMD build and license; [upstream source](https://github.com/Hopding/pdf-lib/tree/v1.17.1).

### Rebuilding the engine

1. Unpack `open-print-v0.2.2-source.zip`.
2. In `vendor/engine-source`, create a `src` folder and extract `ghostscript-10.07.1.tar.gz` into it.
3. Run `scripts/build.sh` using the included Dockerfile, or Emscripten 6.0.7 with the documented dependencies.
4. Copy `dist/ghostscript.js` and `dist/ghostscript.wasm` into the plugin’s `vendor/` folder, then rebuild the plugin.

The upstream engine build hasn’t been rerun for this project yet.

Checksums:

```text
ghostscript.wasm
5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36

ghostscript-10.07.1.tar.gz
2fc74362f9be6fae1b0a65d38fdcfd4f0b518cc3b07c5581fb661eb4d2e15251
```

If you redistribute a modified version, keep the applicable licenses and provide the corresponding source. ICC files have their own terms, separate from the plugin’s source license.
