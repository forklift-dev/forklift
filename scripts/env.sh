# Shared local build environment: every download lives outside the repository, in
# ~/.forklift-build (override with FORKLIFT_BUILD_HOME). Electron headers for node-gyp
# stay in ~/.electron-gyp, electron-rebuild's default location.
#
# build-macos.sh sources this file itself; for interactive work run `source scripts/env.sh`
# after the first build (it uses the bootstrapped Node if there is one).
export FORKLIFT_BUILD_HOME="${FORKLIFT_BUILD_HOME:-$HOME/.forklift-build}"
if [ -x "$FORKLIFT_BUILD_HOME/node/bin/node" ]; then
  export PATH="$FORKLIFT_BUILD_HOME/node/bin:$PATH"
fi
export npm_config_cache="$FORKLIFT_BUILD_HOME/cache/npm"
export npm_config_devdir="$FORKLIFT_BUILD_HOME/cache/node-gyp"
export ELECTRON_CACHE="$FORKLIFT_BUILD_HOME/cache/electron"
# electron/install.js and electron-builder read these spellings, not ELECTRON_CACHE alone.
export electron_config_cache="$ELECTRON_CACHE"
export ELECTRON_BUILDER_CACHE="$FORKLIFT_BUILD_HOME/cache/electron-builder"
export FORKLIFT_OPENSSL_CACHE="$FORKLIFT_BUILD_HOME/cache/openssl"
# Unsigned local build: electron-builder must not look for Apple signing identities.
export CSC_IDENTITY_AUTO_DISCOVERY="false"
