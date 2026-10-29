#!/usr/bin/env bash
# Nightly database backup: dump -> encrypt (age) -> upload to Cloudflare R2. Keeps 35 days.
# Runs as "deploy" from the systemd timer installed by backup-setup.sh. Manual run:
#
#   ssh dearlly /opt/dearlly/deploy/backup.sh
#
# Encrypted to BACKUP_AGE_RECIPIENT (a public key). The matching private key is only in the
# founder's password manager, so neither this server nor R2 can read old backups.

set -euo pipefail

ENV_FILE="/opt/dearlly/.env.production"
CONTAINER="dearlly-postgres-1"
BUCKET="dearlly-backups"
KEEP="35d"

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }

# The file holds simple NAME='value' lines written by set-secret.sh.
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
for var in BACKUP_AGE_RECIPIENT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT; do
  [[ -n "${!var:-}" ]] || { echo "Missing $var: set it with set-secret.sh" >&2; exit 1; }
done

# rclone remote "r2", configured from the environment only (nothing written to disk).
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

# Ubuntu's rclone (1.60) mishandles uploads to R2, so use the official image, pinned.
RCLONE_IMAGE="rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5"
rclone() {
  # Only "rcat" reads from stdin; other commands must not swallow the caller's input.
  local stdin_flag=()
  [[ "$1" == "rcat" ]] && stdin_flag=(-i)
  docker run --rm "${stdin_flag[@]}" --user "$(id -u):$(id -g)" \
    -e RCLONE_CONFIG=/dev/null -e RCLONE_CONFIG_R2_TYPE -e RCLONE_CONFIG_R2_PROVIDER \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_R2_ENDPOINT -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET \
    -v "${RCLONE_WORKDIR:-/tmp}:/work" -w /work "$RCLONE_IMAGE" "$@"
}

name="db/dearlly-$(date -u +%Y%m%d-%H%M%S).dump.age"
log "Backing up to r2:$BUCKET/$name"
docker exec "$CONTAINER" pg_dump -U dearlly -d dearlly --format=custom --compress=9 \
  | age -r "$BACKUP_AGE_RECIPIENT" \
  | rclone rcat "r2:$BUCKET/$name"

size="$(rclone size --json "r2:$BUCKET/$name" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
[[ "$size" -gt 100 ]] || { echo "Backup looks empty ($size bytes)." >&2; exit 1; }
log "Uploaded $size bytes"

rclone delete --min-age "$KEEP" "r2:$BUCKET/db/"
log "Removed backups older than $KEEP. Done."
