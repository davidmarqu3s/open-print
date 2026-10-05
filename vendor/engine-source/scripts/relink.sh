#!/usr/bin/env bash
# One-off helper: re-run only the archive + WASM link steps after an
# already-finished `make so`. Avoids build.sh's `distclean` which would
# wipe the compiled object files.
set -euo pipefail

cd "$(dirname "$0")/.."
. versions.env

PROJECT_ROOT="$(pwd)"
GS_DIR="${PROJECT_ROOT}/src/ghostscript-${GHOSTSCRIPT_VERSION}"
BUILD_DIR="${PROJECT_ROOT}/build"
DIST_DIR="${PROJECT_ROOT}/dist"
NATIVE_DIR="${PROJECT_ROOT}/native"
SOOBJ_DIR="${GS_DIR}/soobj"
LIBGS="${SOOBJ_DIR}/libgs.a"

mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

# dist/ contains a CommonJS build of the module; declare it so Node's ESM
# interop imports it correctly even though the repo root is "type": "module".
cat > "${DIST_DIR}/package.json" <<'EOF'
{
  "type": "commonjs"
}
EOF

if [ ! -d "${SOOBJ_DIR}" ] || [ -z "$(find "${SOOBJ_DIR}" -maxdepth 1 -name '*.o' -print -quit 2>/dev/null)" ]; then
  echo "Error: ${SOOBJ_DIR} has no object files. Run scripts/build.sh first." >&2
  exit 1
fi

# Rebuild the static library excluding duplicate-symbol object files
# (same filter as build.sh step 5).
rm -f "${LIBGS}"
echo "Creating static library ${LIBGS} from object files..."
mapfile -t OBJ_FILES < <(find "${SOOBJ_DIR}" -maxdepth 1 -name '*.o' \
  ! -name 'inobtokn.o' \
  ! -name 'gsiodevs.o' \
  ! -name 'inouparm.o' \
  | sort)
emar rcs "${LIBGS}" "${OBJ_FILES[@]}"
echo "Static library: ${LIBGS}"

echo "Building WASM module..."
emcc \
  -O3 \
  -I"${GS_DIR}/psi" \
  -I"${GS_DIR}/base" \
  "${NATIVE_DIR}/gs_wrapper.c" \
  "${LIBGS}" \
  -o "${DIST_DIR}/ghostscript.js" \
  -s EXPORTED_FUNCTIONS='["_gs_initialize","_gs_process_pdf","_gs_process_pdf_argv","_gs_process_pdfs","_gs_run","_gs_get_last_error","_gs_shutdown","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","HEAPU8"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=64MB \
  -s MAXIMUM_MEMORY=512MB \
  -s STACK_SIZE=2097152 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=GhostscriptModule \
  -s ENVIRONMENT='node,web,worker' \
  -s FILESYSTEM=1 \
  -s FORCE_FILESYSTEM=1 \
  -s INVOKE_RUN=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s LLD_REPORT_UNDEFINED \
  -s WASM_BIGINT=0 \
  -s USE_PTHREADS=0 \
  -s SUPPORT_LONGJMP=emscripten \
  -s ASSERTIONS=1 \
  --pre-js "${NATIVE_DIR}/pre.js" \
  2>&1 | tee "${BUILD_DIR}/emcc.log"

cp "${PROJECT_ROOT}/worker/ghostscript.worker.js" "${DIST_DIR}/ghostscript.worker.js"

# Copy the preset definitions (loaded by the worker via importScripts).
cp "${PROJECT_ROOT}/shared/presets.js" "${DIST_DIR}/presets.js"

# Copy the image->PDF writer (loaded by the worker via importScripts).
cp "${PROJECT_ROOT}/shared/pdf-writer.js" "${DIST_DIR}/pdf-writer.js"

echo "Relink complete. Artifacts in ${DIST_DIR}:"
ls -lh "${DIST_DIR}"
