"""Sign up and log in (emailed code or optional password), log out, refresh."""

import contextlib
import logging
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    REFRESH_COOKIE,
    SIGNUP_COOKIE,
    AppSettings,
    DbSession,
    Limiter,
    clear_auth_cookies,
    current_session_id,
    set_session_cookies,
    set_signup_cookie,
)
from app.api.schemas import (
    CsrfOut,
    MyProfile,
    PasswordLoginIn,
    SignupIn,
    StartIn,
    StartOut,
    VerifyIn,
    VerifyOut,
)
from app.core.config import Settings
from app.core.csrf import issue_csrf_token, require_csrf
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.core.security import InvalidTokenError, decode_jwt
from app.models import User
from app.services import auth as auth_service
from app.services import passwords
from app.services.email import EmailDeliveryError, login_code_email, send_email
from app.services.profiles import (
    ProfileFieldError,
    normalize_display_name,
    normalize_email,
    normalize_username,
)
from app.services.turnstile import verify_turnstile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(require_csrf)])

START_PER_EMAIL = Limit("auth-start-email", max_requests=3, window_seconds=15 * 60)
START_PER_EMAIL_DAY = Limit("auth-start-email-day", max_requests=10, window_seconds=24 * 3600)
START_PER_IP = Limit("auth-start-ip", max_requests=10, window_seconds=15 * 60)
VERIFY_PER_EMAIL = Limit("auth-verify-email", max_requests=10, window_seconds=15 * 60)
VERIFY_PER_IP = Limit("auth-verify-ip", max_requests=30, window_seconds=15 * 60)
SIGNUP_PER_IP = Limit("auth-signup-ip", max_requests=10, window_seconds=3600)
REFRESH_PER_IP = Limit("auth-refresh-ip", max_requests=60, window_seconds=60)
PASSWORD_PER_EMAIL = Limit("auth-password-email", max_requests=5, window_seconds=15 * 60)
PASSWORD_PER_IP = Limit("auth-password-ip", max_requests=20, window_seconds=15 * 60)

WRONG_PASSWORD = "That email and password don't match. Try again, or log in with a code."  # noqa: S105

WRONG_CODE = "That code is wrong or has expired. Check your email or ask for a new one."


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _get_http(request: Request) -> httpx.AsyncClient:
    client: httpx.AsyncClient = request.app.state.http
    return client


HttpClient = Annotated[httpx.AsyncClient, Depends(_get_http)]


async def checked_password_hash(
    http: httpx.AsyncClient, password: str, *, email: str, username: str | None
) -> str:
    """Apply the password rules and the breached-password check, then hash."""
    try:
        passwords.check_rules(password, email=email, username=username)
    except passwords.PasswordRuleError as exc:
        raise _bad_request(str(exc)) from exc
    if await passwords.is_breached(http, password):
        raise _bad_request(
            "That password has appeared in a data breach elsewhere. Please choose another."
        )
    return await passwords.hash_password(password)


@router.get("/csrf")
async def csrf(response: Response, settings: AppSettings) -> CsrfOut:
    return CsrfOut(csrf_token=issue_csrf_token(response, settings))


