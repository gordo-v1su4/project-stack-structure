#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
TAILSCALED_PID=""
APP_PID=""
TAILSCALE_SOCKET="/tmp/tailscaled-cursor-stack.sock"
TAILSCALE_STATE="/tmp/tailscaled-cursor-stack.state"

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  if [[ -n "$TAILSCALED_PID" ]] && sudo kill -0 "$TAILSCALED_PID" 2>/dev/null; then
    sudo kill "$TAILSCALED_PID" 2>/dev/null || true
  fi
  sudo rm -f "$TAILSCALE_SOCKET" "$TAILSCALE_STATE" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' INT TERM

start_tailscale() {
  if [[ -z "${TS_AUTHKEY:-}" ]]; then
    echo "[cloud-agent] TS_AUTHKEY is not set; private Tailnet services will be unavailable." >&2
    return 0
  fi

  local tailscaled_bin
  local tailscale_bin
  tailscaled_bin="$(command -v tailscaled)" || {
    echo "[cloud-agent] tailscaled is not installed." >&2
    exit 1
  }
  tailscale_bin="$(command -v tailscale)" || {
    echo "[cloud-agent] tailscale is not installed." >&2
    exit 1
  }

  sudo rm -f "$TAILSCALE_SOCKET"
  sudo "$tailscaled_bin" \
    --state="$TAILSCALE_STATE" \
    --socket="$TAILSCALE_SOCKET" \
    --tun=userspace-networking \
    --outbound-http-proxy-listen=localhost:1054 \
    --socks5-server=localhost:1055 &
  TAILSCALED_PID=$!

  for _ in $(seq 1 30); do
    [[ -S "$TAILSCALE_SOCKET" ]] && break
    sleep 1
  done
  [[ -S "$TAILSCALE_SOCKET" ]] || {
    echo "[cloud-agent] tailscaled control socket did not become ready." >&2
    exit 1
  }

  sudo "$tailscale_bin" --socket="$TAILSCALE_SOCKET" up \
    --auth-key="$TS_AUTHKEY" \
    --hostname=cursor-stack-structure \
    --accept-dns=true
  unset TS_AUTHKEY

  export ALL_PROXY="socks5h://localhost:1055/"
  export HTTP_PROXY="http://localhost:1054/"
  export HTTPS_PROXY="http://localhost:1054/"
  export NO_PROXY="localhost,127.0.0.1"
  export NODE_USE_ENV_PROXY=1
  echo "[cloud-agent] Tailscale userspace networking is ready."
}

validate_secret_mode() {
  local have_token=0
  local have_project=0
  [[ -n "${BWS_ACCESS_TOKEN:-}" ]] && have_token=1
  [[ -n "${BWS_PROJECT_ID:-}" ]] && have_project=1

  if ((have_token != have_project)); then
    echo "[cloud-agent] Set both BWS_ACCESS_TOKEN and BWS_PROJECT_ID, or neither." >&2
    exit 1
  fi

  if ((have_token)); then
    command -v bws >/dev/null 2>&1 || {
      echo "[cloud-agent] bws is not installed." >&2
      exit 1
    }
    if ! bws project get "$BWS_PROJECT_ID" >/dev/null; then
      echo "[cloud-agent] BWS authentication/project access failed." >&2
      exit 1
    fi
    echo "[cloud-agent] Bitwarden project access is valid." >&2
    echo "bws"
  else
    echo "cursor"
  fi
}

start_app() {
  local mode="$1"
  if [[ "$mode" == "bws" ]]; then
    echo "[cloud-agent] Starting SVS Studio with Bitwarden-injected app secrets."
    bws run --project-id "$BWS_PROJECT_ID" -- \
      bun run dev --hostname 0.0.0.0 --port 3000 &
  else
    echo "[cloud-agent] Starting SVS Studio with Cursor environment-scoped secrets."
    bun run dev --hostname 0.0.0.0 --port 3000 &
  fi
  APP_PID=$!
  wait "$APP_PID"
}

start_tailscale
secret_mode="$(validate_secret_mode)"
start_app "$secret_mode"
