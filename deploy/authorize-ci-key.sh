#!/usr/bin/env bash
# Lets GitHub Actions deploy, and nothing else. Run from the Mac:
#
#   ssh dearlly 'sudo /opt/dearlly/deploy/authorize-ci-key.sh' < ~/.ssh/dearlly_deploy_ci.pub
#
# Adds the public key to ~deploy/.ssh/authorized_keys with a forced command: whatever the key
# asks for, the server only ever runs deploy.sh (which accepts just "deploy <commit sha>"),
# with no shell, no port forwarding and no terminal.

set -euo pipefail

KEYS="/home/deploy/.ssh/authorized_keys"
OPTIONS='command="/opt/dearlly/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty'

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
IFS= read -r key
[[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "Expected one ssh-ed25519 public key on stdin." >&2; exit 1; }
material="$(cut -d' ' -f2 <<<"$key")"

# Replace any earlier CI key, keep everything else (the founder's own key).
grep -v 'deploy/deploy.sh' "$KEYS" | grep -vF "$material" > "$KEYS.new" || true
printf '%s %s\n' "$OPTIONS" "$key" >> "$KEYS.new"
install -m 600 -o deploy -g deploy "$KEYS.new" "$KEYS"
rm -f "$KEYS.new"
echo "CI deploy key authorised (deploy-only)."