async def _deliver_code(http: httpx.AsyncClient, settings: Settings, email: str, code: str) -> None:
    minutes = int(auth_service.LOGIN_CODE_TTL.total_seconds() // 60)
    # A failure is already logged (without personal data); the user can ask for a new code.
    with contextlib.suppress(EmailDeliveryError):
        await send_email(http, settings, login_code_email(email, code, minutes))


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start(
    body: StartIn,
    request: Request,
    background: BackgroundTasks,
    settings: AppSettings,
    limiter: Limiter,
    http: HttpClient,
) -> StartOut:
    """Email a login code. The answer is the same whether or not an account exists."""
    try:
        email = normalize_email(body.email)
    except ProfileFieldError as exc:
        raise _bad_request(str(exc)) from exc
    ip = client_ip(request, settings)
    await limiter.hit(START_PER_IP, ip)
    if not await verify_turnstile(http, settings, body.turnstile_token, ip):
        raise _bad_request("We couldn't confirm you're human. Please try the check again.")
    await limiter.hit(START_PER_EMAIL, email)
    await limiter.hit(START_PER_EMAIL_DAY, email)
    code = await auth_service.issue_login_code(request.app.state.redis, settings, email)
    # Sent after the response, so timing doesn't reveal anything.
    background.add_task(_deliver_code, http, settings, email, code)
    return StartOut()


@router.post("/verify")
async def verify(
    body: VerifyIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> VerifyOut:
    try:
        email = normalize_email(body.email)
    except ProfileFieldError as exc:
        raise _bad_request(WRONG_CODE) from exc
    await limiter.hit(VERIFY_PER_IP, client_ip(request, settings))
    await limiter.hit(VERIFY_PER_EMAIL, email)
    if not await auth_service.consume_login_code(
        request.app.state.redis, settings, email, body.code
    ):
        raise _bad_request(WRONG_CODE)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        # Email proven; they still need a username and the 18+ tick.
        set_signup_cookie(response, settings, auth_service.signup_token(settings, email))
        return VerifyOut(status="signup_required")

    set_session_cookies(response, settings, await auth_service.start_session(db, settings, user))
    return VerifyOut(status="logged_in", user=MyProfile.model_validate(user))


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> MyProfile:
    await limiter.hit(SIGNUP_PER_IP, client_ip(request, settings))
    try:
        proof = decode_jwt(settings, request.cookies.get(SIGNUP_COOKIE, ""), "signup")
        email = proof["sub"]
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your code has expired. Please start again.",
        ) from exc
    if body.is_adult is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dearlly is only for adults aged 18 and over.",
        )
    try:
        username = normalize_username(body.username)
        display_name = normalize_display_name(body.display_name)
    except ProfileFieldError as exc:
        raise _bad_request(str(exc)) from exc
    password_hash = None
    if body.password:
        password_hash = await checked_password_hash(
            request.app.state.http, body.password, email=email, username=username
        )

    now = datetime.now(UTC)
    user = User(
        email=email,
        username=username,
        display_name=display_name,
        adult_confirmed_at=now,
        email_verified_at=now,
        password_hash=password_hash,
        password_changed_at=now if password_hash else None,
        # Set when they came through "Continue with Google".
        google_sub=proof.get("google_sub"),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        taken = (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none()
        detail = (
            "This email already has an account. Please log in."
            if taken
            else "That username is taken."
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc

    tokens = await auth_service.start_session(db, settings, user)
    await db.refresh(user)
    response.delete_cookie(SIGNUP_COOKIE, path="/auth")
    set_session_cookies(response, settings, tokens)
    logger.info("account created", extra={"user_id": str(user.id)})
    return MyProfile.model_validate(user)


@router.post("/login")
async def password_login(
    body: PasswordLoginIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    http: HttpClient,
) -> VerifyOut:
    """Log in with a password. Same answer and timing whether or not the account exists."""
    try:
        email = normalize_email(body.email)
    except ProfileFieldError as exc:
        raise _bad_request(WRONG_PASSWORD) from exc
    ip = client_ip(request, settings)
    await limiter.hit(PASSWORD_PER_IP, ip)
    if not await verify_turnstile(http, settings, body.turnstile_token, ip):
        raise _bad_request("We couldn't confirm you're human. Please try the check again.")
    await limiter.hit(PASSWORD_PER_EMAIL, email)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    stored = user.password_hash if user else None
    if not await passwords.verify_password(stored, body.password) or user is None:
        raise _bad_request(WRONG_PASSWORD)
    if stored and passwords.needs_rehash(stored):
        user.password_hash = await passwords.hash_password(body.password)

    set_session_cookies(response, settings, await auth_service.start_session(db, settings, user))
    return VerifyOut(status="logged_in", user=MyProfile.model_validate(user))


@router.post("/refresh", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def refresh(
    request: Request, response: Response, db: DbSession, settings: AppSettings, limiter: Limiter
) -> Response | None:
    await limiter.hit(REFRESH_PER_IP, client_ip(request, settings))
    token = request.cookies.get(REFRESH_COOKIE)
    try:
        if not token:
            raise auth_service.RefreshError
        tokens = await auth_service.rotate_refresh_token(db, settings, token)
    except auth_service.RefreshError:
        failed = JSONResponse({"detail": "Please log in."}, status_code=401)
        clear_auth_cookies(failed, settings)
        return failed
    set_session_cookies(response, settings, tokens)
    return None


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request, response: Response, db: DbSession, settings: AppSettings
) -> None:
    session_id = await current_session_id(request, settings)
    if session_id is None and (token := request.cookies.get(REFRESH_COOKIE)):
        session_id = await auth_service.session_id_for_refresh_token(db, token)
    if session_id is not None:
        await auth_service.revoke_session(db, session_id)
    clear_auth_cookies(response, settings)
