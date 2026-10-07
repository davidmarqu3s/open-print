# Agent instructions

Read [docs/development.md](docs/development.md) for building, testing, how export works and releasing. Then:

## Workflow

- Work on a branch and open a pull request to `main`. Merges are squashed. Don't merge without the maintainer's go-ahead.
- Never rewrite `main`'s history: the plugin downloads its engine from commit `436f731`.
- Merging doesn't create a release. Tags and releases are made by the maintainer on GitHub.

## Build and test

- Run `npm run build` before `npm test`, because the tests read `dist/`.
- The tests use a fake Figma, so check UI changes in Figma desktop too.
- A new system package needed by the tests (such as poppler for `pdftoppm`) must be installed in `test.yml`, `latest-build.yml` and `release.yml`.
- The build fails if the plugin code exceeds Figma's 15,000,000-byte limit.

## Code and copy

- Features belong in the plugin window, not in manifest menu commands.
- Streams added to a page go through pdf-lib's `context.register`. Diagnose broken PDFs with `pdftoppm` and `pikepdf`.
- User-facing copy uses British spelling and says "crop marks", never "registration marks".
