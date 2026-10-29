import json
from datetime import timedelta

import fakeredis
import httpx
import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient

from app.core.csrf import CSRF_COOKIE, CSRF_HEADER, issue_csrf_token, require_csrf
from app.core.net import client_ip
from app.core.ratelimit import (
    Limit,
    RateLimitedError,
    RateLimiter,
    limit_key,
    rate_limited_handler,
)
from app.core.security import (
    InvalidTokenError,
    decode_jwt,
    encode_jwt,
    hash_login_code,
    new_login_code,
    new_token,
)
from app.services.email import EmailDeliveryError, login_code_email, send_email
from app.services.turnstile import verify_turnstile

from .conftest import make_settings, production_settings

# --- rate limits -----------------------------------------------------------------------------


async def test_rate_limit_allows_then_blocks() -> None:
    limiter = RateLimiter(fakeredis.FakeAsyncRedis())
    limit = Limit("test", max_requests=3, window_seconds=60)
    for _ in range(3):
        await limiter.hit(limit, "a@b.c")
    with pytest.raises(RateLimitedError) as error:
        await limiter.hit(limit, "a@b.c")
    assert 1 <= error.value.retry_after <= 60
    # Other identifiers have their own allowance.
    await limiter.hit(limit, "other@b.c")


async def test_rate_limit_keys_do_not_contain_raw_identifiers() -> None:
    redis = fakeredis.FakeAsyncRedis()
    await RateLimiter(redis).hit(Limit("t", 1, 60), "Someone@Example.com")
    keys = [key.decode() for key in await redis.keys("*")]
    assert keys and all("example" not in key.lower() for key in keys)
    assert limit_key("Someone@Example.com") == limit_key(" someone@example.com ")


def test_rate_limited_response_is_429_with_retry_after() -> None:
    app = FastAPI()
    app.add_exception_handler(RateLimitedError, rate_limited_handler)

    @app.get("/limited")
    async def limited() -> None:
        raise RateLimitedError(retry_after=42)

    response = TestClient(app).get("/limited")
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "42"


# --- tokens and codes ------------------------------------------------------------------------


def test_tokens_are_long_and_unique() -> None:
    tokens = {new_token() for _ in range(100)}
    assert len(tokens) == 100
    assert all(len(token) >= 43 for token in tokens)  # 256 bits in base64url


def test_login_codes_are_six_digits() -> None:
    codes = [new_login_code() for _ in range(200)]
    assert all(len(code) == 6 and code.isdigit() for code in codes)


def test_login_code_hash_depends_on_email_and_secret() -> None:
    settings = make_settings()
    other = make_settings(secret_key="another-secret-key-of-enough-length-123")
    assert hash_login_code(settings, "a@b.c", "123456") != hash_login_code(
        settings, "x@b.c", "123456"
    )
    assert hash_login_code(settings, "a@b.c", "123456") != hash_login_code(other, "a@b.c", "123456")


def test_jwt_round_trip_and_type_check() -> None:
    settings = make_settings()
    token = encode_jwt(settings, "access", "user-1", timedelta(minutes=5), sid="s1")
    assert decode_jwt(settings, token, "access")["sid"] == "s1"
    with pytest.raises(InvalidTokenError):
        decode_jwt(settings, token, "signup")


def test_expired_or_forged_jwt_is_rejected() -> None:
    settings = make_settings()
    expired = encode_jwt(settings, "access", "u", timedelta(seconds=-1))
    with pytest.raises(InvalidTokenError):
        decode_jwt(settings, expired, "access")
    forged = encode_jwt(
        make_settings(secret_key="attacker-secret-key-of-enough-length"),
        "access",
        "u",
        timedelta(minutes=5),
    )
    with pytest.raises(InvalidTokenError):
        decode_jwt(settings, forged, "access")


# --- CSRF ------------------------------------------------------------------------------------


