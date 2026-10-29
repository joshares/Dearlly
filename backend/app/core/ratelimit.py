"""Rate limits in Redis (fixed windows), so they hold across API processes and servers."""

import hashlib
import time
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis


@dataclass(frozen=True)
class Limit:
    name: str
    max_requests: int
    window_seconds: int


class RateLimitedError(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limited")
        self.retry_after = retry_after


def limit_key(value: str) -> str:
    """Hash identifiers (emails, IPs) so raw personal data never sits in Redis keys."""
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()[:32]


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def hit(self, limit: Limit, identifier: str) -> None:
        """Count one request; raise RateLimitedError once the window's allowance is used up."""
        now = int(time.time())
        window = now // limit.window_seconds
        key = f"rl:{limit.name}:{window}:{limit_key(identifier)}"
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, limit.window_seconds, nx=True)
            count, _ = await pipe.execute()
        if int(count) > limit.max_requests:
            retry_after = (window + 1) * limit.window_seconds - now
            raise RateLimitedError(retry_after=max(retry_after, 1))


async def rate_limited_handler(_: Request, exc: Exception) -> JSONResponse:
    retry_after = exc.retry_after if isinstance(exc, RateLimitedError) else 60
    return JSONResponse(
        {"detail": "Too many attempts. Please wait a little and try again."},
        status_code=429,
        headers={"Retry-After": str(retry_after)},
    )
