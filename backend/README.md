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

Dependencies are listed in `pyproject.toml` and locked with hashes. After changing `pyproject.toml`:

```
uv pip compile pyproject.toml --python-version 3.12 --generate-hashes --no-header -o requirements.lock
uv pip compile pyproject.toml --extra dev --python-version 3.12 --generate-hashes --no-header -o requirements-dev.lock
```

## Checks (same as CI)

```
pip install --require-hashes -r requirements-dev.lock
ruff format --check . && ruff check . && mypy && pytest
alembic upgrade head   # needs DATABASE_URL pointing at a Postgres 16
```
