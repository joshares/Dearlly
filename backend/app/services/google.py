"""Continue with Google: OpenID Connect authorization-code flow with PKCE.

1. /auth/google/start sends the browser to Google with a random `state`, `nonce` and PKCE challenge,
   remembered in a short-lived signed cookie.
2. Google sends the browser back to /auth/google/callback with a one-time `code`.
3. We swap the code (plus the PKCE verifier and our client secret) for an ID token, and check it:
   Google's signature (their published keys), our client id, Google as issuer, our nonce, and a
   verified email. Only then do we trust the email.
"""

import base64
import hashlib
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import Settings
from app.core.security import new_token

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - an endpoint, not a secret
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
JWKS_CACHE_SECONDS = 3600


class GoogleSignInError(Exception):
    pass


@dataclass(frozen=True)
class GoogleRequest:
    url: str
    state: str
    nonce: str
    verifier: str


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str


def redirect_uri(settings: Settings) -> str:
    return settings.public_api_url.rstrip("/") + "/auth/google/callback"


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def start(settings: Settings) -> GoogleRequest:
    state, nonce, verifier = new_token(), new_token(), new_token(48)
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect_uri(settings),
            "response_type": "code",
            "scope": "openid email",
            "state": state,
            "nonce": nonce,
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return GoogleRequest(f"{AUTHORIZE_URL}?{query}", state, nonce, verifier)


_jwks_cache: dict[str, Any] = {"keys": None, "fetched": 0.0}


async def _signing_key(client: httpx.AsyncClient, kid: str) -> jwt.PyJWK:
    fresh = time.monotonic() - _jwks_cache["fetched"] < JWKS_CACHE_SECONDS
    for attempt in range(2):
        if not (fresh and _jwks_cache["keys"]) or attempt == 1:
            response = await client.get(JWKS_URL, timeout=5.0)
            response.raise_for_status()
            _jwks_cache.update(keys=response.json()["keys"], fetched=time.monotonic())
        for key in _jwks_cache["keys"]:
            if key.get("kid") == kid:
                return jwt.PyJWK(key)
        fresh = False  # Google rotated its keys: fetch once more.
    raise GoogleSignInError("unknown signing key")


def clear_key_cache() -> None:
    _jwks_cache.update(keys=None, fetched=0.0)


async def finish(
    client: httpx.AsyncClient, settings: Settings, code: str, verifier: str, nonce: str
) -> GoogleIdentity:
    if settings.google_client_secret is None:
        raise GoogleSignInError("Google sign-in is not configured")
    try:
        response = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret.get_secret_value(),
                "redirect_uri": redirect_uri(settings),
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        id_token = response.json()["id_token"]
        key = await _signing_key(client, jwt.get_unverified_header(id_token)["kid"])
        claims = jwt.decode(
            id_token,
            key=key,
            algorithms=["RS256"],
            audience=settings.google_client_id,
            issuer=ISSUERS,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except (httpx.HTTPError, KeyError, ValueError, jwt.PyJWTError) as exc:
        raise GoogleSignInError("could not verify Google's answer") from exc
    if claims.get("nonce") != nonce:
        raise GoogleSignInError("nonce mismatch")
    if claims.get("email_verified") is not True or not claims.get("email"):
        raise GoogleSignInError("Google account email not verified")
    return GoogleIdentity(sub=str(claims["sub"]), email=str(claims["email"]))
