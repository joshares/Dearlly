#!/usr/bin/env bash
# Proves the latest backup can be restored, without touching the live database. From the Mac:
#
#   ssh -t dearlly /opt/dearlly/deploy/restore-test.sh
#
# Downloads the newest backup, unlocks it with the private backup key (hidden prompt; paste it
# from the password manager), restores it into a throwaway Postgres container, counts what came
# back, then deletes the container and the unlocked copy.

set -euo pipefail

ENV_FILE="/opt/dearlly/.env.production"
BUCKET="dearlly-backups"
TEST_CONTAINER="dearlly-restore-test"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
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

work="$(mktemp -d)"
cleanup() {
  docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

latest="$(rclone lsf "r2:$BUCKET/db/" | sort | tail -1)"
[[ -n "$latest" ]] || { echo "No backups found in R2." >&2; exit 1; }
echo "Latest backup: $latest"
RCLONE_WORKDIR="$work" rclone copyto "r2:$BUCKET/db/$latest" /work/backup.age

read -rsp "Paste the PRIVATE backup key (hidden), then press Enter: " private_key
echo
printf '%s\n' "$private_key" > "$work/key.txt"
chmod 600 "$work/key.txt"
unset private_key
age -d -i "$work/key.txt" -o "$work/backup.dump" "$work/backup.age"
rm -f "$work/key.txt"
echo "Unlocked."

docker run -d --name "$TEST_CONTAINER" -e POSTGRES_PASSWORD=restore-test-only \
  -e POSTGRES_DB=restore postgres:16-trixie >/dev/null
for _ in $(seq 1 30); do
  docker exec "$TEST_CONTAINER" pg_isready -U postgres -q 2>/dev/null && break
  sleep 1
done
docker cp "$work/backup.dump" "$TEST_CONTAINER:/tmp/backup.dump"
docker exec "$TEST_CONTAINER" pg_restore -U postgres -d restore --no-owner /tmp/backup.dump

echo
echo "Restored into a throwaway database. What came back:"
docker exec "$TEST_CONTAINER" psql -U postgres -d restore -At -c \
  "SELECT 'tables: ' || count(*) FROM information_schema.tables WHERE table_schema = 'public';"
docker exec "$TEST_CONTAINER" psql -U postgres -d restore -At -c \
  "SELECT 'accounts: ' || count(*) FROM users;"
docker exec "$TEST_CONTAINER" psql -U postgres -d restore -At -c \
  "SELECT 'schema version: ' || version_num FROM alembic_version;"
echo
echo "RESTORE TEST PASSED. The throwaway copy is being deleted."
