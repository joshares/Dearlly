from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

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
