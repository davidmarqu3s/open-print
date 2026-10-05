#!/usr/bin/env bash
# Builds the two release zips in release/: the plugin and the Ghostscript corresponding source.
# Run after `npm run build`. Usage: scripts/package-release.sh 0.1.0
set -euo pipefail
version="$1"
gs_url='https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/ghostscript-10.07.1.tar.gz'
gs_sha256='2fc74362f9be6fae1b0a65d38fdcfd4f0b518cc3b07c5581fb661eb4d2e15251'

rm -rf release && mkdir -p release/open-print/dist release/open-print/vendor/profiles release/source/vendor
cp manifest.json README.md LICENSE release/open-print/
cp dist/code.js dist/ui.html release/open-print/dist/
cp vendor/profiles/README.md vendor/profiles/SHA256SUMS.txt release/open-print/vendor/profiles/
(cd release && zip -qr "open-print-v$version.zip" open-print)

cp -R vendor/engine-source release/source/vendor/
cp LICENSE release/source/
curl -sSfL -o release/source/ghostscript-10.07.1.tar.gz "$gs_url"
echo "$gs_sha256  release/source/ghostscript-10.07.1.tar.gz" | sha256sum -c -
(cd release/source && zip -qr "../open-print-v$version-source.zip" .)
ls -l release/*.zip
