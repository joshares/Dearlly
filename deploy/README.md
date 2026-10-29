# Server (Hostinger KVM 2, Ubuntu 24.04)

The server's IP address is **not** written in this public repo: keeping the origin hidden behind
Cloudflare is part of the protection. It lives only in `~/.ssh/config` on the founder's Mac.

## One-time: Mac SSH settings

`~/.ssh/config` on the Mac (replace `SERVER_IP`):

```
Host dearlly
  HostName SERVER_IP
  User deploy
  IdentityFile ~/.ssh/dearlly_ed25519
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes

# Only for the very first setup run; root login is switched off afterwards.
Host dearlly-root
  HostName SERVER_IP
  User root
  IdentityFile ~/.ssh/dearlly_ed25519
  IdentitiesOnly yes
  UseKeychain yes
```

## One-time: harden the server

From the repo folder on the Mac:

```
ssh dearlly-root 'bash -s' < deploy/server-setup.sh
```

Then, in a new Terminal window, `ssh dearlly` must work before closing the first one.
After this, `ssh dearlly-root` stops working on purpose (root login is off).

What `server-setup.sh` does: admin user `deploy` (key only, sudo), SSH hardening (no root, no
passwords), ufw (SSH rate-limited, HTTPS only from Cloudflare's IPs), fail2ban, automatic
security updates (reboots at 04:00 Lagos time if needed), Docker from Docker's repository with log
rotation, and `/opt/dearlly`. It's safe to re-run.

## HTTPS: Cloudflare → Caddy → app

- `Caddyfile`: Caddy runs as a system service (not in Docker, so ufw applies), listens on 443
  only, uses the Cloudflare Origin certificate and requires Cloudflare's client certificate
  (Authenticated Origin Pulls). `dearlly.app` → web (127.0.0.1:3100), `api.dearlly.app` → API
  (127.0.0.1:8100), `www` → redirect to `dearlly.app`.
- `caddy-setup.sh`: installs Caddy and Cloudflare's origin-pull CA; run again after the certificate
  is in place to start it.
- `set-cert.sh`: pastes the Origin certificate and private key in with a hidden prompt, checks they
  are valid and match.

Copy the scripts to the server, then run them (Mac, repo folder):

```
scp -r deploy dearlly:/opt/dearlly/
ssh -t dearlly sudo /opt/dearlly/deploy/caddy-setup.sh
ssh -t dearlly sudo /opt/dearlly/deploy/set-cert.sh
ssh -t dearlly sudo /opt/dearlly/deploy/caddy-setup.sh
```

## Secrets

```
ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh NAME             # hidden prompt
ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh SECRET_KEY --generate
```

Saved to `/opt/dearlly/.env.production` (owner `deploy`, mode 600). Never in git, never in chat.

Still to come in Stage 3: production Compose + deploys on merge, encrypted backups to R2, monitoring,
email (Resend + backup provider), Google sign-in keys.
