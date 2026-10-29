import pytest
from pydantic import ValidationError

from app.core.config import Settings

from .conftest import make_settings, production_settings


def test_development_defaults_are_allowed() -> None:
    settings = make_settings()
    assert not settings.is_production


def test_valid_production_settings_start() -> None:
    settings = production_settings()
    assert settings.is_production
    assert settings.allowed_hosts == ["api.dearlly.example", "testserver"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"secret_key": "local-dev-only-not-a-secret-change-on-server"}, "SECRET_KEY"),
        ({"secret_key": "short"}, "SECRET_KEY"),
        (
            {"database_url": "postgresql+asyncpg://u:local-dev-only-not-a-secret@db/x"},
            "DATABASE_URL",
        ),
        ({"allowed_hosts": "*"}, "ALLOWED_HOSTS"),
        ({"allowed_hosts": "*.dearlly.example"}, "ALLOWED_HOSTS"),
        ({"cors_origins": "*"}, "CORS origin"),
        ({"cors_origins": "http://dearlly.example"}, "CORS origin"),
        ({"cors_origins": ""}, "CORS_ORIGINS"),
        ({"public_web_url": "http://dearlly.example"}, "PUBLIC_WEB_URL"),
        ({"public_api_url": "http://api.dearlly.example"}, "PUBLIC_API_URL"),
        ({"turnstile_secret_key": "1x0000000000000000000000000000000AA"}, "TURNSTILE"),
        ({"email_delivery": "log"}, "EMAIL_DELIVERY"),
        ({"resend_api_key": None}, "RESEND_API_KEY"),
        ({"email_from": "Dearlly <hello@dearlly.localhost>"}, "EMAIL_FROM"),
    ],
)
def test_production_refuses_insecure_settings(
    overrides: dict[str, str | None], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        production_settings(**overrides)


def test_secrets_are_hidden_in_repr() -> None:
    settings = production_settings()
    text = repr(settings) + str(settings.model_dump())
    assert "x" * 48 not in text
    assert "real-password" not in text


def test_settings_read_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_HOSTS", "a.example, b.example")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3100")
    settings = Settings()
    assert settings.allowed_hosts == ["a.example", "b.example"]
    assert settings.cors_origins == ["http://localhost:3100"]
