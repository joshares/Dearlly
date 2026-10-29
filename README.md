# Dearlly

Romantic experiences, sent like love letters. Love notes, date and vacation invitations, gift reveals,
two-player romantic games and a stamp photo community — for Nigeria, starting with Lagos and Abuja.

The code is built stage by stage by Claude Code, following `docs/build-plan.md`. The current stage is
in the **Where we are** section of that file.

## How changes reach `main` (founder steps)

1. Claude Code works on a branch and opens a **pull request** (PR) with a plain-English summary.
2. On GitHub, open the PR and scroll to the bottom. Wait until every check shows a **green tick**.
3. Do any "pre-merge steps" Claude Code listed, then click **Merge pull request** → **Confirm merge**.
4. Never merge with a red cross or a yellow dot.

## Running it on a Mac (for development)

Needs Docker Desktop running (whale icon in the menu bar).

```
cp .env.example .env
docker compose up --build
```

Then open http://localhost:3100. The API answers at http://localhost:8100/health.

## What's in here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Rules and context Claude Code reads every session |
| `SECURITY.md` | How to report a security problem, and the security standard we follow |
| `docs/build-plan.md` | The full plan: features, stages, security, costs, launch checklist |
| `docs/project-playbook.md` | How we build (from Statabet), with the Dearlly brief filled in |
| `docs/first-prompt.md` | The Stage 1 prompt (already used) |
| `design/brand/brand.md` | Colours, fonts, animation ideas, illustrator brief |
| `design/illustrations/`, `design/rive/` | The illustrator's files and Rive animations |
| `backend/` | FastAPI API, Celery worker, database migrations, tests, YAML registries |
| `frontend/` | Next.js web app |
| `deploy/` | Server setup, deploy and secret scripts (Stage 3) |
| `scripts/` | Checks and the demo seed (refuses to run in production) |
| `.github/` | Automatic checks (CI) and Dependabot |
| `.env.example` | The settings the app reads, with safe local-only values. Real secrets never go in git |
