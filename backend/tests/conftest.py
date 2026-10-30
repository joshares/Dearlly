import asyncio
import os
import re
from collections.abc import Iterator
from typing import Any

import fakeredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.api import auth as auth_api
from app.core.config import Settings
from app.core.ratelimit import RateLimiter
from app.main import create_app
from app.services import passwords
from app.services.email import Email

# Stand-in for the HIBP breached-password list in tests.
BREACHED = {"password123456"}

PROD_SECRET = "x" * 48


def make_settings(**overrides: Any) -> Settings:
    return Settings(**{"environment": "test", **overrides})


def production_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "production",
        "secret_key": PROD_SECRET,
        "database_url": "postgresql+asyncpg://dearlly:real-password@postgres:5432/dearlly",
        "allowed_hosts": "api.dearlly.example,testserver",
        "cors_origins": "https://dearlly.example",
        "public_web_url": "https://dearlly.example",
        "public_api_url": "https://api.dearlly.example",
        "turnstile_secret_key": "0x4AAAAAAA-real-looking-secret",
        "email_delivery": "resend",
        "resend_api_key": "re_test_not_real",
        "email_from": "Dearlly <hello@send.dearlly.example>",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def app() -> FastAPI:
    return create_app(make_settings())


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


# --- database-backed tests -------------------------------------------------------------------
# They need TEST_DATABASE_URL pointing at a migrated Postgres whose database name contains "test".
# CI sets REQUIRE_DB_TESTS=1 so they can never be skipped silently there.

TABLES = (
    "photos",
    "reports",
    "email_blocks",
    "experiences",
    "refresh_tokens",
    "auth_sessions",
    "users",
)


async def _truncate(url: str) -> None:
    engine = create_async_engine(url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
    await engine.dispose()


@pytest.fixture
def db_settings() -> Settings:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        if os.environ.get("REQUIRE_DB_TESTS"):
            raise RuntimeError("TEST_DATABASE_URL must be set")
        pytest.skip("TEST_DATABASE_URL not set")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Refusing to run: TEST_DATABASE_URL's database name must contain 'test'")
    asyncio.run(_truncate(url))
    return make_settings(database_url=url)


class AuthClient(TestClient):
    sent: list[Email]

    def use_csrf(self) -> None:
        self.headers["X-CSRF-Token"] = self.get("/auth/csrf").json()["csrf_token"]

    def replace_cookies(self, **cookies: str) -> None:
        """Swap the session cookies (keeping the CSRF cookie), as a thief replaying them would."""
        csrf = self.cookies.get("dl_csrf")
        self.cookies.clear()
        if csrf:
            self.cookies.set("dl_csrf", csrf, domain="testserver.local")
        for name, value in cookies.items():
            path = "/" if name == "dl_access" else "/auth"
            self.cookies.set(name, value, domain="testserver.local", path=path)

    def last_code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.sent[-1].subject)
        assert match
        return match.group(1)

    def request_code(self, email: str) -> str:
        response = self.post("/auth/start", json={"email": email, "turnstile_token": "ok"})
        assert response.status_code == 202, response.text
        return self.last_code()

    def sign_up(self, email: str, username: str, password: str | None = None) -> Response:
        code = self.request_code(email)
        assert self.post("/auth/verify", json={"email": email, "code": code}).json() == {
            "status": "signup_required",
            "user": None,
        }
        body: dict[str, object] = {"username": username, "is_adult": True}
        if password:
            body["password"] = password
        return self.post("/auth/signup", json=body)

    def password_login(self, email: str, password: str, turnstile: str = "ok") -> Response:
        return self.post(
            "/auth/login",
            json={"email": email, "password": password, "turnstile_token": turnstile},
        )


@pytest.fixture
def auth_client(db_settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Iterator[AuthClient]:
    sent: list[Email] = []

    async def fake_send(_http: object, _settings: Settings, email: Email) -> None:
        sent.append(email)

    async def fake_turnstile(_http: object, _settings: Settings, token: str, _ip: str) -> bool:
        return token == "ok"

    monkeypatch.setattr(auth_api, "send_email", fake_send)
    monkeypatch.setattr(auth_api, "verify_turnstile", fake_turnstile)

    async def fake_breached(_http: object, password: str) -> bool:
        return password in BREACHED

    monkeypatch.setattr(passwords, "is_breached", fake_breached)
    app = create_app(db_settings)
    with AuthClient(app) as client:
        assert client.portal is not None
        redis = client.portal.call(fakeredis.FakeAsyncRedis)
        app.state.redis = redis
        app.state.rate_limiter = RateLimiter(redis)
        client.sent = sent
        client.use_csrf()
        yield client
