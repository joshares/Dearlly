"""Email-code login and sessions.

- A login code lives 10 minutes in Redis, works once, and dies after 5 wrong guesses.
- A session is one logged-in device. It holds a short-lived access token (15 minutes) and a
  single-use refresh token (30 days) that is swapped for a new one each time it's used.
  If an old refresh token is ever used twice, someone copied it: the whole session is revoked.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.ratelimit import limit_key
from app.core.security import (
    constant_time_equals,
    encode_jwt,
    hash_login_code,
    hash_token,
    new_login_code,
    new_token,
)
from app.models import AuthSession, RefreshToken, User

LOGIN_CODE_TTL = timedelta(minutes=10)
MAX_CODE_ATTEMPTS = 5
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=30)
SIGNUP_TTL = timedelta(minutes=15)


def _code_key(email: str) -> str:
    return f"login-code:{limit_key(email)}"


def _attempts_key(email: str) -> str:
    return f"login-attempts:{limit_key(email)}"


async def issue_login_code(redis: Redis, settings: Settings, email: str) -> str:
    """Create a fresh code (replacing any earlier one) and return it for emailing."""
    code = new_login_code()
    ttl = int(LOGIN_CODE_TTL.total_seconds())
    async with redis.pipeline(transaction=True) as pipe:
        pipe.set(_code_key(email), hash_login_code(settings, email, code), ex=ttl)
        pipe.delete(_attempts_key(email))
        await pipe.execute()
    return code


async def consume_login_code(redis: Redis, settings: Settings, email: str, code: str) -> bool:
    attempts = await redis.incr(_attempts_key(email))
    if attempts == 1:
        await redis.expire(_attempts_key(email), int(LOGIN_CODE_TTL.total_seconds()))
    if attempts > MAX_CODE_ATTEMPTS:
        await redis.delete(_code_key(email))
        return False
    stored = await redis.get(_code_key(email))
    if stored is None:
        return False
    expected = hash_login_code(settings, email, code.strip())
    if not constant_time_equals(stored.decode(), expected):
        return False
    # Single use: only the request that actually deletes the code wins.
    deleted = await redis.delete(_code_key(email))
    if not deleted:
        return False
    await redis.delete(_attempts_key(email))
    return True


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str


def _access_token(settings: Settings, user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return encode_jwt(settings, "access", str(user_id), ACCESS_TTL, sid=str(session_id))


async def _add_refresh_token(db: AsyncSession, session_id: uuid.UUID, now: datetime) -> str:
    token = new_token()
    db.add(
        RefreshToken(
            session_id=session_id, token_hash=hash_token(token), expires_at=now + REFRESH_TTL
        )
    )
    return token


async def start_session(db: AsyncSession, settings: Settings, user: User) -> SessionTokens:
    now = datetime.now(UTC)
    session = AuthSession(id=uuid.uuid4(), user_id=user.id)
    db.add(session)
    user.last_login_at = now
    await db.flush()
    refresh = await _add_refresh_token(db, session.id, now)
    await db.commit()
    return SessionTokens(_access_token(settings, user.id, session.id), refresh)


class RefreshError(Exception):
    pass


async def rotate_refresh_token(db: AsyncSession, settings: Settings, token: str) -> SessionTokens:
    now = datetime.now(UTC)
    row = (
        await db.execute(
            select(RefreshToken, AuthSession)
            .join(AuthSession, AuthSession.id == RefreshToken.session_id)
            .where(RefreshToken.token_hash == hash_token(token))
            .with_for_update()
        )
    ).first()
    if row is None:
        raise RefreshError
    refresh, session = row
    if session.revoked_at is not None or refresh.expires_at <= now:
        raise RefreshError
    if refresh.used_at is not None:
        # Reuse of a spent token: assume it was stolen and end the session everywhere.
        session.revoked_at = now
        await db.commit()
        raise RefreshError
    refresh.used_at = now
    new_refresh = await _add_refresh_token(db, session.id, now)
    await db.commit()
    return SessionTokens(_access_token(settings, session.user_id, session.id), new_refresh)


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()


async def revoke_other_sessions(
    db: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID | None
) -> None:
    query = update(AuthSession).where(
        AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)
    )
    if keep is not None:
        query = query.where(AuthSession.id != keep)
    await db.execute(query.values(revoked_at=datetime.now(UTC)))
    await db.commit()


async def session_id_for_refresh_token(db: AsyncSession, token: str) -> uuid.UUID | None:
    return (
        await db.execute(
            select(RefreshToken.session_id).where(RefreshToken.token_hash == hash_token(token))
        )
    ).scalar_one_or_none()


def signup_token(settings: Settings, email: str) -> str:
    return encode_jwt(settings, "signup", email, SIGNUP_TTL)
