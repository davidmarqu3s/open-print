#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=../versions.env
. versions.env

PROJECT_ROOT="$(pwd)"
SRC_DIR="${PROJECT_ROOT}/src"
GS_DIR="${SRC_DIR}/ghostscript-${GHOSTSCRIPT_VERSION}"
BUILD_DIR="${PROJECT_ROOT}/build"
DIST_DIR="${PROJECT_ROOT}/dist"
PATCHES_DIR="${PROJECT_ROOT}/patches"
NATIVE_DIR="${PROJECT_ROOT}/native"

mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

# dist/ contains a CommonJS build of the module; declare it so Node's ESM
# interop imports it correctly even though the repo root is "type": "module".
cat > "${DIST_DIR}/package.json" <<'EOF'
{
  "type": "commonjs"
}
EOF

# ---------------------------------------------------------------------------
# 1. Download source
# ---------------------------------------------------------------------------
if [ ! -d "${GS_DIR}" ]; then
  echo "Downloading Ghostscript source..."
  bash scripts/download-source.sh
fi

# ---------------------------------------------------------------------------
# 2. Apply local Emscripten compatibility patches
# ---------------------------------------------------------------------------
if [ -d "${PATCHES_DIR}" ] && [ "$(find "${PATCHES_DIR}" -name '*.patch' | wc -l)" -gt 0 ]; then
  echo "Applying patches..."
  for patch in "${PATCHES_DIR}"/*.patch; do
    echo "  ${patch}"
    (cd "${GS_DIR}" && patch -p1 --forward) < "${patch}" || true
  done
fi

# ---------------------------------------------------------------------------
# 3. Configure Ghostscript for Emscripten
# ---------------------------------------------------------------------------
echo "Configuring Ghostscript ${GHOSTSCRIPT_VERSION} with Emscripten..."

cd "${GS_DIR}"

# Clean previous configure artifacts to avoid stale state.
if [ -f Makefile ]; then
  emmake make distclean || true
fi

# Ghostscript configure flags chosen for a browser WASM build.
# Only PDF input and pdfwrite output are required.
#
# Bundled libraries (jpeg, libpng, zlib, lcms2mt, freetype, jbig2dec,
# openjpeg) are used automatically because they are present in the source
# tree and the Emscripten toolchain cannot link against host system libs.
emconfigure ./configure \
  --prefix="${BUILD_DIR}/ghostscript-install" \
  --host=wasm32-unknown-emscripten \
  --without-x \
  --disable-cups \
  --disable-dbus \
  --disable-gtk \
  --disable-fontconfig \
  --disable-dynamic \
  --without-pcl \
  --without-xps \
  --with-local-zlib \
  --with-local-brotli \
  --without-libpaper \
  --without-ijs \
  --without-tesseract \
  CFLAGS="-O3 -Wno-error" \
  CXXFLAGS="-O3 -Wno-error" \
  LDFLAGS=""

# ---------------------------------------------------------------------------
# 4. Build Ghostscript object files
# ---------------------------------------------------------------------------
# The "so" target compiles all interpreter/device objects into soobj/.
# The final link step may fail under Emscripten because it tries to build a
# native shared library; we only need the object files for the WASM module.
echo "Building Ghostscript objects..."
set +e
emmake make so -j"$(nproc)"
MAKE_SO_CODE=$?
set -e

# ---------------------------------------------------------------------------
# 5. Package object files into a static library
# ---------------------------------------------------------------------------
SOOBJ_DIR="${GS_DIR}/soobj"
if [ ! -d "${SOOBJ_DIR}" ] || [ -z "$(find "${SOOBJ_DIR}" -maxdepth 1 -name '*.o' -print -quit 2>/dev/null)" ]; then
  echo "Error: object directory ${SOOBJ_DIR} not found or empty after build." >&2
  exit 1
fi

if [ "${MAKE_SO_CODE}" -ne 0 ]; then
  echo "Warning: make so exited with code ${MAKE_SO_CODE}, but object files are present; continuing."
fi

LIBGS="${SOOBJ_DIR}/libgs.a"
if [ ! -f "${LIBGS}" ]; then
  echo "Creating static library ${LIBGS} from object files..."

  # Exclude duplicate-symbol object files. Ghostscript builds both a
  # standalone interpreter and a library; some files provide the same
  # symbols and cause linker errors when statically linked.
  #
  # Keep the real implementations (iscanbin, ziodevsc, zusparam) and
  # drop the dummy/standalone duplicates (inobtokn, gsiodevs, inouparm).
  mapfile -t OBJ_FILES < <(find "${SOOBJ_DIR}" -maxdepth 1 -name '*.o' \
    ! -name 'inobtokn.o' \
    ! -name 'gsiodevs.o' \
    ! -name 'inouparm.o' \
    | sort)
  if [ "${#OBJ_FILES[@]}" -eq 0 ]; then
    echo "Error: no object files found in ${SOOBJ_DIR}." >&2
    exit 1
  fi
  emar rcs "${LIBGS}" "${OBJ_FILES[@]}"
fi

echo "Static library: ${LIBGS}"

# ---------------------------------------------------------------------------
# 6. Build the WASM module with the C wrapper
# ---------------------------------------------------------------------------
cd "${PROJECT_ROOT}"

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

# Copy the worker into dist so consumers only need the dist/ folder.
cp "${PROJECT_ROOT}/worker/ghostscript.worker.js" "${DIST_DIR}/ghostscript.worker.js"

# Copy the preset definitions (loaded by the worker via importScripts).
cp "${PROJECT_ROOT}/shared/presets.js" "${DIST_DIR}/presets.js"

# Copy the image->PDF writer (loaded by the worker via importScripts).
cp "${PROJECT_ROOT}/shared/pdf-writer.js" "${DIST_DIR}/pdf-writer.js"

# Copy all runtime artifacts into web/ so web/ is self-contained for static serve & Cloudflare Pages.
mkdir -p "${PROJECT_ROOT}/web"
cp "${DIST_DIR}/ghostscript.js" "${PROJECT_ROOT}/web/ghostscript.js"
cp "${DIST_DIR}/ghostscript.wasm" "${PROJECT_ROOT}/web/ghostscript.wasm"
cp "${PROJECT_ROOT}/worker/ghostscript.worker.js" "${PROJECT_ROOT}/web/ghostscript.worker.js"
cp "${PROJECT_ROOT}/shared/presets.js" "${PROJECT_ROOT}/web/presets.js"
cp "${PROJECT_ROOT}/shared/pdf-writer.js" "${PROJECT_ROOT}/web/pdf-writer.js"

# Copy PWA assets into dist/
cp "${PROJECT_ROOT}/web/manifest.json" "${DIST_DIR}/manifest.json" 2>/dev/null || true
cp "${PROJECT_ROOT}/web/sw.js" "${DIST_DIR}/sw.js" 2>/dev/null || true
cp "${PROJECT_ROOT}/web/icon-192.png" "${DIST_DIR}/icon-192.png" 2>/dev/null || true
cp "${PROJECT_ROOT}/web/icon-512.png" "${DIST_DIR}/icon-512.png" 2>/dev/null || true
cp "${PROJECT_ROOT}/web/apple-touch-icon.png" "${DIST_DIR}/apple-touch-icon.png" 2>/dev/null || true
cp "${PROJECT_ROOT}/web/icon.svg" "${DIST_DIR}/icon.svg" 2>/dev/null || true

echo "Build complete. Artifacts in ${DIST_DIR} and ${PROJECT_ROOT}/web:"
ls -lh "${DIST_DIR}"


