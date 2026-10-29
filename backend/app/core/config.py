"""Settings, read from the environment only.

Production refuses to start with insecure values, so a missing or placeholder secret fails loudly
at boot instead of quietly running in an unsafe state.
"""

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# Values from .env.example. Production must never run with them.
PLACEHOLDER_MARKER = "local-dev-only"
MIN_SECRET_KEY_LENGTH = 32


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    environment: Environment = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://dearlly:local-dev-only-not-a-secret@localhost:5432/dearlly"
    )
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    secret_key: SecretStr = SecretStr("local-dev-only-not-a-secret-change-on-server")

    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "testserver"]
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    public_web_url: str = "http://localhost:3000"

    email_delivery: Literal["log", "resend"] = "log"

    _split_hosts = field_validator("allowed_hosts", "cors_origins", mode="before")(_split_csv)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> "Settings":
        if not self.is_production:
            return self
        problems = insecure_production_settings(self)
        if problems:
            raise ValueError("Refusing to start in production: " + "; ".join(problems))
        return self


def insecure_production_settings(settings: Settings) -> list[str]:
    problems: list[str] = []
    secret = settings.secret_key.get_secret_value()
    if PLACEHOLDER_MARKER in secret or len(secret) < MIN_SECRET_KEY_LENGTH:
        problems.append(f"SECRET_KEY must be a real random value of {MIN_SECRET_KEY_LENGTH}+ chars")
    if PLACEHOLDER_MARKER in settings.database_url.get_secret_value():
        problems.append("DATABASE_URL still uses the local placeholder password")
    if not settings.allowed_hosts or any("*" in host for host in settings.allowed_hosts):
        problems.append("ALLOWED_HOSTS must list exact host names (no wildcards)")
    if not settings.cors_origins:
        problems.append("CORS_ORIGINS must list the web app origin")
    for origin in settings.cors_origins:
        if "*" in origin or urlparse(origin).scheme != "https":
            problems.append(f"CORS origin {origin!r} must be an exact https:// origin")
    if urlparse(settings.public_web_url).scheme != "https":
        problems.append("PUBLIC_WEB_URL must use https://")
    return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
