# Dearlly backend

FastAPI API and Celery worker. Python 3.12.

| Path | What |
| --- | --- |
| `app/main.py` | `create_app()`: settings, middleware, routes |
| `app/core/` | Settings (production refuses insecure config), JSON logging with redaction, request IDs and security headers, plans and feature checks, YAML registries |
| `app/api/` | HTTP routes (`/health`, `/ready` so far) |
| `app/db/`, `app/models/` | SQLAlchemy base, sessions, models |
| `app/worker.py` | Celery app (worker and beat) |
| `config/*.yaml` | Registries: experience types, cities, game formats |
| `migrations/` | Alembic migrations |

## Dependencies

Runtime packages are listed in `requirements.in`, dev tools in `requirements-dev.in`. Both are locked with
hashes into `requirements.txt` / `requirements-dev.txt`, using only releases at least 14 days old
(matching Dependabot's cooldown). After editing a `.in` file, with CUTOFF = today minus 14 days:

```
uv pip compile requirements.in --python-version 3.12 --generate-hashes --exclude-newer CUTOFF -o requirements.txt
uv pip compile requirements-dev.in --python-version 3.12 --generate-hashes --exclude-newer CUTOFF -o requirements-dev.txt
```

Dependabot reads these `.in`/`.txt` pairs and keeps them up to date weekly.

## Checks (same as CI)

```
pip install --require-hashes -r requirements-dev.txt
ruff format --check . && ruff check . && mypy && pytest
alembic upgrade head   # needs DATABASE_URL pointing at a Postgres 16
```
