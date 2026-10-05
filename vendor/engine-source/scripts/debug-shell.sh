#!/usr/bin/env bash
# Launch an interactive shell in the build container for debugging.
# Useful for the iterative configure/build/fix cycle described in Phase 4.
set -euo pipefail

cd "$(dirname "$0")/.."

docker build -t ghostscript-wasm . >/dev/null 2>&1 || true

echo "Starting interactive Ghostscript WASM build shell..."
echo "Run: bash scripts/build.sh"
docker run --rm -it -v "$PWD:/project" ghostscript-wasm bash -l
