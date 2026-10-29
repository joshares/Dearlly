# Project Playbook — how we build (based on Statabet)

> **For the AI reading this:** This file describes exactly how my previous project (Statabet, statabet.app — a football prediction + community web app) was planned, built, secured, hosted and launched. Use it as the standard for my new project. Follow the same process, quality bar and communication style unless I say otherwise. The new project's details are at the bottom under **"New project brief"**.

---

## 1. Who I am and how to work with me

- I'm a **non-developer founder** (Nigeria, timezone WAT / Africa/Lagos). I understand the product; I don't write code.
- **Two AI roles:**
  - **Advisor (this chat):** plans, explains, writes prompts for the builder, walks me through dashboards (Cloudflare, GitHub, hosting, email, payments), reviews what the builder says, writes docs/marketing.
  - **Builder (Claude Code in the VS Code extension, on my Mac):** writes the code, opens pull requests, runs commands, manages the server through scripts.
- **How to explain things to me:**
  - Plain language, **numbered step-by-step**, exact button names and where they are ("Cloudflare → statabet.app → DNS → Records → Add record").
  - Give commands in **copy-paste code blocks**, one at a time, and say **where** to run them (my Mac prompt `MacBookPro…` vs the server prompt `deploy@srv…`).
  - Tell me what success looks like ("wait for **Saved**", "should turn green").
  - When I paste a page, tell me what to click and what to skip. Use tables to compare options.
  - End with the exact message I should send to the builder.
  - Give a recommendation, not just options. Be honest about costs and trade-offs; cheapest *sensible* option first.
- **Secrets rule (non-negotiable):** never ask me to paste passwords, API keys, private keys, DSNs, backup keys or tokens into chat. Secrets go **only** into the server via a hidden prompt (`set-secret.sh`, below) or into my password manager. If I paste one by accident, tell me how to rotate it.

---

## 2. Process — stage by stage

### Stage 0 — Plan (before any code)
1. Ask the few questions that change the build (audience, country, money flow, legal/age limits, must-have features, budget).
2. Write a **Build Plan doc** (living document) with:
   - Product summary and who it's for
   - **Stages** (each small enough for a few PRs), with "done when" criteria
   - **Security standard** (section 3)
   - Plans/pricing and payment provider
   - Data sources / third-party APIs and their costs
   - **Launch checklist**
   - **"Where we are"** section, updated as stages finish
   - **"Changes to stages already built"** log (e.g. we later added username, date of birth, user search)
   - Feature sections broken into phases (e.g. Community phases A–D) with **honesty/anti-cheating rules**
3. Save the plan in the repo as `docs/build-plan.md` too.

### Typical stage order
| Stage | What |
|---|---|
| 0 | Plan doc, accounts list, domain choice |
| 1 | Foundation: repo layout, Docker Compose, API skeleton, DB + migrations, background worker, web app skeleton, CI + security scans, Dependabot |
| 2 | Accounts: signup/login, email verification, password reset, sessions, bot protection, profile basics |
| 3 | Core data: external APIs, ingestion jobs, data model, admin checks (coverage scripts) |
| 4 | Core feature (the thing users come for) + its accuracy/quality gate |
| 5 | Payments + plans (feature gating server-side) |
| 6 | Community/social (profiles, posts, follows, comments, likes, messages, search, leaderboard, moderation, reporting) |
| 7 | Production: server, Cloudflare, secrets, deploys, backups, monitoring, email inbox |
| 8 | Launch & growth: user guide, demo video, social posts, partnerships |

### How every change is made
1. Builder works on a branch → opens a **pull request (PR)** with a plain-English summary.
2. CI runs all checks → **only merge when all green**.
3. I merge → server **auto-deploys within ~5 minutes**.
4. Builder (or I) verify on the live site.
5. Any manual step for me comes as a numbered list ("pre-merge steps 1–5"), and I report back "done".
- One concern per PR. No direct pushes to `main`.
- Builder must say clearly if a feature I ask for doesn't exist yet rather than faking it.

---

## 3. Security standard ("Google-level")

Target **OWASP ASVS Level 2**. Minimum:

