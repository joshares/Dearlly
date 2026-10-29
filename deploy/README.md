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

Production secrets (all via `set-secret.sh`): `SECRET_KEY` and `POSTGRES_PASSWORD` (both
`--generate`), `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`; later `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. Public settings are in `docker-compose.prod.yml`.

## Deploys (automatic on merge to `main`)

CI → **Publish images** (only after all checks pass) → **Deploy to dearlly.app**:

1. Images are built and pushed to GitHub's registry, tagged with the commit (`ghcr.io/joshares/dearlly-{api,web}:<sha>`).
2. The deploy job connects with a **deploy-only SSH key**. On the server that key's forced command is
   `deploy.sh`, which accepts only `deploy <commit sha>`: no shell, no forwarding.
3. `deploy.sh` pulls that commit's images with a short-lived token (logged out afterwards), runs
   migrations, starts everything, waits up to 2 minutes for `/health` and the home page, and **rolls
   back to the previous version** if they don't come up.

GitHub settings it needs (repository **secrets**): `DEPLOY_HOST` (server IP), `DEPLOY_SSH_KEY`
(private deploy key), `DEPLOY_KNOWN_HOSTS` (server's SSH fingerprint); and repository **variable**
`TURNSTILE_SITE_KEY` (public). Authorise the deploy key on the server with `authorize-ci-key.sh`.

Manual redeploy of the current version: re-run the latest CI run on `main` in GitHub Actions.

## Backups (nightly, encrypted, Cloudflare R2)

- `backup.sh`: `pg_dump` → encrypted with **age** to a public key → uploaded to R2 bucket
  `dearlly-backups` under `db/`. Keeps 35 days. Runs at 01:30 UTC (02:30 Lagos) via the
  `dearlly-backup.timer` systemd timer.
- The **private** backup key exists only in the founder's password manager ("Dearlly backup key").
  The server and R2 can't read old backups. **Lose that key = backups can't be restored.**
- `restore-test.sh`: restores the newest backup into a throwaway Postgres and counts what came
  back. Run it after setup and every few months.

One-time setup (Mac):

```
ssh -t dearlly sudo /opt/dearlly/deploy/backup-setup.sh      # installs age, rclone, timer
ssh -t dearlly sudo /opt/dearlly/deploy/backup-key.sh        # shows the private key ONCE
ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh R2_ACCESS_KEY_ID
ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh R2_SECRET_ACCESS_KEY
ssh -t dearlly sudo /opt/dearlly/deploy/set-secret.sh R2_ENDPOINT
ssh dearlly /opt/dearlly/deploy/backup.sh                    # first backup now
ssh -t dearlly /opt/dearlly/deploy/restore-test.sh           # prove it restores
```

Still to come in Stage 3: monitoring (Sentry, UptimeRobot), Zoho inbox, Google sign-in keys, backup
email provider.
