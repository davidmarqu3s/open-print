#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=../versions.env
. versions.env

SRC_DIR="src"
mkdir -p "${SRC_DIR}"

TARBALL="${SRC_DIR}/ghostscript-${GHOSTSCRIPT_VERSION}.tar.gz"
EXTRACT_DIR="${SRC_DIR}/ghostscript-${GHOSTSCRIPT_VERSION}"

if [ -d "${EXTRACT_DIR}" ]; then
  echo "Ghostscript source already extracted at ${EXTRACT_DIR}"
  exit 0
fi

if [ ! -f "${TARBALL}" ]; then
  echo "Downloading Ghostscript ${GHOSTSCRIPT_VERSION} from ${GHOSTSCRIPT_SOURCE_TARBALL}"
  curl -L -o "${TARBALL}" "${GHOSTSCRIPT_SOURCE_TARBALL}"
else
  echo "Tarball already downloaded: ${TARBALL}"
fi

echo "Verifying SHA-256 checksum..."
echo "${GHOSTSCRIPT_SOURCE_TARBALL_SHA256}  ${TARBALL}" | sha256sum -c -

echo "Extracting source..."
tar -xzf "${TARBALL}" -C "${SRC_DIR}"

echo "Ghostscript ${GHOSTSCRIPT_VERSION} extracted to ${EXTRACT_DIR}"
