#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: Trigger production deployments must run on VM100 Linux, not this workstation." >&2
  exit 1
fi

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:/usr/local/bin:$PATH"

deploy_env="${STACK_STRUCTURE_TRIGGER_DEPLOY_ENV:-$HOME/.config/project-stack-structure/trigger-deploy.env}"
trigger_stack="${TRIGGER_STACK_DIR:-/opt/triggerdev/trigger.dev/hosting/docker}"

[[ -f "$deploy_env" ]] || {
  echo "ERROR: Missing $deploy_env (sync the BWS deployment pointers first)." >&2
  exit 1
}
[[ -f "$trigger_stack/.env" ]] || {
  echo "ERROR: Trigger stack environment is missing at $trigger_stack/.env." >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$deploy_env"
# shellcheck disable=SC1090
source "$trigger_stack/.env"
set +a

[[ "${TRIGGER_ACCESS_TOKEN:-}" == tr_pat_* ]] || {
  echo "ERROR: TRIGGER_ACCESS_TOKEN is missing or is not a personal access token." >&2
  exit 1
}
[[ -n "${DOCKER_REGISTRY_USERNAME:-}" && -n "${DOCKER_REGISTRY_PASSWORD:-}" ]] || {
  echo "ERROR: VM100 Trigger registry credentials are missing." >&2
  exit 1
}

printf '%s' "$DOCKER_REGISTRY_PASSWORD" |
  docker login localhost:5000 -u "$DOCKER_REGISTRY_USERNAME" --password-stdin >/dev/null

bun install --frozen-lockfile

deploy_log="$(mktemp)"
trap 'rm -f "$deploy_log"' EXIT
set +e
CI=1 TRIGGER_API_URL=https://trigger.v1su4.dev \
  npx trigger.dev@4.5.3 deploy \
    --api-url https://trigger.v1su4.dev \
    --skip-update-check \
    --local-build \
    "$@" 2>&1 | tee "$deploy_log"
deploy_status="${PIPESTATUS[0]}"
set -e
[[ "$deploy_status" -eq 0 ]] || exit "$deploy_status"

if [[ " $* " == *" --dry-run "* ]]; then
  exit 0
fi

version="$(sed -nE 's/.*Version ([0-9]{8}\.[0-9]+) deployed.*/\1/p' "$deploy_log" | tail -1)"
deployment_code="$(sed -nE 's#.*deployments/([a-z0-9]+).*#\1#p' "$deploy_log" | tail -1)"
[[ -n "$version" && -n "$deployment_code" ]] || {
  echo "ERROR: Could not identify the Trigger deployment image tag." >&2
  exit 1
}

image="localhost:5000/trigger/proj_wlrcsfnmovzmdwzojzfe:${version}.production.${deployment_code}"
docker image inspect "$image" >/dev/null
docker push "$image"
echo "Published $image to VM100's Trigger registry"
