# syntax=docker/dockerfile:1
# Reproducible build environment for Ghostscript WebAssembly.

ARG EMSCRIPTEN_VERSION=6.0.7
FROM emscripten/emsdk:${EMSCRIPTEN_VERSION}

LABEL org.opencontainers.image.title="Ghostscript WASM Builder"
LABEL org.opencontainers.image.description="Reproducible Ghostscript WASM build environment"

# Install Ghostscript build dependencies. The emscripten/emsdk image is
# based on Ubuntu 24.04 (noble), so Debian-pinned versions do not apply;
# versions are intentionally unpinned to match whatever the base image
# ships. Python is already provided by the emsdk base image (its own
# toolchain also bundles a Python), so it is not installed here.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    autoconf \
    automake \
    libtool \
    cmake \
    pkg-config \
    git \
    curl \
    unzip \
    wget \
    ca-certificates \
    patch \
    libtiff-dev \
    libjpeg-turbo8-dev \
    libpng-dev \
    libfreetype6-dev \
    libfontconfig1-dev \
    liblcms2-dev \
    libopenjp2-7-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Derive the bundled Node.js path from the emsdk image rather than
# hard-coding a version number. The emscripten/emsdk image already sets
# PATH for interactive shells; we ensure it is also set for the
# non-interactive login shell used by CMD below.
ENV EMSDK=/emsdk
RUN NODE_BIN=$(ls -d /emsdk/node/*/bin 2>/dev/null | head -n1) \
    && { \
      echo "export PATH=\"${NODE_BIN}:/emsdk/upstream/emscripten:\${PATH}\""; \
      echo "export EMSDK=/emsdk"; \
      echo "export EMSDK_NODE=\"${NODE_BIN}/node\""; \
    } > /etc/profile.d/emsdk-env.sh \
    && chmod +x /etc/profile.d/emsdk-env.sh

# Verify Emscripten version in a login shell so the PATH above is active.
RUN bash -l -c "emcc --version"

WORKDIR /project

# Default command: download source and build. Use a login shell so the
# Emscripten environment from /etc/profile.d is sourced automatically.
CMD ["bash", "-l", "scripts/build.sh"]
