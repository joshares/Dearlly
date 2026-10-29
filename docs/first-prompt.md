# First prompt for Claude Code (Stage 1)

Do the START HERE steps in `README.md` first (GitHub repo created, first commit pushed).
Then copy everything inside the box below and paste it into Claude Code in VS Code.

```
You are the builder for Dearlly, a new project. Read docs/project-playbook.md (how we work, our security
standard, CI rules, lessons learned) and docs/build-plan.md (this product) fully before doing anything.
Dearlly is completely separate from Statabet: no shared code, server or accounts. Reuse the same
standards and tech stack.

Do Stage 1 (Foundation) only, as small PRs, one concern each, on branches (never push to main):

1. Repo layout exactly as in the build plan (backend/, frontend/, deploy/, scripts/, docs/, .github/),
   README.md, SECURITY.md, .env.example, .gitignore.
2. Docker Compose: api (FastAPI), worker + beat (Celery), postgres 16, redis, web (Next.js).
   Non-root, read-only filesystems, no-new-privileges, dropped capabilities, healthchecks, ports on
   127.0.0.1 only, Debian trixie slim images.
3. Backend skeleton: settings from environment with production refusing insecure config, SecretStr,
   JSON logs with redaction list, request IDs, security headers, TrustedHost, strict CORS, /docs off in
   production, /health (supports HEAD) and /ready. Alembic set up with a first empty migration.
   A `plan` field and a server-side feature-check helper ready for later paid features.
   Empty YAML registries: config/experience_types.yaml, config/cities.yaml, config/game_formats.yaml.
4. Frontend skeleton: Next.js + TypeScript + Tailwind with strict security headers. Design tokens from
   the build plan (Paper #F3EADB, Ink #1F2A6B, Stamp red #D7392B, Kraft #C89B6D, dark mode = ink
   background), fonts Gloock, Figtree and Homemade Apple self-hosted, translation files set up.
   A placeholder home page in the Dearlly style, mobile-first, with bottom navigation.
5. CI exactly as playbook section 5: ruff, mypy, pytest, alembic upgrade head, pip-audit with hashes,
   frontend lint/typecheck/build/tests, npm audit, gitleaks, Semgrep, CodeQL, Trivy >= 0.35.0, all
   actions pinned to commit SHAs, contents: read, persist-credentials: false.
6. Dependabot: weekly, grouped minor/patch, 14-day cooldown, ignore majors of core tools.

For every PR give me a plain-English summary and any manual steps as a numbered list. Tell me if
anything in the plan is unclear rather than guessing. Stop after Stage 1 and tell me what's done.
```

When Stage 1 is merged and every check is green, send:

```
Stage 1 is merged and green. Update "Where we are" in docs/build-plan.md, then start Stage 2 (Accounts).
```
