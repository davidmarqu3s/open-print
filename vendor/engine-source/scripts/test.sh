#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Running Ghostscript WASM tests..."

# Ensure test inputs exist.
if [ ! -f "tests/input/simple.pdf" ]; then
  echo "Generating test PDFs..."
  node scripts/generate-test-pdfs.js
fi

# Ensure the WASM module was built.
if [ ! -f "dist/ghostscript.js" ] || [ ! -f "dist/ghostscript.wasm" ]; then
  echo "WASM module not found. Run 'bash scripts/build.sh' first." >&2
  exit 1
fi

mkdir -p tests/output tests/temp

# Run the Node-based integration test (C wrapper + presets).
node tests/integration.test.js

# Run the feature tests (Tests 2-7: pages, image/text, corrupt, sequential).
node tests/features.test.js

# Run the worker protocol test (message contract, rejection handling).
node tests/worker.test.js

# Run the client API test (browser postMessage payload validity).
node tests/client.test.js

echo "All tests passed."
