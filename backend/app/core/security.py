"""Tokens and one-time codes.

- Random tokens are 256 bits (private links, refresh tokens need at least 128).
- Refresh tokens are stored only as SHA-256 hashes.
- Login codes are stored as HMACs keyed with SECRET_KEY, so a leaked Redis can't be brute-forced.
- Access and sign-up tokens are short-lived signed JWTs, each with its own "typ".
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt

from app.core.config import Settings

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "dearlly"
TokenType = Literal["access", "signup", "oauth", "unsubscribe"]

LOGIN_CODE_DIGITS = 6


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_login_code() -> str:
    return f"{secrets.randbelow(10**LOGIN_CODE_DIGITS):0{LOGIN_CODE_DIGITS}d}"


def hash_login_code(settings: Settings, email: str, code: str) -> str:
    key = settings.secret_key.get_secret_value().encode()
    return hmac.new(key, f"login-code:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


class InvalidTokenError(Exception):
    pass


def encode_jwt(
    settings: Settings, typ: TokenType, subject: str, ttl: timedelta, **claims: Any
) -> str:
    now = datetime.now(UTC)
    payload = {
        "iss": JWT_ISSUER,
        "typ": typ,
        "sub": subject,
        "iat": now,
        "exp": now + ttl,
        **claims,
    }
    return jwt.encode(payload, settings.secret_key.get_secret_value(), algorithm=JWT_ALGORITHM)


def decode_jwt(settings: Settings, token: str, typ: TokenType) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "typ", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError from exc
    if payload.get("typ") != typ:
        raise InvalidTokenError
    return payload