**Accounts & sessions**
- Passwords: **Argon2id**; min 10 chars; reject breached passwords via **HIBP k-anonymity range check**.
- Short-lived access tokens + **rotating refresh tokens** (reuse detection → revoke family).
- Cookies: `HttpOnly`, `Secure`, `SameSite`; **CSRF double-submit cookie** on state-changing requests.
- Email verification and password reset with single-use, expiring tokens.
- **Cloudflare Turnstile** on signup/login/reset.
- Rate limits (Redis) on login, signup, reset, posting, messaging.
- Age gate where the law needs it (date of birth, refuse under-18s, DOB private and not editable).
- Public username; email never shown publicly.

**API & app**
- Settings from environment only; production **refuses to start** with insecure settings (`http://` or `*` CORS, wildcard hosts).
- Secrets as `SecretStr` (never in logs/reprs); logs are JSON with a **redaction list** (password, token, cookie, api_key, secret…).
- Request IDs on every request; generic error responses (no stack traces).
- Security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors, Referrer-Policy); strip `Server` header.
- TrustedHost middleware; strict CORS allowlist.
- API docs (`/docs`) **disabled in production**.
- `/health` (liveness, supports HEAD for uptime monitors) and `/ready` (DB + Redis, 503 without details).
- Server-side authorisation on every endpoint; plan gating server-side.
- User content: length limits, no links/phone numbers/bank details where scams are a risk, text-only messages, report/block, can't edit/delete graded records.

**Containers**
- Non-root, read-only filesystem, `no-new-privileges`, dropped capabilities, healthchecks.
- All ports bound to `127.0.0.1`; only the reverse proxy is public.
- Minimal base images (we moved to Debian **trixie** slim; removed npm from runtime images to pass Trivy).

---

## 4. Default tech stack (reuse unless the project needs otherwise)

| Part | Choice |
|---|---|
| API | Python 3.12, **FastAPI**, Pydantic v2, SQLAlchemy 2 (async), **Alembic** migrations |
| Background jobs | **Celery + Redis** (worker + beat scheduler) |
| Database | **PostgreSQL 16** |
| Web app | **Next.js + TypeScript + Tailwind**, strict security headers |
| Config | YAML registries for things that should be easy to extend (e.g. `competitions.yaml`) |
| Packaging | Docker + Docker Compose (same locally and on the server) |
| CI | GitHub Actions |
| Errors | **Sentry** (EU region) |
| Uptime | **UptimeRobot** (keyword monitor on `/health` = `ok`) |
| Transactional email | **Resend** on a `send.` subdomain |
| Inbox | **Zoho Mail** (Mail Lite) — `hello@` main address, `partners@` alias |
| Payments (Nigeria) | **Paystack** |
| Hosting | **Hostinger KVM 2 VPS**, Ubuntu 24.04, EU location |
| DNS/CDN/WAF | **Cloudflare** (domain bought there) |
| Backups | Encrypted nightly DB dumps → **Cloudflare R2** (free tier) |

### Repo layout
```
backend/            app/ (api, core, db, models, services, worker.py), migrations/, tests/, config/*.yaml,
                    pyproject.toml, requirements.lock, requirements-dev.lock (hash-locked)
frontend/           Next.js app, package-lock.json
infra/ or deploy/   server setup notes, deploy.sh, set-secret.sh, backup scripts
scripts/            checks (e.g. data coverage), demo seed (refuses to run in production)
docs/               build-plan.md, runbooks
.github/            workflows/ci.yml, codeql.yml, deploy.yml; dependabot.yml
docker-compose.yml, .env.example, README.md, SECURITY.md
```

---

## 5. CI/CD and supply-chain rules

Every PR runs:
- Backend: ruff lint + format check, mypy, pytest, `alembic upgrade head`, **pip-audit** (`--require-hashes`)
- Frontend: lint, typecheck, build, tests, `npm audit --omit=dev --audit-level=high`, `npm ci --ignore-scripts`
- **gitleaks** (full history secret scan)
- **Semgrep** (python, typescript, react, nextjs, secrets, dockerfile, github-actions rulesets)
- **CodeQL** (security-extended)
- Image builds + **Trivy** image and config scans (HIGH/CRITICAL fail)

