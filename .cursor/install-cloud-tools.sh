#!/usr/bin/env bash
set -euo pipefail

BUN_VERSION="1.3.10"
BUN_SHA256="41201a8c5ee74a9dcbb1ce25a1104f1f929838b57a845aa78d98379b0ce7cde2"
NODE_VERSION="24.18.1"
NODE_SHA256="d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0"
TAILSCALE_VERSION="1.98.10"
TAILSCALE_SHA256="52490ce0832b245857e2afef7426d6ae5a4b49fb391412833cc95729bd23f7de"
BWS_VERSION="2.0.0"
BWS_SHA256="a8340ce01da609200441f2eca0e591173e124f012c88a16afda574279c052013"

BIN_DIR="$HOME/.bun/bin"
export PATH="$BIN_DIR:$PATH"
mkdir -p "$BIN_DIR"

need_apt=()
command -v curl >/dev/null 2>&1 || need_apt+=(curl)
command -v unzip >/dev/null 2>&1 || need_apt+=(unzip)
command -v sha256sum >/dev/null 2>&1 || need_apt+=(coreutils)
command -v xz >/dev/null 2>&1 || need_apt+=(xz-utils)
command -v setsid >/dev/null 2>&1 || need_apt+=(util-linux)
if ((${#need_apt[@]})); then
  sudo apt-get update
  sudo apt-get install -y "${need_apt[@]}"
fi

download_verified() {
  local url="$1"
  local expected_sha256="$2"
  local output="$3"
  curl --fail --location --silent --show-error \
    --proto '=https' --tlsv1.2 --retry 3 \
    "$url" -o "$output"
  printf '%s  %s\n' "$expected_sha256" "$output" | sha256sum --check --status || {
    echo "Checksum verification failed for $url" >&2
    rm -f "$output"
    exit 1
  }
}

if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != "v${NODE_VERSION}" ]]; then
  archive="/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz"
  extract_dir="/tmp/node-v${NODE_VERSION}-linux-x64"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  download_verified \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    "$NODE_SHA256" "$archive"
  tar -xJf "$archive" -C "$extract_dir" --strip-components=1
  install -m 0755 "$extract_dir/bin/node" "$BIN_DIR/node"
  rm -rf "$archive" "$extract_dir"
fi

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "$BUN_VERSION" ]]; then
  archive="/tmp/bun-linux-x64-baseline-${BUN_VERSION}.zip"
  extract_dir="/tmp/bun-linux-x64-baseline-${BUN_VERSION}"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  download_verified \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip" \
    "$BUN_SHA256" "$archive"
  unzip -q -o "$archive" -d "$extract_dir"
  install -m 0755 "$extract_dir/bun-linux-x64-baseline/bun" "$BIN_DIR/bun"
  rm -rf "$archive" "$extract_dir"
fi

if ! command -v tailscale >/dev/null 2>&1 || [[ "$(tailscale version | sed -n '1p')" != "$TAILSCALE_VERSION" ]]; then
  archive="/tmp/tailscale-${TAILSCALE_VERSION}-amd64.tgz"
  extract_dir="/tmp/tailscale-${TAILSCALE_VERSION}-amd64"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  download_verified \
    "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_amd64.tgz" \
    "$TAILSCALE_SHA256" "$archive"
  tar -xzf "$archive" -C "$extract_dir" --strip-components=1
  install -m 0755 "$extract_dir/tailscale" "$BIN_DIR/tailscale"
  install -m 0755 "$extract_dir/tailscaled" "$BIN_DIR/tailscaled"
  rm -rf "$archive" "$extract_dir"
fi

if ! command -v bws >/dev/null 2>&1 || [[ "$(bws --version | awk '{print $NF}')" != "$BWS_VERSION" ]]; then
  archive="/tmp/bws-${BWS_VERSION}.zip"
  extract_dir="/tmp/bws-${BWS_VERSION}"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  download_verified \
    "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-x86_64-unknown-linux-gnu-${BWS_VERSION}.zip" \
    "$BWS_SHA256" "$archive"
  unzip -q -o "$archive" -d "$extract_dir"
  install -m 0755 "$extract_dir/bws" "$BIN_DIR/bws"
  rm -rf "$archive" "$extract_dir"
fi

bun install --frozen-lockfile

node --version
bun --version
bws --version
tailscale version | sed -n '1p'
