#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
BWS_VERSION="2.0.0"

need_apt=()
command -v curl >/dev/null 2>&1 || need_apt+=(curl)
command -v unzip >/dev/null 2>&1 || need_apt+=(unzip)
if ((${#need_apt[@]})); then
  sudo apt-get update
  sudo apt-get install -y "${need_apt[@]}"
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v tailscale >/dev/null 2>&1 || ! command -v tailscaled >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! command -v bws >/dev/null 2>&1; then
  archive="/tmp/bws-${BWS_VERSION}.zip"
  extract_dir="/tmp/bws-${BWS_VERSION}"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir" "$HOME/.bun/bin"
  curl -fsSL \
    "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-x86_64-unknown-linux-gnu-${BWS_VERSION}.zip" \
    -o "$archive"
  unzip -q -o "$archive" -d "$extract_dir"
  install -m 0755 "$extract_dir/bws" "$HOME/.bun/bin/bws"
  rm -rf "$archive" "$extract_dir"
fi

bun install --frozen-lockfile

bun --version
bws --version
tailscale version | sed -n '1p'
