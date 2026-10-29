#!/usr/bin/env bash
# Saves one secret on the server with a hidden prompt. Run from the Mac:
#
#   ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh NAME
#   ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh SECRET_KEY --generate
#
# The value is never shown, never sent through chat and never stored in git. It goes into
# /opt/dearlly/.env.production (owner deploy, mode 600). Run it again to overwrite.

set -euo pipefail

ENV_FILE="/opt/dearlly/.env.production"
OWNER="deploy"

usage() {
  echo "Usage: set-secret.sh NAME [--generate]   (NAME like RESEND_API_KEY)" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
name="${1:-}"
[[ "$name" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]] || usage

if [[ "${2:-}" == "--generate" ]]; then
  value="$(head -c 512 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 64)"
  [[ ${#value} -eq 64 ]] || { echo "Could not generate a value; try again." >&2; exit 1; }
  echo "Generated a random 64-character value for $name."
else
  read -rsp "Paste the value for $name (it stays hidden), then press Enter: " value
  echo
fi

[[ -n "$value" ]] || { echo "Nothing entered; nothing saved." >&2; exit 1; }
# Docker reads this file line by line; values are stored in single quotes.
[[ "$value" != *$'\n'* && "$value" != *"'"* ]] || {
  echo "Values can't contain line breaks or single quotes." >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || install -m 600 -o "$OWNER" -g "$OWNER" /dev/null "$ENV_FILE"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
grep -v "^${name}=" "$ENV_FILE" > "$tmp" || true
printf "%s='%s'\n" "$name" "$value" >> "$tmp"
install -m 600 -o "$OWNER" -g "$OWNER" "$tmp" "$ENV_FILE"
echo "Saved $name."
