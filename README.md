# Open Print

An open-source Figma plugin for exporting selected frames as a CMYK vector PDF with print dimensions in millimetres. Conversion runs locally inside the plugin; no server or companion app is needed. Licensed under GNU AGPL v3.

**Experimental:** automated tests and the complete browser export pipeline have passed. Final Figma desktop runtime compatibility is still awaiting verification, including worker/CSP startup and the file-download interaction.

## Install

1. Download `open-print-v0.1.0.zip` from [Releases](https://github.com/davidmarqu3s/open-print/releases) and extract it to a permanent folder.
2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select its `manifest.json`.
3. Select your frames and run **Plugins → Development → Open Print**.
4. Keep **Use frame size** enabled, or enter your final width and height in mm.
5. Choose **No profile** or **Custom CMYK profile…** and export. If needed, click **Save PDF** after conversion.

Use the CMYK ICC profile supplied or approved by your printer. With **No profile**, Ghostscript converts colors to DeviceCMYK using its default CMYK conversion and no ICC OutputIntent is embedded. With a custom profile, it controls conversion and is embedded in the PDF. Different profiles produce different CMYK values.

## Print sizing

Figma frames contain no intrinsic physical-size metadata. Automatic inference uses Figma’s native PDF scale: **72 frame units per inch**, converted to mm and rounded to 0.01 mm. Every selected frame gets its own inferred PDF page size.

For example, a 907 × 1276 frame infers 319.97 × 450.14 mm. Enter 320 × 450 mm if that is your intended final page size. Editing dimensions disables automatic sizing and applies your size to every page. Manual dimensions persist across selection changes.

Artwork remains at its native size, aligned to the top left. Page resizing changes PDF page boundaries; larger pages add space and smaller pages crop. The plugin does not resize or modify Figma nodes.

## Supported scope

- 1–32 selected frames per export; numerical frame-name order.
- Vector paths retained for supported artwork.
- ICC color conversion, with optional embedded CMYK OutputIntent.
- Existing raster images remain raster; image downsampling is disabled.
- Gradients and visible effects are rejected before export.
- Crop marks already in the artwork are retained; new bleed or marks are not generated.
- MediaBox, CropBox, TrimBox and BleedBox all use the final page size.
- Figma text may become outlined paths or Type3 glyphs; editable Illustrator text is not guaranteed.
- PDF/X certification, spot colors and overprint controls are outside this version’s scope.
- External network access is denied by the manifest.

## Build and test

Requires Node 18 or later. No package installation is needed: dependencies are vendored.

```sh
npm test
npm run build
```

Then import `manifest.json` in Figma desktop. Thirteen tests cover sizing, CMYK profile validation/embedding, vector content, preflight, export order, no node writes, automatic sizing and persistent manual overrides. A three-page real-design browser test also verified CMYK values, preserved vectors and embedded ICC bytes against a reference export. Sample artwork and printer ICC profiles are not included in this repository.

To create a personal build with a built-in CMYK preset:

```sh
node build.mjs --profile /path/to/printer-profile.icc
```

Only bundle profiles you have permission to redistribute. The generated UI is excluded from Git. The manifest uses a local development identifier; obtain your own Figma-assigned plugin ID before Community publication. See [Figma’s manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

## Dependency sources

- **Ghostscript 10.07.1:** AGPL. Complete corresponding source, including the original source tarball, is available in `open-print-v0.1.0-source.zip` alongside the binary release.
- **WASM wrapper/build sources:** [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools), pinned commit `51131feb82b37ad51687718889b788bf425ce594`. Its source files, scripts, patches and build configuration are included under `vendor/engine-source/`; generated duplicate engine binaries are omitted.
- **pdf-lib 1.17.1:** MIT. Bundled UMD build and license; [upstream source](https://github.com/Hopding/pdf-lib/tree/v1.17.1).

To rebuild the engine, unpack the full source release. Inside `vendor/engine-source`, create `src` and extract `ghostscript-10.07.1.tar.gz` into it. Use the included Dockerfile or Emscripten 6.0.7 with the documented dependencies to run `scripts/build.sh`. Copy the resulting `dist/ghostscript.js` and `dist/ghostscript.wasm` to the plugin’s `vendor/` directory, then rebuild the plugin. The upstream build has not been rerun during this implementation.

Checksums:

```text
ghostscript.wasm
5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36

ghostscript-10.07.1.tar.gz
2fc74362f9be6fae1b0a65d38fdcfd4f0b518cc3b07c5581fb661eb4d2e15251
```

Preserve applicable licenses and provide corresponding source when redistributing modified versions. ICC files have their own terms and are separate from the plugin’s source license.
