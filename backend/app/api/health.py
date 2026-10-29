import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)

READY_TIMEOUT_SECONDS = 2.0


@router.get("/health")
@router.head("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    """Liveness: the process is up. UptimeRobot watches for the keyword "ok"."""
    return {"status": "ok"}


async def check_database(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def check_redis(redis: Redis) -> None:
    await redis.ping()


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: database and Redis answer. Failures are logged, never shown to the caller."""
    checks = {
        "database": check_database(request.app.state.engine),
        "redis": check_redis(request.app.state.redis),
    }
    healthy = True
    for name, check in checks.items():
        try:
            await asyncio.wait_for(check, timeout=READY_TIMEOUT_SECONDS)
        except Exception as exc:  # noqa: BLE001 - any failure means "not ready"
            healthy = False
            logger.warning("readiness check failed", extra={"check": name, "error": repr(exc)})
    if not healthy:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok"})
