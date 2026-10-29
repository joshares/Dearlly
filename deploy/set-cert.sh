#!/usr/bin/env bash
# Installs the Cloudflare Origin certificate and its private key with a hidden prompt.
# Run from the Mac:
#
#   ssh -t dearlly sudo /opt/dearlly/deploy/set-cert.sh
#
# Paste the certificate, then the private key, from Cloudflare (SSL/TLS -> Origin Server).
# The key is never shown on screen. Both are checked to be valid and to match each other.

set -euo pipefail

CERT_DIR="/etc/caddy/certs"

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
getent group caddy >/dev/null || { echo "Run caddy-setup.sh first (installs Caddy)." >&2; exit 1; }

# Reads lines until the PEM block's END line.
read_pem() {
  local end_marker="$1" hidden="$2" line pem=""
  if [[ "$hidden" == "yes" ]]; then stty -echo; fi
  while IFS= read -r line; do
    pem+="$line"$'\n'
    [[ "$line" == *"$end_marker"* ]] && break
  done
  if [[ "$hidden" == "yes" ]]; then stty echo; echo; fi
  printf '%s' "$pem"
}

tmp="$(mktemp -d)"
trap 'stty echo 2>/dev/null || true; rm -rf "$tmp"' EXIT

echo "1/2 Paste the ORIGIN CERTIFICATE (from -----BEGIN CERTIFICATE----- to the END line):"
read_pem "-----END CERTIFICATE-----" no > "$tmp/origin.pem"
openssl x509 -in "$tmp/origin.pem" -noout 2>/dev/null || { echo "That isn't a valid certificate." >&2; exit 1; }

echo "2/2 Paste the PRIVATE KEY (it stays hidden; paste it all, it ends with an END line):"
read_pem "-----END" yes > "$tmp/origin.key"
openssl pkey -in "$tmp/origin.key" -noout 2>/dev/null || { echo "That isn't a valid private key." >&2; exit 1; }

cert_pub="$(openssl x509 -in "$tmp/origin.pem" -noout -pubkey | openssl sha256)"
key_pub="$(openssl pkey -in "$tmp/origin.key" -pubout | openssl sha256)"
[[ "$cert_pub" == "$key_pub" ]] || { echo "The key doesn't belong to that certificate." >&2; exit 1; }

install -d -m 750 -o root -g caddy "$CERT_DIR"
install -m 644 -o root -g caddy "$tmp/origin.pem" "$CERT_DIR/origin.pem"
install -m 640 -o root -g caddy "$tmp/origin.key" "$CERT_DIR/origin.key"

echo "Saved. Valid until: $(openssl x509 -in "$CERT_DIR/origin.pem" -noout -enddate | cut -d= -f2)"
echo "Covers: $(openssl x509 -in "$CERT_DIR/origin.pem" -noout -ext subjectAltName | tail -1 | xargs)"
if systemctl is-active --quiet caddy; then
  caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy && echo "Caddy reloaded."
fi
