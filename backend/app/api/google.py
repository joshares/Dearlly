"""Continue with Google. Hidden (404) until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set."""

import logging
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import AppSettings, DbSession, Limiter, set_session_cookies, set_signup_cookie
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.core.security import InvalidTokenError, constant_time_equals, decode_jwt, encode_jwt
from app.models import User
from app.services import auth as auth_service
from app.services import google
from app.services.profiles import ProfileFieldError, normalize_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_COOKIE = "dl_oauth"
OAUTH_PATH = "/auth/google"
OAUTH_TTL = timedelta(minutes=10)
GOOGLE_PER_IP = Limit("auth-google-ip", max_requests=30, window_seconds=15 * 60)


class ProvidersOut(BaseModel):
    google: bool


@router.get("/providers")
async def providers(settings: AppSettings) -> ProvidersOut:
    """Which sign-in buttons the web app should show."""
    return ProvidersOut(google=settings.google_enabled)


def _require_google(settings: AppSettings) -> None:
    if not settings.google_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _back_to_web(settings: AppSettings, path: str) -> RedirectResponse:
    return RedirectResponse(settings.public_web_url.rstrip("/") + path, status_code=302)


@router.get("/google/start")
async def google_start(
    request: Request, settings: AppSettings, limiter: Limiter
) -> RedirectResponse:
    _require_google(settings)
    await limiter.hit(GOOGLE_PER_IP, client_ip(request, settings))
    flow = google.start(settings)
    response = RedirectResponse(flow.url, status_code=302)
    # Lax is right here: Google brings the browser back with a top-level GET.
    response.set_cookie(
        OAUTH_COOKIE,
        encode_jwt(
            settings,
            "oauth",
            "google",
            OAUTH_TTL,
            state=flow.state,
            nonce=flow.nonce,
            verifier=flow.verifier,
        ),
        max_age=int(OAUTH_TTL.total_seconds()),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path=OAUTH_PATH,
    )
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    code: str = "",
    state: str = "",
) -> RedirectResponse:
    _require_google(settings)
    await limiter.hit(GOOGLE_PER_IP, client_ip(request, settings))
    failed = _back_to_web(settings, "/login?error=google")
    failed.delete_cookie(OAUTH_COOKIE, path=OAUTH_PATH)
    try:
        saved = decode_jwt(settings, request.cookies.get(OAUTH_COOKIE, ""), "oauth")
    except InvalidTokenError:
        return failed
    if not code or not state or not constant_time_equals(state, str(saved.get("state", ""))):
        return failed
    try:
        identity = await google.finish(
            request.app.state.http, settings, code, saved["verifier"], saved["nonce"]
        )
        email = normalize_email(identity.email)
    except (google.GoogleSignInError, ProfileFieldError, KeyError) as exc:
        logger.warning("google sign-in failed", extra={"error": repr(exc)})
        return failed

    user = (
        await db.execute(select(User).where(User.google_sub == identity.sub))
    ).scalar_one_or_none()
    if user is None:
        # Same verified email as an existing account: link Google to it.
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is not None and user.google_sub is None:
            user.google_sub = identity.sub

    if user is None:
        # New here: Google proved the email; they still choose a username and tick 18+.
        response = _back_to_web(settings, "/login?step=signup")
        set_signup_cookie(
            response,
            settings,
            encode_jwt(settings, "signup", email, auth_service.SIGNUP_TTL, google_sub=identity.sub),
        )
    else:
        response = _back_to_web(settings, "/profile")
        set_session_cookies(
            response, settings, await auth_service.start_session(db, settings, user)
        )
    response.delete_cookie(OAUTH_COOKIE, path=OAUTH_PATH)
    return response