def _csrf_app() -> FastAPI:
    app = FastAPI()
    settings = make_settings()

    @app.get("/csrf")
    async def csrf(response: Response) -> dict[str, str]:
        return {"token": issue_csrf_token(response, settings)}

    @app.post("/change")
    async def change(request: Request) -> dict[str, bool]:
        await require_csrf(request)
        return {"ok": True}

    return app


def test_csrf_requires_matching_header() -> None:
    client = TestClient(_csrf_app())
    token = client.get("/csrf").json()["token"]
    assert client.cookies.get(CSRF_COOKIE) == token
    assert client.post("/change").status_code == 403
    assert client.post("/change", headers={CSRF_HEADER: "wrong"}).status_code == 403
    assert client.post("/change", headers={CSRF_HEADER: token}).status_code == 200


def test_csrf_header_without_cookie_fails() -> None:
    client = TestClient(_csrf_app())
    assert client.post("/change", headers={CSRF_HEADER: "anything"}).status_code == 403


# --- client IP -------------------------------------------------------------------------------


def _ip_for(headers: dict[str, str], header_setting: str) -> str:
    app = FastAPI()
    settings = make_settings(client_ip_header=header_setting)

    @app.get("/ip")
    async def ip(request: Request) -> dict[str, str]:
        return {"ip": client_ip(request, settings)}

    result: str = TestClient(app).get("/ip", headers=headers).json()["ip"]
    return result


def test_client_ip_ignores_proxy_header_unless_configured() -> None:
    assert _ip_for({"CF-Connecting-IP": "203.0.113.9"}, "") == "testclient"
    assert _ip_for({"CF-Connecting-IP": "203.0.113.9"}, "CF-Connecting-IP") == "203.0.113.9"
    # Garbage in the header falls back to the connection address.
    assert _ip_for({"CF-Connecting-IP": "not-an-ip"}, "CF-Connecting-IP") == "testclient"


# --- Turnstile -------------------------------------------------------------------------------


def _client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


async def test_turnstile_success_and_failure() -> None:
    settings = make_settings()
    seen: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.content)
        ok = b"response=good" in request.content
        return httpx.Response(200, json={"success": ok, "error-codes": [] if ok else ["bad"]})

    async with _client(httpx.MockTransport(handler)) as client:
        assert await verify_turnstile(client, settings, "good", "203.0.113.9")
        assert not await verify_turnstile(client, settings, "bad", "203.0.113.9")
    assert b"remoteip=203.0.113.9" in seen[0]


async def test_turnstile_fails_closed() -> None:
    settings = make_settings()

    def broken(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    async with _client(httpx.MockTransport(broken)) as client:
        assert not await verify_turnstile(client, settings, "token", "203.0.113.9")
        assert not await verify_turnstile(client, settings, "", "203.0.113.9")


# --- email -----------------------------------------------------------------------------------


def test_login_code_email_contents() -> None:
    email = login_code_email("a@b.c", "123456", 10)
    assert "123456" in email.subject and "123456" in email.text and "123456" in email.html
    assert "10 minutes" in email.text


async def test_log_delivery_sends_nothing() -> None:
    def fail(_: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call Resend")

    async with _client(httpx.MockTransport(fail)) as client:
        await send_email(client, make_settings(), login_code_email("a@b.c", "123456", 10))


async def test_resend_delivery() -> None:
    sent: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer re_test_not_real"
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "1"})

    async with _client(httpx.MockTransport(handler)) as client:
        await send_email(client, production_settings(), login_code_email("a@b.c", "123456", 10))
    assert sent[0]["to"] == ["a@b.c"]
    assert sent[0]["from"] == "Dearlly <hello@send.dearlly.example>"


async def test_resend_failure_raises() -> None:
    async with _client(httpx.MockTransport(lambda _: httpx.Response(422))) as client:
        with pytest.raises(EmailDeliveryError):
            await send_email(client, production_settings(), login_code_email("a@b.c", "1", 10))
