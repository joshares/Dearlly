import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import auth, email_prefs, experiences, google, health, photos, places, users
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from app.core.monitoring import init_sentry
from app.core.ratelimit import RateLimitedError, RateLimiter, rate_limited_handler
from app.core.registries import load_all_registries
from app.db.session import create_engine, create_sessionmaker
from app.services import photos as photo_service
from app.services import places as places_catalogue

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_sentry(settings, component="api")
    # Fail at boot, not on first request, if a registry file is broken.
    load_all_registries()
    places_catalogue.cities()

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
    # Photos: off unless storage is configured and the nudity check model is in place.
    app.state.photo_storage = photo_service.storage_for(settings)
    app.state.photo_checker = _load_checker(settings)
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
    app.include_router(experiences.router)
    app.include_router(email_prefs.router)
    app.include_router(places.router)
    app.include_router(photos.router)
    return app


def _load_checker(settings: Settings) -> photo_service.Checker | None:
    if not settings.photos_enabled:
        return None
    if not Path(settings.nsfw_model_path).is_file():
        logger.warning(
            "photos off: nudity check model missing", extra={"path": settings.nsfw_model_path}
        )
        return None
    return photo_service.NsfwChecker(settings.nsfw_model_path)
