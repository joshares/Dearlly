#!/usr/bin/env bash
# Deploys one commit. This is the ONLY thing the GitHub deploy key can run on the server
# (it is the key's forced command in ~deploy/.ssh/authorized_keys; see authorize-ci-key.sh).
#
# GitHub Actions runs:   ssh deploy@server "deploy <40-character commit sha>"
# and sends on stdin:    line 1 = a short-lived registry token, then a .tar.gz holding
#                        docker-compose.prod.yml and deploy/ from that commit.
#
# Steps: pull the images for that commit, run migrations, start everything, check health.
# If the new version isn't healthy within 2 minutes, it switches back to the previous one.

set -euo pipefail

APP_DIR="/opt/dearlly"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
STATE_FILE=".deployed"
REGISTRY="ghcr.io"

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}"
if [[ "${verb:-}" != "deploy" || ! "${sha:-}" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo "Refused: this key can only run 'deploy <commit sha>'." >&2
  exit 1
fi

token=""
IFS= read -r token || true
[[ -n "$token" ]] || { echo "No registry token received." >&2; exit 1; }

work="$(mktemp -d)"
export DOCKER_CONFIG="$work/docker" # registry login lives here and is deleted at the end
trap 'docker logout "$REGISTRY" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

log "Receiving files for ${sha:0:7}"
mkdir -p "$work/bundle"
tar -xzf - -C "$work/bundle" --no-same-owner "$COMPOSE_FILE" deploy
install -m 644 "$work/bundle/$COMPOSE_FILE" "$APP_DIR/$COMPOSE_FILE"
mkdir -p "$APP_DIR/deploy"
cp -R "$work/bundle/deploy/." "$APP_DIR/deploy/"
chmod 755 "$APP_DIR"/deploy/*.sh

cd "$APP_DIR"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE: set the secrets first." >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

healthy() {
  for _ in $(seq 1 24); do
    if curl -fsS -o /dev/null http://127.0.0.1:8100/health \
      && curl -fsS -o /dev/null http://127.0.0.1:3100/; then
      return 0
    fi
    sleep 5
  done
  return 1
}

log "Pulling images"
printf '%s' "$token" | docker login "$REGISTRY" -u deploy --password-stdin >/dev/null
IMAGE_TAG="$sha" compose pull --quiet api web

previous="$(cat "$STATE_FILE" 2>/dev/null || true)"

log "Starting ${sha:0:7} (migrations run first)"
if IMAGE_TAG="$sha" compose up -d --remove-orphans && healthy; then
  echo "$sha" > "$STATE_FILE"
  log "Live: ${sha:0:7}"
  docker image prune -af --filter "until=168h" >/dev/null || true
  exit 0
fi

echo "New version is not healthy. Recent API logs:" >&2
IMAGE_TAG="$sha" compose logs --tail 40 api migrate >&2 || true
if [[ -n "$previous" ]]; then
  log "Rolling back to ${previous:0:7}"
  IMAGE_TAG="$previous" compose up -d --remove-orphans
fi
exit 1
