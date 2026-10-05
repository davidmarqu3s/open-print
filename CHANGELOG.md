# Changelog

Notable changes to Open Print. Each release’s notes are also used on GitHub Releases and when publishing to Figma Community. Versions follow [semantic versioning](https://semver.org): fixes bump the last number, new features the middle one.

## Unreleased

## 0.3.0 – 2026-10-05

The first release of the new release process. It replaces all earlier test releases.

### Features

- Exports selected Figma frames as a vector CMYK PDF, converted entirely inside the plugin.
- 15 included CMYK profiles, **No profile**, or your own custom CMYK ICC profile.
- One multipage PDF, or individual PDFs saved one after another with each frame’s name.
- Print sizes in mm or inches, with one-click snapping to standard paper sizes.
- Bleed shown on the canvas, plus optional crop marks in Registration, with correct TrimBox and BleedBox.
- Gradients exported as vector CMYK; shadows, blurs, noise and texture exported as images at print resolution.
- Warnings for low-resolution images, and removal of leftover RGB colour spaces.
- Figma-style dropdown menus.
- The conversion engine is downloaded from this repository and checked against a fixed checksum.
