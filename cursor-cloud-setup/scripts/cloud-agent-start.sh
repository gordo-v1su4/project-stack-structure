#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

require_env BWS_ACCESS_TOKEN
require_env BWS_SERVER_URL
require_env BWS_PROJECT_ID

TAILSCALED_PID=""

cleanup() {
  if [[ -n "$TAILSCALED_PID" ]] && kill -0 "$TAILSCALED_PID" 2>/dev/null; then
    sudo kill "$TAILSCALED_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -n "${TS_AUTHKEY:-}" ]]; then
  echo "[cloud-agent] Starting Tailscale (userspace networking)..."
  sudo tailscaled \
    --tun=userspace-networking \
    --outbound-http-proxy-listen=localhost:1054 \
    --socks5-server=localhost:1055 &
  TAILSCALED_PID=$!

  sleep 3

  export ALL_PROXY="socks5h://localhost:1055/"
  export HTTP_PROXY="http://localhost:1054/"
  export HTTPS_PROXY="http://localhost:1054/"

  sudo tailscale up --authkey="$TS_AUTHKEY" --accept-routes --hostname=cursor-stack-structure
else
  echo "[cloud-agent] TS_AUTHKEY not set — skipping Tailscale userspace setup (My Machines path?)" >&2
fi

echo "[cloud-agent] Waiting for BWS at $BWS_SERVER_URL ..."
for _ in $(seq 1 30); do
  if curl -sfk "${BWS_SERVER_URL%/}/alive" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -sfk "${BWS_SERVER_URL%/}/alive" >/dev/null 2>&1; then
  echo "[cloud-agent] BWS health check failed: ${BWS_SERVER_URL%/}/alive" >&2
  exit 1
fi

export PATH="$HOME/.bun/bin:$PATH"

echo "[cloud-agent] Starting dev server with bws-injected secrets..."
exec bws run --project-id "$BWS_PROJECT_ID" -- \
  bun run dev --hostname 0.0.0.0 --port 3000
