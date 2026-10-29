#!/usr/bin/env bash
# Makes the backup encryption key pair. Run ONCE from the Mac:
#
#   ssh -t dearlly sudo /opt/dearlly/deploy/backup-key.sh
#
# Shows the PRIVATE key on your screen once: save it in your password manager straight away.
# Only the PUBLIC half is kept on the server (BACKUP_AGE_RECIPIENT), so the server can lock
# backups but never unlock them. Without the private key, backups can't be restored.

set -euo pipefail

ENV_FILE="/opt/dearlly/.env.production"
OWNER="deploy"

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
command -v age-keygen >/dev/null || { echo "Run backup-setup.sh first (installs age)." >&2; exit 1; }
if grep -q '^BACKUP_AGE_RECIPIENT=' "$ENV_FILE" 2>/dev/null && [[ "${1:-}" != "--replace" ]]; then
  echo "A backup key already exists. Old backups need the OLD private key." >&2
  echo "To make a new one anyway: backup-key.sh --replace" >&2
  exit 1
fi

key="$(age-keygen 2>/dev/null)"
public="$(grep -o 'age1[0-9a-z]*' <<<"$key" | head -1)"
private="$(grep '^AGE-SECRET-KEY-' <<<"$key")"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
grep -v '^BACKUP_AGE_RECIPIENT=' "$ENV_FILE" > "$tmp" || true
printf "BACKUP_AGE_RECIPIENT='%s'\n" "$public" >> "$tmp"
install -m 600 -o "$OWNER" -g "$OWNER" "$tmp" "$ENV_FILE"

cat <<EOF

Save this PRIVATE backup key in your password manager NOW, as
"Dearlly backup key". It is shown only once and is NOT kept on the server:

    $private

Without it, backups cannot be restored. Never send it in chat.
Press Enter when it's saved (the screen will be cleared).
EOF
read -r _
clear
echo "Backup key ready. The server keeps only the public half."
