import uuid
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.ratelimit import RateLimiter
from app.core.security import InvalidTokenError, decode_jwt
from app.db.session import get_session
from app.models import AuthSession, User
from app.services.auth import ACCESS_TTL, REFRESH_TTL, SIGNUP_TTL, SessionTokens

ACCESS_COOKIE = "dl_access"
REFRESH_COOKIE = "dl_refresh"
SIGNUP_COOKIE = "dl_signup"
# "Probably logged in" for the website (dearlly.app) to read before drawing a page, so it
# doesn't flash "Log in". Holds only "1": the real login is still checked on every API call.
LOGIN_HINT_COOKIE = "dl_in"
# Refresh and sign-up cookies are only ever sent to the auth endpoints.
AUTH_PATH = "/auth"

DbSession = Annotated[AsyncSession, Depends(get_session)]


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_rate_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.rate_limiter
    return limiter


AppSettings = Annotated[Settings, Depends(get_settings_dep)]
Limiter = Annotated[RateLimiter, Depends(get_rate_limiter)]


def _set_cookie(
    response: Response, settings: Settings, name: str, value: str, max_age: int, path: str
) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path=path,
    )


def set_session_cookies(response: Response, settings: Settings, tokens: SessionTokens) -> None:
    _set_cookie(
        response, settings, ACCESS_COOKIE, tokens.access_token, int(ACCESS_TTL.total_seconds()), "/"
    )
    _set_cookie(
        response,
        settings,
        REFRESH_COOKIE,
        tokens.refresh_token,
        int(REFRESH_TTL.total_seconds()),
        AUTH_PATH,
    )
    response.set_cookie(
        LOGIN_HINT_COOKIE,
        "1",
        max_age=int(REFRESH_TTL.total_seconds()),
        domain=_hint_domain(settings),
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _hint_domain(settings: Settings) -> str | None:
    """Shared with the website: api.dearlly.app sets it for dearlly.app. Locally, the
    browser shares localhost cookies across ports, so no domain is needed."""
    host = urlparse(settings.public_web_url).hostname
    return None if host in (None, "localhost", "127.0.0.1") else host


def set_signup_cookie(response: Response, settings: Settings, token: str) -> None:
    _set_cookie(
        response, settings, SIGNUP_COOKIE, token, int(SIGNUP_TTL.total_seconds()), AUTH_PATH
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    for name, path in (
        (ACCESS_COOKIE, "/"),
        (REFRESH_COOKIE, AUTH_PATH),
        (SIGNUP_COOKIE, AUTH_PATH),
    ):
        response.delete_cookie(
            name, path=path, secure=settings.cookie_secure, httponly=True, samesite="lax"
        )
    response.delete_cookie(
        LOGIN_HINT_COOKIE,
        path="/",
        domain=_hint_domain(settings),
        secure=settings.cookie_secure,
        samesite="lax",
    )


def _not_logged_in() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please log in.")


async def current_session_id(request: Request, settings: AppSettings) -> uuid.UUID | None:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        return None
    try:
        return uuid.UUID(decode_jwt(settings, token, "access")["sid"])
    except (InvalidTokenError, KeyError, ValueError):
        return None


async def current_user(request: Request, db: DbSession, settings: AppSettings) -> User:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise _not_logged_in()
    try:
        claims = decode_jwt(settings, token, "access")
        user_id, session_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["sid"])
    except (InvalidTokenError, KeyError, ValueError) as exc:
        raise _not_logged_in() from exc
    # Checking the session on every request makes logout take effect immediately.
    user = (
        await db.execute(
            select(User)
            .join(AuthSession, AuthSession.user_id == User.id)
            .where(
                User.id == user_id,
                AuthSession.id == session_id,
                AuthSession.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise _not_logged_in()
    return user


CurrentUser = Annotated[User, Depends(current_user)]