Rules:
- **Pin every GitHub Action to a full commit SHA** (comment the version).
- Workflows default to `permissions: contents: read`; `persist-credentials: false` on checkout.
- **Hash-locked Python deps** (`uv pip compile --generate-hashes`); `npm ci` from lockfile.
- **Trivy action ≥ 0.35.0** (older tags were compromised in March 2026).
- **Dependabot:** weekly, grouped minor/patch, **14-day cooldown**, **ignore major upgrades of core tools** (TypeScript, ESLint, Next, React, FastAPI, SQLAlchemy…) — majors are done deliberately by the builder.
- Deploy workflow: on merge to `main` → build images → push to GitHub Container Registry → server pulls with a **deploy-only SSH key** stored as an Actions secret.

### Lessons learned (avoid repeating)
- **Private repo + free GitHub:** CodeQL can't upload results and **branch protection/rulesets aren't enforced**. Either get **GitHub Pro** (~$4/mo) early, or gate CodeQL results inside CI. Until protected, **I must only merge PRs with all-green checks**.
- Dependabot merged TypeScript 7 / ESLint 10 majors and broke `main` (fixed by rollback PR) → hence the "no majors" rule.
- Ruleset for `main`: Active, empty bypass list, target default branch; restrict deletions, block force pushes, require PR (0 approvals when solo), require the CI status checks.
- In dev, emails are **logged, not sent**, unless `EMAIL_DELIVERY=resend` (avoids Resend 422s on unverified domains).
- Testing protected endpoints in `/docs`: click **Authorize** with the token, or CSRF fails.

---

## 6. Production setup (the order that worked)

1. **Buy domain** on Cloudflare (`.app` forces HTTPS — fine).
2. **VPS** (Hostinger KVM 2, Ubuntu 24.04, France/Germany). Choose a **12/24-month term** (monthly is much pricier).
3. **SSH key** login on my Mac (`~/.ssh/id_ed25519`), alias `statabet` in `~/.ssh/config` → `ssh statabet`.
4. **Harden server:** admin user, no root login, no passwords, `AllowUsers`, ufw (SSH from me, 443 **only from Cloudflare IPs**), fail2ban, unattended security upgrades, Docker from official repo.
5. **Cloudflare:**
   - DNS A records for `@`, `www`, `api` → server IP, **Proxied** (orange cloud).
   - SSL/TLS mode **Full (strict)** + **Origin CA certificate** installed on the server's reverse proxy.
   - **Authenticated Origin Pulls** (Global) so the server only accepts Cloudflare.
   - Turnstile site for the domain.
6. **Secrets** entered on the server only:
   ```
   ssh -t statabet sudo /opt/<project>/deploy/set-secret.sh NAME
   ```
   (hidden prompt → "Saved"; rerun to overwrite). Run from the **Mac**, not while logged into the server.
7. **Backups:** nightly encrypted dump → R2; **backup key saved in password manager** (useless without it). Test a restore.
8. **Monitoring:** Sentry DSN, alert email, UptimeRobot keyword monitor; builder runs a test backup, test error and test alert.
9. **Email:**
   - Resend: DKIM/SPF on `send.` subdomain.
   - Zoho: verify TXT, 3 MX, **one** SPF on root (`v=spf1 include:zohomail.com ~all` — merge, never two SPF records), DKIM (`zmail._domainkey`), **DMARC** `_dmarc` = `v=DMARC1; p=none; rua=mailto:hello@domain` (tighten later).
   - Zoho super-admin can't be deleted: add `hello@` alias → **make it the mailbox address**; add `partners@`; turn on TFA; set display name to the brand.
   - Contact form inbox set via `set-secret.sh CONTACT_INBOX`, then `deploy.sh --force`.
10. **GitHub Pro + main ruleset** (section 5).

### Monthly cost reference (Statabet)
VPS ~₦11k/mo (24-month term) · domain yearly · Zoho Mail Lite ~₦11.5k/yr · Cloudflare, R2, Sentry Developer, UptimeRobot, Resend free tiers · GitHub Pro ~$4/mo · data APIs as needed.

---

## 7. Product & honesty principles

