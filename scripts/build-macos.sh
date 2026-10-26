#!/usr/bin/env bash
# One-command macOS build: bootstraps Node if needed, installs dependencies, rebuilds the
# native modules for Electron, builds the app, signs it ad-hoc (no Developer ID required)
# and produces dist/Forklift-<version>-<arch>.dmg plus a .zip.
#
#   npm run build:mac
#   bash scripts/build-macos.sh [--check]
#
# Everything downloaded goes to ~/.forklift-build (override with FORKLIFT_BUILD_HOME);
# Electron headers for node-gyp stay in ~/.electron-gyp. Nothing extra is written into
# the repository except node_modules/, out/ and dist/ (all ignored by git).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/env.sh
source scripts/env.sh

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
usage: npm run build:mac [-- --check]

  --check   also run typecheck and lint before packaging
EOF
}

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $arg" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || die "macOS only; on Windows use scripts/build-windows.ps1"
if ! xcode-select -p >/dev/null 2>&1 || ! command -v clang >/dev/null 2>&1; then
  printf 'Xcode Command Line Tools are missing; opening the macOS installer...\n'
  xcode-select --install >/dev/null 2>&1 || true
  die "finish installing the Command Line Tools, then run this script again"
fi
command -v python3 >/dev/null 2>&1 || die "python3 is required by node-gyp (it ships with Xcode Command Line Tools)"

case "$(uname -m)" in
  arm64) ARCH=arm64; NODE_ARCH=arm64 ;;
  x86_64) ARCH=x64; NODE_ARCH=x64 ;;
  *) die "unsupported CPU architecture: $(uname -m)" ;;
esac

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' >/dev/null 2>&1
}

ensure_node() {
  if node_ok; then
    step "Using Node $(node -v) at $(command -v node)"
    return
  fi
  step "Node >= 22.12 not found; bootstrapping Node 22 LTS into $FORKLIFT_BUILD_HOME/node"
  local dist="https://nodejs.org/dist/latest-v22.x"
  local sums file hash tmp
  sums="$(curl -fsSL "$dist/SHASUMS256.txt")" || die "cannot download $dist/SHASUMS256.txt"
  file="$(printf '%s\n' "$sums" | awk -v suffix="darwin-${NODE_ARCH}.tar.gz" 'index($2, suffix) { print $2; exit }')"
  [ -n "$file" ] || die "no Node 22 build published for darwin-${NODE_ARCH}"
  hash="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1; exit }')"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/forklift-node.XXXXXX")"
  mkdir -p "$FORKLIFT_BUILD_HOME"
  curl -fsSL -o "$tmp/$file" "$dist/$file" || die "cannot download $dist/$file"
  ( cd "$tmp" && printf '%s  %s\n' "$hash" "$file" | shasum -a 256 -c - >/dev/null ) || die "checksum mismatch for $file"
  tar -xzf "$tmp/$file" -C "$FORKLIFT_BUILD_HOME"
  rm -rf "$FORKLIFT_BUILD_HOME/node"
  mv "$FORKLIFT_BUILD_HOME/${file%.tar.gz}" "$FORKLIFT_BUILD_HOME/node"
  rm -rf "$tmp"
  export PATH="$FORKLIFT_BUILD_HOME/node/bin:$PATH"
  hash -r
  node_ok || die "bootstrapped Node is not usable"
  step "Using bootstrapped Node $(node -v)"
}

ensure_node
mkdir -p "$npm_config_cache" "$npm_config_devdir" "$ELECTRON_CACHE" "$ELECTRON_BUILDER_CACHE" "$FORKLIFT_OPENSSL_CACHE"

step "Installing npm dependencies"
npm ci --ignore-scripts --no-audit --no-fund

ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
step "Downloading Electron $ELECTRON_VERSION"
node node_modules/electron/install.js

step "Rebuilding native modules for Electron (nodegit, node-pty, nsfw, find-git-repositories)"
node scripts/rebuild-native.mjs

if [ "$CHECK" = 1 ]; then
  step "Typechecking and linting"
  npm run typecheck
  npm run lint
fi

step "Building the app"
npm run build

run_builder() {
  local electron_zip
  electron_zip="$(find "$ELECTRON_CACHE" -type f -name "electron-v${ELECTRON_VERSION}-darwin-${NODE_ARCH}.zip" -print -quit 2>/dev/null || true)"
  if [ -n "$electron_zip" ]; then
    npx electron-builder "$@" -c.electronDist="$(dirname "$electron_zip")"
  else
    npx electron-builder "$@"
  fi
}

step "Packaging Forklift.app ($ARCH) without a Developer ID"
rm -rf dist
run_builder --mac dir --"$ARCH" --publish never
APP_PATH="$(find dist -maxdepth 3 -type d -name 'Forklift.app' -print -quit)"
[ -n "$APP_PATH" ] || die "packaged app not found under dist/"
APP_PATH="$REPO_ROOT/$APP_PATH"

step "Signing the app ad-hoc, with the hardened-runtime entitlements Electron needs"
node scripts/adhoc-sign.mjs "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
node scripts/check-fuses.mjs

step "Building the DMG"
run_builder --mac dmg --"$ARCH" --prepackaged "$APP_PATH" --publish never

VERSION="$(node -p "require('./package.json').version")"
ZIP="dist/Forklift-${VERSION}-${ARCH}-mac.zip"
step "Zipping the signed app"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP"

DMG="$(find dist -maxdepth 1 -type f -name '*.dmg' -print -quit)"
step "Done"
printf '  app: %s\n  dmg: %s\n  zip: %s\n  run: open %s\n' "$APP_PATH" "${DMG:-<not found>}" "$ZIP" "$APP_PATH"
