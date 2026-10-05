# Development

Notes for building, testing and releasing Open Print. For using the plugin, see the [README](../README.md).

## Build and test

Requires Node 18 or later. Dependencies are vendored, so there is nothing to install. Build first, because the tests read from `dist/`:

```sh
npm run build
npm test
```

Then import `manifest.json` in Figma desktop. Every pull request and every push to `main` runs the same build and tests on GitHub Actions (the **test** check, on Node 22). The build fails if the plugin code exceeds Figma’s 15,000,000-byte limit.

The tests cover sizing, profile validation and embedding, vector content, vector CMYK gradients, scaled effects, noise and texture, bleed and crop marks, image resolution, PDF clean-up, the engine download, preflight, export order, the plugin panel, and a check that original nodes are never modified. Sample artwork is not included.

## How export works

- **Page size:** 72 frame units per inch, rounded to 0.01 mm. Inches convert at exactly 25.4 mm. Standard-size matching covers A0–A6, DL, B1–B5, SRA3, 50 × 70 and 70 × 100 cm posters, Letter, Legal, Tabloid and business cards.
- **Gradients:** Ghostscript would rasterise RGB gradients at about 180 ppi and drop angular and diamond ones, so each gradient is converted to DeviceCMYK first, using Ghostscript’s own conversion of the same colours on a hidden probe page.
- **Effects:** Figma bakes shadows and blurs into 144 ppi bitmaps, so those frames are exported from a temporary copy scaled up about 2.1×. Frames longer than about 1,370 mm, and view-only files, fall back to a lower resolution and the plugin says so.
- **Noise and texture:** rasterised at 300 ppi, capped at 4,096 pixels on the longest side (about 347 mm). They need the temporary copy, so view-only files can’t export them.
- **PDF clean-up:** hidden font layers and stray close-path commands are removed, and simple alpha masks use white mask paint so they import consistently into Illustrator.
- **Boxes:** without bleed or marks, MediaBox, CropBox, TrimBox and BleedBox match the page. With bleed, the TrimBox is the frame and the BleedBox adds the bleed; crop marks extend the MediaBox.
- **Individual PDFs:** duplicate names get a numbered suffix, and path separators and control characters become underscores. If the plugin can’t detect a Save dialog, it pauses; export again to retry.
- **Engine:** `vendor/ghostscript.wasm`, downloaded from `raw.githubusercontent.com` at commit `436f731`, checked against a fixed size and SHA-256. The manifest allows network access to that one URL only.

## Custom profile builds

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

If a build leaves a catalogue profile out, users can select it and import its ICC file; the file’s internal name must match. Imported profiles are stored in Figma client storage, within its [5 MB quota](https://developers.figma.com/docs/plugins/api/figma-clientStorage/).

You can get ECI profiles from [ECI downloads](https://eci.org/doku.php_id%3Den_downloads.html), Adobe profiles from an Adobe installation or [Adobe downloads](https://www.adobe.com/support/downloads/iccprofiles/iccprofiles_win.html), and Japan Color 2011 from [Japan Color](https://japancolor.jp/icc.html). Follow each supplier’s licence terms. On macOS, Adobe’s profiles are usually in `/Library/Application Support/Adobe/Color/Profiles/`.

## Dependencies

- **WASM wrapper and build sources:** [J0shua-code/pdf-tools](https://github.com/J0shua-code/pdf-tools) at pinned commit `51131feb82b37ad51687718889b788bf425ce594`. Its source files, scripts, patches and build configuration are in `vendor/engine-source/`.
- **js-sha256 0.11.1:** verifies checksums without relying on Web Crypto in Figma’s sandbox; [upstream source](https://github.com/emn178/js-sha256/tree/v0.11.1).
- **pdf-lib 1.17.1:** bundled UMD build and licence; [upstream source](https://github.com/Hopding/pdf-lib/tree/v1.17.1).

## Rebuilding the engine

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

## Releasing

Changes reach `main` through pull requests and don’t create releases on their own. When a version is ready to publish to Figma Community:

1. In a pull request, bump `version` in `package.json` and move the **Unreleased** notes in `CHANGELOG.md` under that version and date. Merge it once the tests pass.
2. On GitHub, draft a new release with a new tag `v` plus that version (for example `v0.1.0`) on `main`, paste the changelog notes and publish it. A workflow then builds and attaches the plugin zip and the Ghostscript source zip.
3. Publish to Figma Community from that plugin zip, using the same notes.
