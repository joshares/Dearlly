from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import health
from app.main import create_app

from .conftest import make_settings, production_settings


def test_health_get(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_head(client: TestClient) -> None:
    response = client.head("/health")
    assert response.status_code == 200


def test_security_headers_and_no_server_header(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "server" not in response.headers
    # HSTS only in production (local development is plain http).
    assert "Strict-Transport-Security" not in response.headers


def test_request_id_is_generated(client: TestClient) -> None:
    response = client.get("/health")
    assert len(response.headers["X-Request-ID"]) == 32


def test_safe_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-ID": "abc-12345678"})
    assert response.headers["X-Request-ID"] == "abc-12345678"


def test_unsafe_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-ID": "bad id\nwith newline<script>"})
    assert response.headers["X-Request-ID"] != "bad id\nwith newline<script>"
    assert len(response.headers["X-Request-ID"]) == 32


def test_untrusted_host_is_rejected(client: TestClient) -> None:
    response = client.get("/health", headers={"Host": "evil.example"})
    assert response.status_code == 400
    assert "X-Request-ID" in response.headers


def test_cors_allows_only_listed_origin(client: TestClient) -> None:
    allowed = client.get("/health", headers={"Origin": "http://localhost:3100"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3100"
    blocked = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers


def test_docs_on_in_development(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_production_turns_docs_off_and_adds_hsts() -> None:
    with TestClient(create_app(production_settings())) as prod:
        assert prod.get("/docs").status_code == 404
        assert prod.get("/openapi.json").status_code == 404
        response = prod.get("/health")
        assert response.headers["Strict-Transport-Security"].startswith("max-age=")


def test_unhandled_error_is_generic() -> None:
    app = create_app(make_settings())

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("database password is hunter2")

    with TestClient(app) as test_client:
        response = test_client.get("/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Internal server error"
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert "hunter2" not in response.text
    assert response.headers["X-Content-Type-Options"] == "nosniff"


@pytest.fixture
def ready_client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def _patch_checks(monkeypatch: pytest.MonkeyPatch, *, database_ok: bool, redis_ok: bool) -> None:
    async def database(_: Any) -> None:
        if not database_ok:
            raise ConnectionError("db secret detail")

    async def redis(_: Any) -> None:
        if not redis_ok:
            raise ConnectionError("redis secret detail")

    monkeypatch.setattr(health, "check_database", database)
    monkeypatch.setattr(health, "check_redis", redis)


def test_ready_ok_when_dependencies_answer(
    monkeypatch: pytest.MonkeyPatch, ready_client: TestClient
) -> None:
    _patch_checks(monkeypatch, database_ok=True, redis_ok=True)
    response = ready_client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(("database_ok", "redis_ok"), [(False, True), (True, False)])
def test_ready_503_without_details(
    monkeypatch: pytest.MonkeyPatch, ready_client: TestClient, database_ok: bool, redis_ok: bool
) -> None:
    _patch_checks(monkeypatch, database_ok=database_ok, redis_ok=redis_ok)
    response = ready_client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "secret" not in response.text
