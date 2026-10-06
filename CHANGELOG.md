# Changelog

Notable changes to Open Print. Each release’s notes are also used on GitHub Releases and when publishing to Figma Community. Versions follow [semantic versioning](https://semver.org): fixes bump the last number, new features the middle one.

## Unreleased

- Pure black prints in black ink only and overprints.
- PDF/X-4 export.
- Bleed and crop marks are added with a + button, and their settings show once added.
- A custom page size scales the artwork to fit, centred, instead of cropping it.
- Components and instances can be exported, with bleed and crop marks. Instances take their bleed from the main component.
- A + button next to Frames creates frames at exact paper sizes: A0 to A6, DL, business card, posters, Letter and Tabloid.
- Adding bleed outlines the original frame edge on the canvas. The outline doesn’t print.

## 0.1.0 – 2026-10-06

First public release.

- Export Figma frames as print-ready vector CMYK PDFs, converted inside the plugin.
- 15 included CMYK profiles, or your own ICC profile.
- One multipage PDF, or one PDF per frame.
- Print sizes in mm or inches, with snapping to standard paper sizes.
- Bleed on the canvas and optional crop marks.
- Gradients stay vector; shadows, blurs and textures export at print resolution.
