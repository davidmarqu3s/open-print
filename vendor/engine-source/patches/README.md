# Patches

This directory contains `.patch` files applied to the Ghostscript source
tree before compilation. Patches are used only when needed for Emscripten
compatibility or to disable platform-specific code paths that cannot run
inside a browser.

## Applying patches

The build script (`scripts/build.sh`) automatically applies every
`.patch` file in this directory with `patch -p1` before running
`./configure`.

## Patch naming convention

- `000-*.patch` — Upstream bug fixes backported for the pinned version.
- `100-*.patch` — Emscripten-specific build or runtime fixes.
- `200-*.patch` — Optional size or feature adjustments.

## Current patches

None at this time. An unmodified Ghostscript 10.07.1 builds successfully
with the pinned Emscripten version using the configure flags in
`scripts/build.sh`.

## Creating a new patch

1. Extract the Ghostscript source:
   ```bash
   bash scripts/download-source.sh
   cd src/ghostscript-<version>
   ```
2. Make the required source change.
3. Generate the patch from the repository root:
   ```bash
   cd ../..
   diff -ruN src/ghostscript-<version>.orig src/ghostscript-<version> \
     > patches/100-short-description.patch
   ```
4. Document the patch in this file.
