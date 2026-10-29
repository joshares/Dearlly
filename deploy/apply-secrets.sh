#!/usr/bin/env bash
# Restarts the app (same version) so secrets saved with set-secret.sh take effect.
# Run from the Mac:
#
#   ssh dearlly /opt/dearlly/deploy/apply-secrets.sh
#
# Containers read .env.production only when they start. The database and Redis keep running;
# only the API, worker, scheduler and website are recreated.

set -euo pipefail

cd /opt/dearlly
tag="$(cat .deployed)"
[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || { echo "No deployed version found." >&2; exit 1; }

echo "Restarting ${tag:0:7} with the current secrets"
IMAGE_TAG="$tag" docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --force-recreate --no-deps migrate api worker beat web

for _ in $(seq 1 24); do
  if curl -fsS -o /dev/null http://127.0.0.1:8100/health && curl -fsS -o /dev/null http://127.0.0.1:3100/; then
    echo "Healthy. New secrets are in use."
    exit 0
  fi
  sleep 5
done
echo "The app did not come back healthy. Recent API logs:" >&2
IMAGE_TAG="$tag" docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 30 api >&2
exit 1
