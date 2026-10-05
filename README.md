# Open Print

![Open Print converts RGB Figma artwork into a print-ready CMYK PDF](docs/images/open-print-thumbnail.png)

Open Print is an open-source Figma plugin that exports selected frames as a vector CMYK PDF. Conversion runs entirely inside the plugin, so you don’t need a server or companion app.

The plugin code is licensed under GNU AGPL v3. Bundled third-party ICC profiles keep their own licences, set by their suppliers; see [Colour profiles](#colour-profiles).

> **Experimental.** The automated tests and the full export pipeline pass, and both a single PDF and consecutive individual PDFs have been saved successfully in Figma desktop. Save to a writable local folder: a read-only destination, such as some Google Drive folders, can fail silently after the Save dialog closes.

## Install

1. Download the `open-print-v….zip` file from the [latest release](https://github.com/davidmarqu3s/open-print/releases/latest) and extract it to a folder you’ll keep.
2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select the extracted `manifest.json`.

## Export a PDF

1. Select one or more frames and run **Plugins → Development → Open Print**.
2. Keep **Use frame size** on, or enter your final width and height. Use the **mm**/**in** menu next to **Page size** to switch units.
3. If you selected several frames, choose an option under **Export as**:
   - **One multipage PDF** (default) is named after the first frame.
   - **Individual PDFs** are named after each frame and open one Save dialog at a time. Save or cancel each dialog to move on; **Cancel** skips that file. Duplicate names get a numbered suffix, and path separators and control characters become underscores. If the plugin can’t detect a dialog, it pauses; export again to retry.
4. Under **Color profile**, choose a profile (one of the 15 included, **No profile**, or **Custom CMYK profile…**) and click **Export CMYK PDF**. Figma then asks where to save the file.

Use the CMYK ICC profile your printer supplies or approves, because each profile produces different CMYK values. With a profile selected, it controls the conversion and is embedded in the PDF. With **No profile**, Ghostscript converts to DeviceCMYK using its default conversion and no ICC OutputIntent is embedded.

## Print sizing

Dimensions default to millimetres. Switching between mm and in only changes how sizes are displayed, never the physical print size. Inches convert at exactly 25.4 mm, and switching back and forth doesn’t accumulate rounding errors.

Figma frames carry no physical size, so the plugin uses Figma’s native PDF scale of **72 frame units per inch**, converted to mm and rounded to 0.01 mm. Each selected frame gets its own page size.

For example, a 907 × 1276 frame becomes 319.97 × 450.14 mm. If you meant 320 × 450 mm, enter that. When a frame is within 0.5 mm of a standard size (A0–A6, DL, B1–B5, SRA3, 50 × 70 cm and 70 × 100 cm posters, Letter, Legal, Tabloid or a business card), a **Use A3**-style button enters the exact size for you. Typing a size turns off automatic sizing and applies your size to every page. Manual sizes persist when the selection changes.

Artwork stays at its native size, aligned to the top left. Changing the page size moves the PDF page edges: a larger page adds space and a smaller one crops. Exporting never resizes or edits your Figma layers; only **Add bleed** changes the file (see below). Frames with shadows or blurs are exported from a temporary scaled copy that is deleted straight away (see below).

## Bleed and crop marks

Bleed is built on the canvas, so you can see it before exporting. Select frames, enter a bleed (3 mm by default) and click **Add bleed**. To resize it, change the amount and press Return. Each frame gets a locked **Bleed** layer at the bottom, sized to the trim plus the bleed on every side, and the frame’s background fills move onto it. **Clip content** is turned off, so images placed past the frame edge show exactly as they will print. The dashed red outline marks the bleed edge and is never exported. Once a frame has bleed, the same button reads **Remove bleed**: it moves the background back onto the frame, removes the layer and restores clipping.

The frame is always the trim size. Anything beyond the bleed edge is cut from the PDF.

Tick **Crop marks** to add marks outside the bleed. Set their offset from the trim, length and thickness (0.25 pt by default). The offset can’t be smaller than the bleed, so marks never sit on artwork. Marks print in Registration on every plate. The plugin shows the final PDF page size, and sets the TrimBox to the frame, the BleedBox to the trim plus bleed and the MediaBox to the whole sheet.

## What’s supported

- **Frames:** 1 to 32 per export, ordered numerically by name.
- **Vectors:** vector paths are kept for supported artwork.
- **Colour:** ICC conversion from sRGB using relative colorimetric with black point compensation (the Adobe default), with an optional embedded CMYK OutputIntent. No RGB colour spaces are left in the file.
- **Images:** photos and other raster images are converted to CMYK pixel by pixel, stay raster and are never downsampled or recompressed lossily. If any image is below 300 ppi at its printed size, the plugin tells you after export.
- **Gradients:** linear, radial, angular and diamond gradients (including on text, strokes and with opacity) export as vector CMYK gradients. Left alone, Ghostscript would rasterise RGB gradients at about 180 ppi and drop angular and diamond gradients entirely. Instead, each gradient is converted to DeviceCMYK first, using Ghostscript’s own conversion of the same colours on a hidden probe page. Gradients therefore match flat colours under every profile and stay resolution-independent.
- **Effects:** drop shadow, inner shadow, layer blur and background blur. Figma bakes these into 144 ppi bitmaps when exporting PDFs, so frames that use them are exported from a temporary copy scaled up about 2.1× and scaled back down, giving roughly 300 ppi at print size. The copy is removed immediately afterwards. Frames longer than about 1,370 mm, or files where Figma won’t allow the copy (such as view-only files), fall back to a lower resolution, and the plugin tells you.
- **Noise and texture:** Figma can’t draw these in a PDF, so in the temporary copy each layer that uses them is replaced with a 300 ppi image of the layer, which is then converted to CMYK with the rest of the page. Everything inside that layer becomes part of the image, including text, so put noise on a background shape rather than the whole frame if you want text to stay vector. Images are capped at 4,096 pixels on their longest side (about 347 mm at 300 ppi), and larger layers come out at a lower resolution, which the plugin tells you. Noise and texture need the temporary copy, so they can’t be exported from view-only files.
- **Other effects,** such as glass, are rejected before export. Each one is listed under its frame, with a **Show** button that zooms to the layer.
- **Marks and boxes:** see [Bleed and crop marks](#bleed-and-crop-marks). Without bleed or marks, MediaBox, CropBox, TrimBox and BleedBox all match the final page size.
- **Text:** exported as vector outlines, so it isn’t editable in Illustrator. Hidden font layers are omitted, and stray close-path commands are cleaned up. Simple vector alpha masks use white mask paint so they import consistently into Illustrator, without changing artwork colours or luminosity masks.
- **Not supported yet:** PDF/X certification, spot colours and overprint controls.

### Engine download and privacy

On your first export in a session, the plugin downloads a pinned Ghostscript WebAssembly engine from this repository on GitHub (`vendor/ghostscript.wasm` at commit `436f731`) and checks its size and SHA-256 checksum before running it. This needs an internet connection. The engine is kept in memory, not saved to disk, so later exports reuse it until you close the plugin. Your artwork and PDFs are never uploaded, and the plugin makes no other network requests and has no analytics.

The manifest allows network access to that one engine URL only. All 15 ICC profiles are bundled with lossless compression, and the build fails if the controller and UI code together exceed 15,000,000 bytes.

## Build and test

Requires Node 18 or later. Dependencies are vendored, so there is nothing to install. Build first, because the tests read from `dist/`:

```sh
npm run build
npm test
```

Then import `manifest.json` in Figma desktop.

Every pull request and every push to `main` runs the same build and tests on GitHub Actions (the **test** check, on Node 22).

The automated tests cover sizing, CMYK profile validation and embedding, vector content, vector CMYK gradients (using captured Figma export structures), scaled effect export, noise and texture rasterising, bleed and crop marks, image resolution and leftover RGB colour spaces, PDF clean-up, the engine download and checksum, preflight, export order, automatic and manual sizing, the plugin panel, and a check that original nodes are never modified. A three-page browser test on real designs also verified CMYK values, preserved vectors and embedded ICC data against a reference export. Sample artwork is not included.

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

You can get ECI profiles from [ECI downloads](https://eci.org/doku.php_id%3Den_downloads.html), Adobe profiles from an existing Adobe installation or [Adobe downloads](https://www.adobe.com/support/downloads/iccprofiles/iccprofiles_win.html), and Japan Color 2011 from [Japan Color](https://japancolor.jp/icc.html). Follow each supplier’s licence terms. On macOS, Adobe’s profiles are usually in `/Library/Application Support/Adobe/Color/Profiles/` and its `Recommended` subfolder.

ICC files have their own distribution terms, separate from the plugin’s AGPL licence, and they differ by supplier. See [profile sources and notices](vendor/profiles/README.md).

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

- **Ghostscript 10.07.1:** AGPL. The complete corresponding source, including the original source tarball, is in the `open-print-v…-source.zip` file attached to every [release](https://github.com/davidmarqu3s/open-print/releases).
- **WASM wrapper and build sources:** [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools) at pinned commit `51131feb82b37ad51687718889b788bf425ce594`. Its source files, scripts, patches and build configuration are in `vendor/engine-source/`; duplicate generated engine binaries are left out. The engine binary built from it is `vendor/ghostscript.wasm`, and the plugin downloads it from this repository, so exports don’t depend on the upstream repository staying online.
- **js-sha256 0.11.1:** MIT. Verifies SHA-256 checksums in JavaScript, so the plugin doesn’t depend on Web Crypto in Figma’s sandbox; [upstream source](https://github.com/emn178/js-sha256/tree/v0.11.1).
- **pdf-lib 1.17.1:** MIT. Bundled UMD build and licence; [upstream source](https://github.com/Hopding/pdf-lib/tree/v1.17.1).

### Rebuilding the engine

1. Unpack the release’s `open-print-v…-source.zip`.
2. In `vendor/engine-source`, create a `src` folder and extract the included `ghostscript-10.07.1.tar.gz` into it.
3. Run `scripts/build.sh` using the included Dockerfile, or Emscripten 6.0.7 with the documented dependencies.
4. Copy `dist/ghostscript.js` and `dist/ghostscript.wasm` into the plugin’s `vendor/` folder, then rebuild the plugin.
5. Commit the new `vendor/ghostscript.wasm` and push it. Then point `ENGINE_URL` in `src/assets.js` and the manifest’s `allowedDomains` at that commit, and update `ENGINE_SIZE` and `ENGINE_SHA256`.

Published versions of the plugin download the engine from the commit they were built with, so don’t rewrite the history of `main` or delete those commits.

The upstream engine build hasn’t been rerun for this project yet.

Checksums:

```text
ghostscript.wasm
5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36

ghostscript-10.07.1.tar.gz
2fc74362f9be6fae1b0a65d38fdcfd4f0b518cc3b07c5581fb661eb4d2e15251
```

If you redistribute a modified version, keep the applicable licenses and provide the corresponding source. ICC files have their own terms, separate from the plugin’s source license.

## Releasing

Changes reach `main` through pull requests and don’t create releases on their own. When a version is ready to publish to Figma Community:

1. In a pull request, bump `version` in `package.json` and move the **Unreleased** notes in `CHANGELOG.md` under that version and date. Merge it once the tests pass.
2. On GitHub, draft a new release with a new tag `v` plus that version (for example `v0.1.0`) on `main`, paste the changelog notes and publish it. A workflow then builds and attaches the plugin zip and the Ghostscript source zip.
3. Publish to Figma Community from that plugin zip, using the same notes.
