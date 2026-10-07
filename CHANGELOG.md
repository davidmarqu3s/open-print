# Changelog

Notable changes to Open Print. Each release’s notes are also used on GitHub Releases and when publishing to Figma Community. Versions follow [semantic versioning](https://semver.org): fixes bump the last number, new features the middle one.

## Unreleased

First public release, waiting for Figma Community approval.

- Export Figma frames and components as print-ready vector CMYK PDFs, converted inside the plugin.
- 15 included CMYK profiles, or your own ICC profile.
- PDF/X-4 export.
- One multipage PDF, or one PDF per frame.
- Print sizes in mm or inches, with snapping to standard paper sizes. A custom page size scales the artwork to fit, centred.
- New frames at exact paper sizes: A0 to A6, DL, business card, posters, Letter and Tabloid.
- Bleed on the canvas, with the trim edge outlined, and optional crop marks. Instances take their bleed from the main component.
- Pure black prints in black ink only and overprints.
- Gradients stay vector; shadows, blurs and textures export at print resolution.
- Preflight checks the selected frames as you work: low-resolution images, missing bleed, text near the edge, small or rich-black text and hairlines.
