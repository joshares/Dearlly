from typing import Any

import sentry_sdk
from fastapi.testclient import TestClient

from app.core.logging import REDACTED
from app.core.monitoring import init_sentry, scrub_breadcrumb, scrub_event
from app.main import create_app

from .conftest import make_settings


def test_off_without_a_dsn() -> None:
    assert init_sentry(make_settings(), component="api") is False


def test_scrubbing_removes_personal_data() -> None:
    event = {
        "request": {
            "url": "https://api.dearlly.app/auth/verify",
            "query_string": "token=private-link-token",
            "cookies": {"dl_access": "secret"},
            "data": {"email": "a@b.c", "code": "123456"},
            "headers": {"Cookie": "dl_access=x", "X-CSRF-Token": "t", "User-Agent": "phone"},
        },
        "user": {"id": "u1", "email": "a@b.c", "ip_address": "203.0.113.9"},
        "extra": {"password": "hunter2", "note": "token=abc123"},
    }
    clean = scrub_event(event)
    request = clean["request"]
    assert "cookies" not in request and "data" not in request and "query_string" not in request
    assert request["headers"] == {"User-Agent": "phone"}
    assert clean["user"] == {"id": "u1"}
    assert clean["extra"]["password"] == REDACTED
    assert "abc123" not in clean["extra"]["note"]


def test_private_letter_links_never_reach_sentry() -> None:
    token = "oR8ri9iYc44a-I_OWwi3cCzg7vBAjz81"
    event = {
        "transaction": f"/letters/{token}/reply",
        "request": {
            "url": f"https://api.dearlly.app/letters/{token}/reply",
            "headers": {"Referer": f"https://dearlly.app/l/{token}", "User-Agent": "phone"},
        },
    }
    clean = scrub_event(event)
    assert token not in repr(clean)
    assert clean["request"]["url"] == "https://api.dearlly.app/letters/[link]/reply"
    assert clean["request"]["headers"] == {"User-Agent": "phone"}

    crumb = scrub_breadcrumb(
        {"message": f"GET https://dearlly.app/l/{token}", "data": {"url": f"/l/{token}?x=1"}}
    )
    assert token not in repr(crumb)
    assert crumb["data"]["url"] == "/l/[link]"


def test_api_errors_reach_sentry_without_secrets() -> None:
    sent: list[dict[str, Any]] = []

    class CaptureTransport(sentry_sdk.transport.Transport):
        def capture_envelope(self, envelope: Any) -> None:
            for item in envelope.items:
                if item.type == "event":
                    sent.append(item.payload.json)

    settings = make_settings(sentry_dsn="https://key@o0.ingest.de.sentry.io/1")
    app = create_app(settings)
    # Re-initialise with a transport that captures instead of sending.
    assert init_sentry(settings, component="api", transport=CaptureTransport)
    try:

        @app.get("/boom")
        async def boom() -> None:
            password = "hunter2"  # a local variable that must never be sent
            raise RuntimeError(f"failed for {len(password)}")

        with TestClient(app) as client:
            client.cookies.set("dl_access", "x")
            assert client.get("/boom?code=123456").status_code == 500
        sentry_sdk.flush()
    finally:
        sentry_sdk.init(dsn=None)

    assert sent, "the error should be reported"
    text = repr(sent)
    assert "RuntimeError" in text
    assert "hunter2" not in text and "123456" not in text and "dl_access" not in text
