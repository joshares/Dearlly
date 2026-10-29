#!/usr/bin/env bash
# Installs Caddy (the HTTPS entrance) as a normal system service, not in Docker, so the
# ufw "Cloudflare only" rules apply to it. Run from the Mac, in the repo folder:
#
#   scp -r deploy dearlly:/opt/dearlly/
#   ssh -t dearlly sudo /opt/dearlly/deploy/caddy-setup.sh
#
# Run it once to install; then set-cert.sh; then this again to start Caddy. Safe to re-run.

set -euo pipefail

DEPLOY_DIR="/opt/dearlly/deploy"
CERT_DIR="/etc/caddy/certs"
# Cloudflare's public CA for Authenticated Origin Pulls (not a secret).
AOP_CA_URL="https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem"

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy from its official repository"
  apt-get -yq install debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get -yq install caddy
  # Don't serve Caddy's default welcome page before our config is in place.
  systemctl stop caddy
fi

echo "==> Cloudflare origin-pull CA"
install -d -m 750 -o root -g caddy "$CERT_DIR"
curl -fsSL "$AOP_CA_URL" -o "$CERT_DIR/cloudflare-origin-pull-ca.pem"
openssl x509 -in "$CERT_DIR/cloudflare-origin-pull-ca.pem" -noout
chmod 644 "$CERT_DIR/cloudflare-origin-pull-ca.pem"

if [[ ! -s "$CERT_DIR/origin.pem" || ! -s "$CERT_DIR/origin.key" ]]; then
  echo
  echo "Caddy is installed. NEXT: put the Cloudflare Origin certificate on the server:"
  echo "  ssh -t dearlly sudo /opt/dearlly/deploy/set-cert.sh"
  echo "then run this script again."
  exit 0
fi

echo "==> Caddy config"
install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy
systemctl is-active caddy
echo
echo "Caddy is running on port 443 (Cloudflare only)."
echo "The site shows a '502' error until the app is deployed in the next step: that's expected."
