#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Cleaning build artifacts..."

rm -rf dist/*.js dist/*.wasm dist/*.worker.js dist/*.map
rm -rf build/
rm -rf tests/output tests/temp
rm -rf node_modules/

# Optionally remove downloaded source. Keep it by default so rebuilds are fast.
if [ "${CLEAN_SOURCE:-0}" = "1" ]; then
  echo "Removing downloaded source (CLEAN_SOURCE=1)..."
  rm -rf src/
fi

echo "Clean complete."
