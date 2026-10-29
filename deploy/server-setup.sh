#!/usr/bin/env bash
# Hardens a fresh Hostinger Ubuntu 24.04 VPS for Dearlly. Run ONCE, as root, from the Mac:
#
#   ssh dearlly-root 'bash -s' < deploy/server-setup.sh
#
# What it does (playbook section 6, step 4):
#   1. System updates and the security tools below.
#   2. Admin user "deploy" with the same SSH key root has, and sudo.
#   3. SSH: keys only, no root login, no passwords, only "deploy" may log in.
#   4. Firewall (ufw): everything closed except SSH (rate-limited) and HTTPS from Cloudflare only.
#   5. fail2ban (bans IPs that keep failing SSH) and automatic security updates.
#   6. Docker from Docker's official repository, with log rotation.
#   7. /opt/dearlly for the app, owned by "deploy".
# It is safe to run again: every step checks before it changes anything.

set -euo pipefail

ADMIN_USER="deploy"
APP_DIR="/opt/dearlly"

log() { printf '\n==> %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this as root." >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[[ "$ID" == "ubuntu" && "$VERSION_ID" == "24.04" ]] || { echo "Expected Ubuntu 24.04." >&2; exit 1; }
[[ -s /root/.ssh/authorized_keys ]] || {
  echo "Root has no SSH key in /root/.ssh/authorized_keys. Add one in Hostinger first." >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive

log "1/7 Updating the system and installing security tools"
apt-get update -q
apt-get -yq upgrade
apt-get -yq install ufw fail2ban unattended-upgrades ca-certificates curl gnupg

log "2/7 Admin user '$ADMIN_USER' (SSH key only, no password)"
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$ADMIN_USER"
fi
usermod -aG sudo "$ADMIN_USER"
install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
install -m 600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys \
  "/home/$ADMIN_USER/.ssh/authorized_keys"
# No password exists to type, so sudo can't ask for one. The SSH key (with its passphrase)
# is the only way in.
echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-dearlly-admin
chmod 440 /etc/sudoers.d/90-dearlly-admin
visudo -cf /etc/sudoers.d/90-dearlly-admin

log "3/7 SSH: keys only, no root, only '$ADMIN_USER'"
# Files in sshd_config.d are read in order and the first value wins, so 10- beats
# Hostinger's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/10-dearlly.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $ADMIN_USER
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
EOF
sshd -t
systemctl reload ssh
# This open session stays connected; new logins must use "ssh dearlly".

log "4/7 Firewall: SSH (rate-limited) + HTTPS from Cloudflare only"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment "ssh"
cf_ips="$(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6)"
[[ -n "${cf_ips// /}" ]] || { echo "Could not download Cloudflare's IP list." >&2; exit 1; }
for ip in $cf_ips; do
  ufw allow proto tcp from "$ip" to any port 443 comment "cloudflare"
done
ufw --force enable
# Note: Docker can bypass ufw for ports it publishes on 0.0.0.0. Our containers bind to
# 127.0.0.1 only; the public HTTPS proxy (next step of Stage 3) is set up to respect this.

log "5/7 fail2ban and automatic security updates"
systemctl enable --now fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52dearlly-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
// 03:00 UTC = 04:00 in Lagos, the quietest hour.
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

log "6/7 Docker (official repository)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -yq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
    docker-compose-plugin
fi
install -d -m 755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl restart docker
usermod -aG docker "$ADMIN_USER"

log "7/7 App folder $APP_DIR"
install -d -m 750 -o "$ADMIN_USER" -g "$ADMIN_USER" "$APP_DIR"

log "Done. Summary:"
echo "  SSH users allowed: $ADMIN_USER (keys only; root login off)"
ufw status | sed -n '1,4p'
echo "  Cloudflare HTTPS rules: $(ufw status | grep -c cloudflare)"
echo "  fail2ban: $(systemctl is-active fail2ban)   auto-updates: $(systemctl is-active unattended-upgrades)"
echo "  $(docker --version)"
echo
echo "NEXT: in a NEW Terminal window on the Mac run:  ssh dearlly"
echo "Keep this window open until that works."
