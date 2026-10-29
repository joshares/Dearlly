#!/usr/bin/env bash
# Installs the backup tools and the nightly timer. Run ONCE from the Mac:
#
#   ssh -t dearlly sudo /opt/dearlly/deploy/backup-setup.sh
#
# Timer: every night at 01:30 UTC (02:30 in Lagos), before the 03:00 UTC update-reboot window.

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }

apt-get -yq install age >/dev/null
echo "Installed: age $(age --version)"
# rclone runs from its official Docker image (see backup.sh); Ubuntu's copy is too old for R2.
docker pull -q rclone/rclone:1.75.2 >/dev/null && echo "rclone image ready"

cat > /etc/systemd/system/dearlly-backup.service <<'EOF'
[Unit]
Description=Dearlly nightly encrypted database backup to R2
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=deploy
Group=deploy
ExecStart=/opt/dearlly/deploy/backup.sh
EOF

cat > /etc/systemd/system/dearlly-backup.timer <<'EOF'
[Unit]
Description=Run the Dearlly backup every night

[Timer]
OnCalendar=*-*-* 01:30:00 UTC
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now dearlly-backup.timer
echo "Next backup: $(systemctl list-timers dearlly-backup.timer --no-pager | sed -n 2p | awk '{print $1, $2, $3, $4}')"
