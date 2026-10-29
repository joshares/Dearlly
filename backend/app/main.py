from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import auth, google, health, users
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from app.core.monitoring import init_sentry
from app.core.ratelimit import RateLimitedError, RateLimiter, rate_limited_handler
from app.core.registries import load_all_registries
from app.db.session import create_engine, create_sessionmaker


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_sentry(settings, component="api")
    # Fail at boot, not on first request, if a registry file is broken.
    load_all_registries()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = create_engine(settings)
        app.state.sessionmaker = create_sessionmaker(app.state.engine)
        app.state.redis = Redis.from_url(settings.redis_url.get_secret_value())
        app.state.rate_limiter = RateLimiter(app.state.redis)
        # One shared client for outside services (Turnstile, Resend).
        app.state.http = httpx.AsyncClient(headers={"User-Agent": "Dearlly"})
        try:
            yield
        finally:
            await app.state.http.aclose()
            await app.state.redis.aclose()
            await app.state.engine.dispose()

    docs_enabled = not settings.is_production
    app = FastAPI(
        title="Dearlly API",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.settings = settings
    app.add_exception_handler(RateLimitedError, rate_limited_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
        max_age=600,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    # Added last so it wraps everything: every response, even errors, gets an ID and headers.
    app.add_middleware(RequestContextMiddleware, production=settings.is_production)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(google.router)
    app.include_router(users.router)
    return app
