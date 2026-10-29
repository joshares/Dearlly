#!/usr/bin/env bash
# One-time setup for automatic deploys. Run on the MAC, in the Dearlly folder:
#
#   deploy/setup-ci-deploy.sh
#
# It asks for the Turnstile SITE key (the public one), then:
#   1. makes a deploy-only SSH key in a temporary folder,
#   2. installs the server side of it (deploy.sh + authorize-ci-key.sh, locked to "deploy" only),
#   3. stores the key, the server address and its fingerprint as GitHub secrets (never printed),
#   4. stores the Turnstile site key as a GitHub variable,
#   5. deletes the key from the Mac: GitHub keeps the only copy.

set -euo pipefail

REPO="joshares/Dearlly"
SERVER="dearlly" # the alias in ~/.ssh/config

cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Needs the GitHub CLI (gh)." >&2; exit 1; }
host="$(ssh -G "$SERVER" | awk '/^hostname /{print $2}')"
[[ -n "$host" ]] || { echo "No '$SERVER' entry in ~/.ssh/config." >&2; exit 1; }

read -rp "Paste the Turnstile SITE key (the public one), then press Enter: " site_key
[[ "$site_key" =~ ^[0-9A-Za-z_-]{10,}$ ]] || { echo "That doesn't look like a site key." >&2; exit 1; }

key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "github-deploy" -f "$key_dir/ci"

echo "1/4 Installing the deploy-only key on the server"
scp -q deploy/deploy.sh deploy/authorize-ci-key.sh "$SERVER:/opt/dearlly/deploy/"
ssh "$SERVER" 'sudo /opt/dearlly/deploy/authorize-ci-key.sh' < "$key_dir/ci.pub"

echo "2/4 Saving the deploy key in GitHub secrets"
gh secret set DEPLOY_SSH_KEY --repo "$REPO" < "$key_dir/ci"

echo "3/4 Saving the server address and fingerprint in GitHub secrets"
ssh-keyscan -t ed25519 "$host" 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS --repo "$REPO"
gh secret set DEPLOY_HOST --repo "$REPO" --body "$host"

echo "4/4 Saving the Turnstile site key"
gh variable set TURNSTILE_SITE_KEY --repo "$REPO" --body "$site_key"

echo
echo "All set. The deploy key's only copy is now in GitHub (removed from this Mac)."
echo "Next: merge PR #20 and watch the Actions tab."
