# CLAUDE.md — instructions for the builder (Claude Code)

You are the **builder** for **Dearlly**. Read this file first, every session.

## What Dearlly is

A mobile-first web app for adults 18+ in Nigeria (focus: Lagos and Abuja) to create and send
romantic experiences — love notes, date invitations, vacation invitations, gift reveals — as an
animated private link or a downloadable PNG/PDF, plus two-player romantic games and a "stamp"
photo community. Brand idea: **a love-letter post office**.

Dearlly is **completely separate from Statabet**: no shared code, server, accounts or secrets.

## Read before any work

1. `docs/project-playbook.md` — how we work, security standard, CI rules, lessons learned. This is the quality bar.
2. `docs/build-plan.md` — the product, stages with "done when", security additions, costs, launch checklist.
3. The "Where we are" section of `docs/build-plan.md` — which stage is current.

If the plan and the playbook disagree, the build plan wins for product decisions and the playbook
wins for security and process. If something is unclear, ask — never guess or fake a feature.

## The founder (who you're talking to)

- Non-developer founder in Nigeria (WAT, Africa/Lagos). Understands the product, doesn't write code.
- Explain in plain language with **numbered steps**, exact button names, and what success looks like.
- Commands in copy-paste code blocks, one at a time, saying **where** to run them (Mac vs server).
- Give a recommendation, not just options. Be honest about costs and trade-offs.

## Non-negotiable rules

- **Secrets:** never ask the founder to paste passwords, API keys, tokens or private keys into chat.
  Secrets go only to the server via `deploy/set-secret.sh` (hidden prompt) or the password manager.
  Never commit secrets. `.env` files stay out of git.
- **Process:** work on a branch → open a PR with a plain-English summary → CI must be all green →
  the founder merges. One concern per PR. **Never push to `main`** (only exception: the very first
  starter commit, if the founder asks for it).
- **Manual steps** for the founder come as a numbered list ("pre-merge steps 1–5").
- **Stay in stage:** do only the current stage. Stop at the end of it and report what's done.
- **No fake data in production.** Demo data only via a seed script that refuses to run in production,
  with obviously fake names (`*_demo`).
- **Update `docs/build-plan.md`** "Where we are" and the changes log when a stage finishes or a decision changes.

## Product rules that affect code

- One experience engine: `experiences` table with a `type` field; types registered in
  `backend/config/experience_types.yaml`. Cities in `backend/config/cities.yaml`. Game formats in
  `backend/config/game_formats.yaml`. New types/cities/formats = config + form, not rebuilds.
- Games are **server-authoritative** (FastAPI WebSockets + Redis). The question bank never goes to
  the browser. Seen questions are stored per pair in the database.
- Private links: unguessable tokens (≥128 bits), `noindex`, revocable.
- Messages to non-users always carry Report, "Stop messages from this sender", "Never email me".
- Photos: private R2 bucket, signed links, GPS stripped, nudity check before display.
- 18+ everywhere; "Intense" games need both players 18+ and opted in; never explicit content.
- A `plan` field + server-side feature checks exist from Stage 1 so paid features can be switched on later.

## Design rules

- Tokens: Paper `#F3EADB` (background), Ink `#1F2A6B` (text; dark-mode background),
  Stamp red `#D7392B` (main actions, seals), Kraft `#C89B6D` (envelopes, borders).
- Fonts (self-hosted): **Gloock** headings, **Figtree** body/buttons, **Homemade Apple** handwritten touches.
- Animations: Rive for signature moments (envelope seal, wax seal crack, postmark, ink signature,
  scratch-to-reveal), Framer Motion / GSAP for page motion. Respect `prefers-reduced-motion`.
- Mobile-first: bottom navigation, tap targets ≥48px, fast on cheap Android + slow data.
- Avoid the "AI look": no purple-blue gradients, frosted glass, Inter, sparkle icons, 3D blobs.
- Illustrations from the commissioned illustrator go in `design/illustrations/`; Rive files in `design/rive/`
  (copied to `frontend/public/rive/` when used).

## Stack (from the playbook)

Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic · Celery + Redis · PostgreSQL 16 ·
Next.js + TypeScript + Tailwind · Docker Compose · GitHub Actions (ruff, mypy, pytest, pip-audit,
npm audit, gitleaks, Semgrep, CodeQL, Trivy ≥ 0.35.0, actions pinned to SHAs) · Sentry · UptimeRobot ·
Resend · Cloudflare (DNS, CDN, WAF, Turnstile, R2) · Hostinger VPS.