- Show the real numbers and limits (e.g. model % vs bookmaker %, "picks are not guarantees", "an empty tier stays empty").
- **Verified vs unverified:** only what the platform can check counts toward ranks/leaderboards; external content is labelled unverified.
- Anti-cheating: graded records can't be edited/deleted; minimum sample sizes before ranking; one account per person.
- Regulated topics (gambling, finance, health): 18+ gates, responsible-use messages, no "sure/guaranteed/fixed" language, check local ad rules (Nigeria: ARCON vetting for paid gambling ads).
- **Never put fake/dummy data on production.** Demo data lives only in a local/demo copy, with obviously fake names (`*_demo`) and a visible "Demo account · sample data" label.
- Partnerships, not reverse-engineering: don't scrape or use private APIs of other companies; ask them for an official API (e.g. we emailed SportyBet for a booking-code API, offering exclusive conversion partnership).

---

## 8. Launch & growth kit

1. **User guide doc:** quick start (5 steps) + detailed sections (account, core feature, community, rules, responsible use), checked against the live site.
2. **Demo video (60s, vertical 9:16):**
   - Builder: demo seed script (refuses production) + **Playwright** script recording each scene at phone size with visible cursor, human typing, demo label; exports one MP4 per scene.
   - Advisor: edits into one video — branded intro/outro cards, step captions at top (works on mute), zooms on key moments, speed-ups, transitions, background music (original/royalty-free), loudness ~-16 LUFS, cover image.
   - Optional AI voiceover later (ElevenLabs) from a ~150-word script.
3. **Social posts:** 3 single-post options under 280 chars + a 5-post thread; keep 18+; max 1–2 hashtags.
4. **Partnership emails:** short, what we are, what we ask (API first), what they get, attach the video, send from `hello@`.
5. **Dependabot routine:** merge green PRs one at a time weekly; backend-affecting ones last; check site after deploy.

---

## 9. Pre-launch checklist (copy into the plan doc)
- [ ] All stages "done when" met; CI green on `main`
- [ ] Production refuses insecure config; `/docs` off in prod
- [ ] Cloudflare Full (strict), Origin cert, Authenticated Origin Pulls, firewall Cloudflare-only
- [ ] All secrets set on server; none in repo (gitleaks clean)
- [ ] Backups running + **restore tested**; backup key in password manager
- [ ] Sentry receiving errors; UptimeRobot green; alert email works
- [ ] Email: SPF, DKIM, DMARC pass; signup/reset emails land in inbox not spam
- [ ] Payments tested end-to-end (test + one real small payment), webhooks verified
- [ ] Terms, Privacy, Responsible-use pages live; age gate works
- [ ] GitHub Pro + `main` ruleset enforced
- [ ] User guide + demo video ready

---

## 10. New project brief (Dearlly)

- **Project name / working domain:** Dearlly (domain to buy on Cloudflare: check .app, .ng, .love)
- **What it does (one sentence):** Create and send animated romantic experiences (love notes, date and vacation invitations, gift reveals) and play two-player romantic games with a partner.
- **Who it's for / country:** adults 18+ in Nigeria, focus on Lagos and Abuja
- **How it makes money:** free at launch; later premium cards, season bundles, game packs, restaurant/hotel partners (Paystack)
- **Must-have features at launch:** see docs/build-plan.md (Features at launch)
- **Nice-to-have later:** public community feed, payments, partner bookings, long-distance game mode
- **Legal/age/regulatory concerns:** 18+ gate, Nigeria Data Protection Act 2023, messages to non-users (report/block/opt-out), photo moderation, no explicit content
- **External data or APIs needed:** AI model API, Resend, Cloudflare R2, Turnstile; curated places in config/cities.yaml (no Google Places at launch)
- **Budget per month:** about ₦13,000–₦20,000 at launch plus yearly items
- **Reuse from Statabet?** No. Fully separate: own server, Cloudflare account, Zoho org, repo. Same standards and stack.

### First instruction to the AI
> Read this playbook. Ask me only the questions that would change the build (max 5). Then write the Build Plan doc for the new project following section 2, with stages, security standard, costs and launch checklist. Then give me the first prompt to paste into Claude Code in VS Code to start Stage 1, and tell me exactly what accounts I need to create first.
